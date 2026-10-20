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
export type Listing = Schemas["Listing"];

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
};

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
 * (décision D2 = A) : l'API refuse de les initier. Ils restent dans
 * `TypePaiement` pour afficher les paiements déjà enregistrés.
 */
export type TypePaiementPayable = Exclude<TypePaiement, "caution" | "premier_loyer">;

export type Payment = Schemas["Payment"] & {
  payeur?: User;
  listing?: Listing | null;
};

export interface Tarif {
  type: TypePaiementPayable;
  libelle: string;
  montant: number;
  payeur: string;
  description: string;
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
