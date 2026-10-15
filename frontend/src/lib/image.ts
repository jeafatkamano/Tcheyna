/**
 * image.ts — Compression des photos dans le navigateur, avant envoi.
 *
 * Une photo de téléphone pèse 3 à 8 Mo : en 3G, c'est plusieurs minutes et
 * souvent une coupure. On la ramène à 1280 px de côté long et sous 300 Ko,
 * sans dépendance : décodage par `createImageBitmap` (orientation EXIF
 * appliquée), redessin sur un canvas, encodage WebP (JPEG si le navigateur ne
 * sait pas encoder le WebP, comme Safari avant la version 17).
 *
 * Effet secondaire voulu : le canvas ne recopie pas les métadonnées EXIF, la
 * position GPS du logement ne quitte donc pas le téléphone.
 *
 * Mémoire (Android bas de gamme) : une photo à la fois, bitmap libéré et
 * canvas vidé dès que possible, aucune lecture en base64.
 *
 * Les calculs (dimensions, boucle de qualité) sont des fonctions pures,
 * testées sans navigateur ; seul `preparerPhoto` touche au DOM.
 */

export const COTE_MAX = 1280;
/** Repli si la qualité seule ne suffit pas à passer sous le plafond. */
export const COTE_REPLI = 1024;
export const PLAFOND_OCTETS = 300 * 1024;
export const QUALITES = [0.82, 0.72, 0.62, 0.52] as const;
/** Limite du serveur pour une photo (stockage.TAILLE_MAX["photos"]). */
export const POIDS_MAX_SERVEUR = 8 * 1024 * 1024;
export const EXTENSIONS_ACCEPTEES = ["jpg", "jpeg", "png", "webp"];

export interface Dimensions {
  largeur: number;
  hauteur: number;
}

/** Ramène le côté long à `coteMax`, sans jamais agrandir, proportions gardées. */
export function dimensionsCibles(largeur: number, hauteur: number, coteMax = COTE_MAX): Dimensions {
  const cote = Math.max(largeur, hauteur);
  if (cote <= coteMax || cote === 0) return { largeur, hauteur };
  const ratio = coteMax / cote;
  return {
    largeur: Math.max(1, Math.round(largeur * ratio)),
    hauteur: Math.max(1, Math.round(hauteur * ratio)),
  };
}

/** Encodeur injecté : produit un Blob pour une qualité et un côté maximal. */
export type Encodeur = (qualite: number, coteMax: number) => Promise<Blob>;

/**
 * Essaie les qualités décroissantes à 1280 px, puis à 1024 px, et s'arrête
 * au premier résultat sous le plafond. Sinon, garde le plus léger obtenu : le
 * serveur accepte jusqu'à 8 Mo, mieux vaut une photo un peu lourde qu'aucune.
 */
export async function encoderSousPlafond(
  encoder: Encodeur,
  plafond = PLAFOND_OCTETS,
): Promise<Blob> {
  let meilleur: Blob | null = null;
  for (const coteMax of [COTE_MAX, COTE_REPLI]) {
    for (const qualite of QUALITES) {
      const blob = await encoder(qualite, coteMax);
      if (!meilleur || blob.size < meilleur.size) meilleur = blob;
      if (blob.size <= plafond) return blob;
    }
  }
  return meilleur!;
}

export function extension(nom: string): string {
  const point = nom.lastIndexOf(".");
  return point > 0 ? nom.slice(point + 1).toLowerCase() : "";
}

/**
 * Nom du fichier compressé. L'extension est indispensable : le serveur en
 * déduit le format, et refuse un Blob nommé « blob ».
 */
export function nomCompresse(nomOriginal: string, type: string): string {
  const ext = type === "image/webp" ? "webp" : "jpg";
  const point = nomOriginal.lastIndexOf(".");
  const base = (point > 0 ? nomOriginal.slice(0, point) : nomOriginal)
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "photo"}.${ext}`;
}

/** L'original peut-il partir tel quel quand la compression échoue ? */
export function originalEnvoyable(fichier: File): boolean {
  return (
    EXTENSIONS_ACCEPTEES.includes(extension(fichier.name)) && fichier.size <= POIDS_MAX_SERVEUR
  );
}

/* ─── Partie navigateur ─────────────────────────────────────── */

type Source = ImageBitmap | HTMLImageElement;

async function decoder(fichier: File): Promise<{ source: Source; liberer: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
      return { source: bitmap, liberer: () => bitmap.close() };
    } catch {
      // Safari ancien : options inconnues ou format refusé. On tente <img>.
    }
  }
  const url = URL.createObjectURL(fichier);
  const img = new Image();
  img.src = url;
  try {
    // <img> applique l'orientation EXIF (Chrome 81+, Safari 13.1+).
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return {
    source: img,
    liberer: () => {
      URL.revokeObjectURL(url);
      img.src = "";
    },
  };
}

function versBlob(canvas: HTMLCanvasElement, type: string, qualite: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Encodage impossible"))),
      type,
      qualite,
    );
  });
}

/**
 * Compresse une photo. Lève une erreur si le navigateur ne sait pas la lire
 * (HEIC choisi depuis « Fichiers », fichier corrompu…) : l'appelant décide
 * alors d'envoyer l'original ou de signaler le problème.
 */
export async function preparerPhoto(fichier: File): Promise<File> {
  const { source, liberer } = await decoder(fichier);
  const largeur = "naturalWidth" in source ? source.naturalWidth : source.width;
  const hauteur = "naturalHeight" in source ? source.naturalHeight : source.height;
  const canvas = document.createElement("canvas");
  let type = "image/webp";

  try {
    const blob = await encoderSousPlafond(async (qualite, coteMax) => {
      const cible = dimensionsCibles(largeur, hauteur, coteMax);
      if (canvas.width !== cible.largeur || canvas.height !== cible.hauteur) {
        canvas.width = cible.largeur;
        canvas.height = cible.hauteur;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas indisponible");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, 0, 0, cible.largeur, cible.hauteur);
      }
      const resultat = await versBlob(canvas, type, qualite);
      // Un navigateur qui ne sait pas encoder le WebP renvoie du PNG.
      if (resultat.type !== type) {
        type = "image/jpeg";
        return versBlob(canvas, type, qualite);
      }
      return resultat;
    });
    return new File([blob], nomCompresse(fichier.name, blob.type), { type: blob.type });
  } finally {
    liberer();
    canvas.width = 0;
    canvas.height = 0;
  }
}
