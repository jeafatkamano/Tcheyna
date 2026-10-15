/**
 * filePhotos.ts — File d'envoi des photos d'une annonce.
 *
 * Chaque photo passe par : compression → attente → envoi → (retirée de la
 * file si envoyée | erreur). Tout est **séquentiel**, une photo à la fois :
 *   • pour la mémoire du téléphone (compression) ;
 *   • parce que le serveur réécrit la liste complète des photos à chaque ajout
 *     (des envois parallèles se marcheraient dessus, cf. listings.py).
 *
 * Tant qu'aucune annonce n'est désignée (création en cours), les photos sont
 * compressées puis attendent : `demarrer(listingId)` lance leur envoi.
 *
 * Aucune reprise automatique : un envoi peut avoir abouti côté serveur malgré
 * l'erreur reçue, le rejouer créerait un doublon. La reprise passe par le
 * bouton « Réessayer » (`reessayer`), qui renvoie le fichier déjà compressé.
 *
 * Indépendante de React (testable seule) ; le composant s'y abonne avec
 * `useSyncExternalStore`.
 */
import { ApiError, estAnnulation } from "../api/client";

export type EtatPhoto = "compression" | "attente" | "envoi" | "erreur";

export interface PhotoFile {
  id: string;
  nom: string;
  etat: EtatPhoto;
  /** Fraction envoyée, de 0 à 1 (état « envoi »). */
  progression: number;
  /** Aperçu local (URL d'objet), construit depuis le fichier compressé. */
  apercu?: string;
  erreur?: string;
  /** Faux quand réessayer ne servirait à rien (format illisible). */
  reessayable: boolean;
  /**
   * Compression impossible : l'original part tel quel, avec ses métadonnées
   * EXIF (dont, souvent, la position GPS). Signalé, sans bloquer.
   */
  nonCompressee?: boolean;
}

export interface EtatFile {
  photos: readonly PhotoFile[];
  /** Photos envoyées depuis la création de la file (récapitulatif). */
  envoyees: number;
  /** Parmi elles, celles parties sans compression. */
  nonCompressees: number;
  /** Faux tant qu'aucune annonce n'est désignée (création en cours). */
  demarree: boolean;
  /**
   * URL serveur d'une photo envoyée → son aperçu local (fichier compressé
   * encore en mémoire). La grille l'affiche au lieu de retélécharger la photo
   * (≈ 300 Ko en 3G) et reste correcte pendant une coupure.
   */
  apercusLocaux: Readonly<Record<string, string>>;
}

export interface DependancesFile {
  compresser: (fichier: File) => Promise<File>;
  /** Repli quand la compression échoue : l'original peut-il partir tel quel ? */
  originalEnvoyable: (fichier: File) => boolean;
  envoyer: (
    listingId: string,
    fichier: File,
    options: { onProgression: (fraction: number) => void; signal: AbortSignal },
  ) => Promise<{ images: string[] }>;
  creerApercu?: (fichier: Blob) => string;
  revoquerApercu?: (url: string) => void;
}

const MESSAGE_ILLISIBLE =
  "Format de photo non pris en charge. Choisissez une photo JPG, PNG ou WEBP.";

function messageErreur(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statut === 413) return "Photo trop lourde pour le serveur.";
    return err.message;
  }
  return "Envoi impossible. Réessayez.";
}

export class FilePhotos {
  private onImages?: (images: string[]) => void;
  private etat: EtatFile = {
    photos: [],
    envoyees: 0,
    nonCompressees: 0,
    demarree: false,
    apercusLocaux: {},
  };
  private fichiers = new Map<string, File>();
  private abonnes = new Set<() => void>();
  private listingId?: string;
  private boucle: Promise<void> | null = null;
  private controleur: AbortController | null = null;
  private arretee = false;
  private compteur = 0;
  private deps: DependancesFile;

  constructor(deps: DependancesFile) {
    this.deps = deps;
  }

  /* ─── Abonnement (useSyncExternalStore) ─── */

  subscribe = (abonne: () => void) => {
    this.abonnes.add(abonne);
    return () => {
      this.abonnes.delete(abonne);
    };
  };

  getSnapshot = (): EtatFile => this.etat;

  private publier(maj: Partial<EtatFile>) {
    this.etat = { ...this.etat, ...maj };
    this.abonnes.forEach((abonne) => abonne());
  }

  private modifier(id: string, maj: Partial<PhotoFile>) {
    this.publier({
      photos: this.etat.photos.map((p) => (p.id === id ? { ...p, ...maj } : p)),
    });
  }

  private enlever(id: string, garderApercu = false) {
    const photo = this.etat.photos.find((p) => p.id === id);
    if (photo?.apercu && !garderApercu) this.deps.revoquerApercu?.(photo.apercu);
    this.fichiers.delete(id);
    this.publier({ photos: this.etat.photos.filter((p) => p.id !== id) });
  }

  /* ─── Actions ─── */

  /** Rappel appelé avec la liste à jour des photos de l'annonce après chaque envoi. */
  definirRappel(rappel: (images: string[]) => void) {
    this.onImages = rappel;
  }

  /** Ajoute des photos en fin de file et lance le traitement. */
  ajouter(fichiers: File[]): Promise<void> {
    const nouvelles = fichiers.map((fichier): PhotoFile => {
      const id = `photo-${++this.compteur}`;
      this.fichiers.set(id, fichier);
      return { id, nom: fichier.name, etat: "compression", progression: 0, reessayable: true };
    });
    this.publier({ photos: [...this.etat.photos, ...nouvelles] });
    return this.traiter();
  }

