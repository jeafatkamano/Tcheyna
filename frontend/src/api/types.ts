/**
 * types.ts — Types alignés sur les sérialisations du backend Flask.
 *
 * Toute évolution de `to_dict()` côté Python doit se refléter ici.
 */

export type Role = "tenant" | "landlord" | "agency" | "admin";

export interface Niveau {
  label: string;
  critere: string;
  debloque: string;
}

export interface User {
  id: string;
  full_name: string;
  email?: string;
  phone?: string;
  role: Role;
  pays?: string;
  ville?: string;
  quartier?: string;
  bio?: string;
  trust_level: number;
  badge: string;
  phone_verified: boolean;
  cni_verified: boolean;
  income_verified: boolean;
  cni_uploaded?: boolean;
  is_active?: boolean;
  avatar_url?: string;
  preferred_lang: "fr" | "en";
  note_moyenne?: number | null;
  nb_avis: number;
  created_at?: string;
  /* Présents uniquement sur /auth/me */
  niveau?: Niveau;
  prochain_niveau?: Niveau | null;
}

export interface Equipements {
  generateur: boolean;
  eau: boolean;
  wifi: boolean;
  securite: boolean;
  parking: boolean;
  climatisation: boolean;
}

export type CertificationStatus = "none" | "pending" | "certified" | "rejected";

export interface DetailCompatibilite {
  critere: string;
  points: number;
  max: number;
  libelle: string;
}

/** Un propriétaire peut mettre son bien en location ou le vendre. */
export type TypeTransaction = "location" | "vente";

export interface Listing {
  id: string;
  title: string;
  description: string;
  pays: string;
  ville: string;
  quartier?: string;
  /** Adresse exacte : `null` pour qui n'y a pas droit (voir `adresse_masquee`). */
  adresse?: string | null;
  /** Vrai quand une adresse existe mais n'est communiquée qu'après acceptation. */
  adresse_masquee?: boolean;
  type_transaction: TypeTransaction;
  est_vente: boolean;
  type_bien: string;
  /** Loyer mensuel en location, prix de cession en vente. */
  prix: number;
  charges: number;
  caution?: number | null;
  cout_entree: number;
  devise: string;
  nb_pieces?: number | null;
  superficie?: number | null;
  etage?: number | null;
  meuble: boolean;
  disponible_a_partir?: string | null;
  equipements: Equipements;
  certification_status: CertificationStatus;
  nb_documents: number;
  is_certified: boolean;
  certified_at?: string | null;
  is_premium: boolean;
  status: "active" | "matched" | "closed";
  views_count: number;
  nb_candidatures: number;
  images: string[];
  landlord?: User;
  created_at?: string;
  /* Enrichissements contextuels */
  is_favorite?: boolean;
  is_owner?: boolean;
  score_compatibilite?: number;
  details_compatibilite?: DetailCompatibilite[];
  ma_candidature?: { id: string; status: MatchStatus } | null;
}

export type MatchStatus = "pending" | "accepted" | "rejected" | "completed" | "cancelled";

export interface Match {
  id: string;
  tenant?: User;
  listing?: Listing;
  status: MatchStatus;
  message?: string | null;
  score_compatibilite?: number | null;
  visite_date?: string | null;
  completed_at?: string | null;
  commission: number;
  conversation_id?: string | null;
  created_at?: string;
  passeport?: TenantPassport | null;
}

export interface EtapeVerification {
  niveau: number;
  titre: string;
  fait: boolean;
  en_attente?: boolean;
  detail?: string;
  action: string;
}

export interface TenantPassport {
  id: string;
  tenant_id: string;
  docs_uploaded: boolean;
  income_verified: boolean;
  score: number;
  situation_pro?: string | null;
  a_un_garant: boolean;
  budget_min?: number | null;
  budget_max?: number | null;
  ville_souhaitee?: string | null;
  quartiers_souhaites: string[];
  type_bien_souhaite?: string | null;
  nb_pieces_min?: number | null;
  nb_occupants?: number | null;
  date_emmenagement?: string | null;
  created_at?: string;
  /* Vue privée (locataire ou admin) */
  revenu_mensuel?: number | null;
  devise?: string | null;
  employeur?: string | null;
  garant_nom?: string | null;
  garant_revenu?: number | null;
  documents?: {
    cni_recto: boolean;
    cni_verso: boolean;
    passport: boolean;
    income: boolean;
  };
  /* Retour de GET /passport */
  trust_level?: number;
  niveau?: Niveau;
  prochain_niveau?: Niveau | null;
  etapes?: EtapeVerification[];
  abonnement?: { actif: boolean; jusqu_au: string | null };
  tenant?: User;
}

export interface Message {
  id: string;
  sender_id: string;
  contenu: string;
  lu: boolean;
  created_at?: string;
}

export interface Conversation {
  id: string;
  match_id: string;
  listing?: Listing | null;
  interlocuteur?: User;
  dernier_message?: Message | null;
  nb_non_lus: number;
  last_message_at?: string | null;
  created_at?: string;
  messages?: Message[];
}

export interface Notification {
  id: string;
  type: string;
  titre: string;
  contenu?: string | null;
  lien?: string | null;
  lu: boolean;
  created_at?: string;
}

export interface Review {
  id: string;
  reviewer?: User;
  target_id: string;
  note: number;
  commentaire?: string | null;
  type_avis: "tenant_to_landlord" | "landlord_to_tenant";
  created_at?: string;
}

export interface AvisADonner {
  match_id: string;
  listing?: Listing | null;
  cible: User;
  type_avis: Review["type_avis"];
  conclu_le?: string | null;
}

export type TypePaiement =
  | "caution"
  | "premier_loyer"
  | "commission"
  | "certification"
  | "abonnement_passeport"
  | "mise_en_avant";

/**
 * Caution et premier loyer se règlent directement entre bailleur et locataire
 * (décision D2 = A) : l'API refuse de les initier. Ils restent dans
 * `TypePaiement` pour afficher les paiements déjà enregistrés.
 */
export type TypePaiementPayable = Exclude<TypePaiement, "caution" | "premier_loyer">;

export interface Payment {
  id: string;
  reference: string;
  type_paiement: TypePaiement;
  type_label: string;
  description?: string | null;
  montant: number;
  commission: number;
  devise: string;
  methode?: string | null;
  statut: "pending" | "success" | "failed";
  match_id?: string | null;
  paid_at?: string | null;
  created_at?: string;
  payeur?: User;
  listing?: Listing | null;
}

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
