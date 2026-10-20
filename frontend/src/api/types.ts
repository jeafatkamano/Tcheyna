/**
 * types.ts — Types de l'API utilisés par le frontend.
 *
 * Les objets renvoyés par l'API (annonce, utilisateur, candidature…) viennent
 * de `schema.gen.ts`, généré depuis `backend/openapi.json` (lot 3.10) : ne pas
 * les redéclarer ici. Après un changement côté backend :
 *   cd backend && flask api spec ; cd ../frontend && npm run api:types
 *
 * Ce fichier n'ajoute que ce que la spécification ne décrit pas encore : les
 * champs que certaines routes greffent sur un objet (`passeport` d'une
 * candidature, `etapes` du passeport…) et les réponses propres à une route
 * (`Tarif`, `Referentiel`…), en attendant que chaque route décrive sa réponse.
 */
import type { components } from "./schema.gen";

type Schemas = components["schemas"];
type Prive<T, Public> = Partial<Omit<T, keyof Public>>;

export type Role = Schemas["User"]["role"];
export type Niveau = Schemas["Niveau"];

/** Profil public ; les champs privés n'arrivent que pour le titulaire ou un admin. */
export type User = Schemas["User"] &
  Prive<Schemas["UserPrive"], Schemas["User"]> & {
    /* Présents uniquement sur /auth/me */
    niveau?: Niveau;
    prochain_niveau?: Niveau | null;
  };

export type Equipements = Schemas["Equipements"];
export type CertificationStatus = Schemas["Listing"]["certification_status"];
export type DetailCompatibilite = Schemas["DetailCompatibilite"];
/** Un propriétaire peut mettre son bien en location ou le vendre. */
export type TypeTransaction = Schemas["Listing"]["type_transaction"];

/** `adresse` vaut `null` pour qui n'y a pas droit (voir `adresse_masquee`). */
export type Listing = Schemas["Listing"] & VueProprietaireAnnonce;

export type MatchStatus = Schemas["Match"]["status"];

export type Match = Schemas["Match"] & {
  passeport?: TenantPassport | null;
};

export interface EtapeVerification {
  niveau: number;
  titre: string;
  fait: boolean;
  en_attente?: boolean;
  detail?: string;
  action: string;
}

/** Vue publique ; les champs privés n'arrivent que pour le locataire ou un admin. */
export type TenantPassport = Schemas["TenantPassport"] &
  Prive<Schemas["TenantPassportPrive"], Schemas["TenantPassport"]> & {
    /* Retour de GET /passport */
    trust_level?: number;
    niveau?: Niveau;
    prochain_niveau?: Niveau | null;
    etapes?: EtapeVerification[];
    abonnement?: { actif: boolean; jusqu_au: string | null };
    tenant?: User;
  };

export type Message = Schemas["Message"];

export type Conversation = Schemas["Conversation"] & {
  messages?: Message[];
  /*
   * Messagerie bornée (lot 2.8, PR #30). Champs facultatifs : absents tant
   * que le serveur ne les envoie pas, ce qui vaut « écriture ouverte » et
   * « fil complet ».
   */
  /** Vrai quand la candidature est refusée, retirée ou close : lecture seule. */
  ecriture_fermee?: boolean;
  motif_fermeture?: MotifFermeture | null;
  /** Présent seulement si le fil a été demandé par page (`limite`, `avant`). */
  pagination?: PaginationMessages;
};

/** Code stable du motif de fermeture d'une conversation. */
export type MotifFermeture = "candidature_refusee" | "candidature_retiree" | "candidature_close";

export interface PaginationMessages {
  limite: number;
  /** Il reste des messages plus anciens que ceux de la page. */
  plus_anciens: boolean;
  /** Valeur à passer en `avant` pour la page plus ancienne (`null` à la fin). */
  curseur: string | null;
}

export interface PageConversations {
  conversations: Conversation[];
  total: number;
  /** Total des non-lus de TOUTES les conversations, même paginées. */
  non_lus: number;
  /* Présents seulement si la liste a été demandée par page. */
  page?: number;
  per_page?: number;
  pages?: number;
}