  /** Désigne l'annonce destinataire et envoie ce qui attend. */
  demarrer(listingId: string): Promise<void> {
    this.listingId = listingId;
    if (!this.etat.demarree) this.publier({ demarree: true });
    return this.traiter();
  }

  reessayer(id: string): Promise<void> {
    const photo = this.etat.photos.find((p) => p.id === id);
    if (photo?.etat !== "erreur" || !photo.reessayable) return this.traiter();
    this.modifier(id, { etat: "attente", erreur: undefined, progression: 0 });
    return this.traiter();
  }

  /** Retire une photo de la file (sauf pendant son envoi). */
  retirer(id: string) {
    const photo = this.etat.photos.find((p) => p.id === id);
    if (!photo || photo.etat === "envoi" || photo.etat === "compression") return;
    this.enlever(id);
  }

  /** Interrompt l'envoi en cours (démontage) ; `reprendre` le réautorise. */
  arreter() {
    this.arretee = true;
    this.controleur?.abort();
  }

  reprendre() {
    this.arretee = false;
  }

  /** Vrai après `arreter` (démontage) : l'appelant ne doit plus agir sur la page. */
  estArretee(): boolean {
    return this.arretee;
  }

  /** Vide la file et libère les aperçus. */
  vider() {
    this.arreter();
    this.etat.photos.forEach((p) => p.apercu && this.deps.revoquerApercu?.(p.apercu));
    Object.values(this.etat.apercusLocaux).forEach((url) => this.deps.revoquerApercu?.(url));
    this.fichiers.clear();
    this.publier({ photos: [], apercusLocaux: {} });
  }

  /** Promesse résolue quand plus rien n'est à faire. */
  traiter(): Promise<void> {
    this.boucle ??= this.executer().finally(() => {
      this.boucle = null;
    });
    return this.boucle;
  }

  /* ─── Boucle ─── */

  private prochaine(): PhotoFile | undefined {
    if (this.arretee) return undefined;
    return this.etat.photos.find(
      (p) => p.etat === "compression" || (p.etat === "attente" && this.listingId),
    );
  }

  private async executer() {
    // Le JavaScript étant monothread, aucune action ne peut s'intercaler entre
    // le dernier `prochaine()` vide et la fin de la boucle : une photo ajoutée
    // pendant un envoi sera toujours vue.
    for (let photo = this.prochaine(); photo; photo = this.prochaine()) {
      if (photo.etat === "compression") await this.compresser(photo);
      else await this.envoyer(photo, this.listingId!);
    }
  }

  private async compresser(photo: PhotoFile) {
    const original = this.fichiers.get(photo.id)!;
    let fichier: File;
    let nonCompressee = false;
    try {
      fichier = await this.deps.compresser(original);
    } catch {
      if (!this.deps.originalEnvoyable(original)) {
        this.modifier(photo.id, { etat: "erreur", erreur: MESSAGE_ILLISIBLE, reessayable: false });
        return;
      }
      fichier = original;
      nonCompressee = true;
    }
    if (!this.etat.photos.some((p) => p.id === photo.id)) return; // retirée entre-temps
    this.fichiers.set(photo.id, fichier);
    this.modifier(photo.id, {
      etat: "attente",
      nom: fichier.name,
      nonCompressee,
      apercu: this.deps.creerApercu?.(fichier),
    });
  }

  private async envoyer(photo: PhotoFile, listingId: string) {
    const fichier = this.fichiers.get(photo.id)!;
    this.controleur = new AbortController();
    this.modifier(photo.id, { etat: "envoi", progression: 0, erreur: undefined });
    try {
      const reponse = await this.deps.envoyer(listingId, fichier, {
        signal: this.controleur.signal,
        onProgression: (fraction) => this.modifier(photo.id, { progression: fraction }),
      });
      // Le serveur ajoute en fin de liste ; un doublon reconnu (même photo
      // déjà enregistrée) renvoie la liste inchangée, dont la dernière est
      // justement cette photo.
      const url = reponse.images.at(-1);
      const apercu = this.etat.photos.find((p) => p.id === photo.id)?.apercu;
      const garder = Boolean(url && apercu && !this.etat.apercusLocaux[url]);
      this.enlever(photo.id, garder);
      this.publier({
        ...(garder ? { apercusLocaux: { ...this.etat.apercusLocaux, [url!]: apercu! } } : {}),
        envoyees: this.etat.envoyees + 1,
        nonCompressees: this.etat.nonCompressees + (photo.nonCompressee ? 1 : 0),
      });
      this.onImages?.(reponse.images);
    } catch (err) {
      if (estAnnulation(err)) {
        // Interrompue (démontage) : elle repartira au prochain démarrage.
        this.modifier(photo.id, { etat: "attente", progression: 0 });
        return;
      }
      this.modifier(photo.id, { etat: "erreur", erreur: messageErreur(err), progression: 0 });
    } finally {
      this.controleur = null;
    }
  }
}

/** Compte les photos par état, pour le récapitulatif. */
export function resumer(etat: EtatFile) {
  const compter = (e: EtatPhoto) => etat.photos.filter((p) => p.etat === e).length;
  const enEchec = compter("erreur");
  return {
    envoyees: etat.envoyees,
    nonCompressees: etat.nonCompressees,
    /** Quitter la page maintenant perdrait un envoi : à confirmer. */
    envoiActif:
      etat.photos.some((p) => p.etat === "envoi" || p.etat === "compression") ||
      (etat.demarree && compter("attente") > 0),
    enEchec,
    restantes: etat.photos.length - enEchec,
    occupee: etat.photos.some((p) => p.etat === "envoi" || p.etat === "compression"),
  };
}