/** Message type proposé à la saisie (GET /messages/modeles). */
export interface ModeleMessage {
  id: string;
  texte: string;
}

export interface ModelesMessages {
  cote: "locataire" | "bailleur" | null;
  modeles: ModeleMessage[];
}

export type Notification = Schemas["Notification"];
export type Review = Schemas["Review"];

export interface AvisADonner {
  match_id: string;
  listing?: Listing | null;
  cible: User;
  type_avis: Review["type_avis"];
  conclu_le?: string | null;
}

export type TypePaiement = Schemas["Payment"]["type_paiement"];

/**
 * Caution et premier loyer se règlent directement entre bailleur et locataire
 * (décision D2 = A) : l'API refuse de les initier. La commission de 6 % est
 * remplacée par les frais de mise en relation (décision D1) : l'API la refuse
 * aussi (422 `type_retire`). Ces types restent dans `TypePaiement` pour
 * afficher les paiements déjà enregistrés.
 */
export type TypePaiementPayable = Exclude<TypePaiement, "caution" | "premier_loyer" | "commission">;

export type Payment = Schemas["Payment"] & {
  payeur?: User;
  listing?: Listing | null;
};

export interface Tarif {
  type: TypePaiementPayable;
  libelle: string;
  montant: number;
  payeur: string;
  /** Quand le service est dû (frais de mise en relation seulement). */
  moment?: string;
  description: string;
}

/**
 * Corps du 402 de `PUT /matches/<id>/statut` quand le bailleur accepte une
 * candidature de location (D1) : la candidature reste en attente, et
 * l'acceptation prend effet à la confirmation de ce paiement.
 */
export interface FraisMiseEnRelationRequis {
  error: string;
  action_requise: "payer_frais_mise_en_relation";
  paiement: {
    type_paiement: "frais_mise_en_relation";
    match_id: string;
    montant: number;
    devise: string;
  };
}

export interface DocumentPiece {
  /** Référence interne, utilisée pour supprimer la pièce. */
  reference: string;
  libelle: string;
  /** Lien temporaire de consultation ; `null` quand aucun lien n'est possible. */
  url: string | null;
}

export interface Pays {
  nom: string;
  devise: { code: string; symbol: string; locale?: string };
  ouvert: boolean;
  nb_villes: number;
}

export interface Referentiel {
  locations: Record<string, Record<string, string[]>>;
  devises: Record<string, { code: string; symbol: string; locale?: string }>;
  types_bien: { valeur: string; label: string; sans_pieces?: boolean }[];
  marches_ouverts: string[];
}

/**
 * Suggestion de candidat : version réduite (lot 1.6). Le locataire n'a pas
 * candidaté, le bailleur ne voit ni son dossier ni son nom complet.
 */
export interface CandidatSuggere {
  /** `full_name` est réduit au prénom et à l'initiale du nom. */
  tenant: Pick<User, "id" | "role" | "full_name" | "trust_level">;
  score_compatibilite: number;
  details_compatibilite: DetailCompatibilite[];
  /** Abonnement Passeport en cours : le dossier est mis en avant. */
  abonne_passeport: boolean;
}

/**
 * Re-soumission d'une certification (D4, lot 2.2), telle que le serveur la
 * calcule. Elle vaut hors examen en cours : le web ne la lit que pour une
 * annonce « none » ou « rejected ».
 */
export interface CertificationResoumission {
  nb_refus: number;
  nb_paiements: number;
  /** Une nouvelle demande exige un nouveau paiement (402 sinon). */
  paiement_requis: boolean;
  /** La prochaine demande est la re-soumission gratuite. */
  resoumission_gratuite: boolean;
}

/**
 * Champs que seul le propriétaire reçoit (`mes-annonces`, détail, retrait et
 * remise en ligne). Absents d'un serveur antérieur au lot 2.2 : `undefined`
 * ne vaut ni « retirée » ni « gratuite ».
 */
export interface VueProprietaireAnnonce {
  /** Annonce retirée par son propriétaire : absente de la recherche. */
  retiree?: boolean;
  certification_resoumission?: CertificationResoumission;
}
