/**
 * api/index.ts — Surface publique de l'API, groupée par domaine.
 *
 * Les composants importent d'ici et jamais `fetch` directement.
 */
import {
  api,
  ApiError,
  envoyerFichier,
  queryString,
  tokens,
  BASE_URL,
  type OptionsEnvoi,
} from "./client";
import type {
  AvisADonner,
  DocumentPiece,
  CandidatSuggere,
  Conversation,
  Listing,
  Match,
  MatchStatus,
  Message,
  ModelesMessages,
  Notification,
  PageConversations,
  Payment,
  Pays,
  Referentiel,
  Review,
  Role,
  Tarif,
  TenantPassport,
  TypePaiementPayable,
  TypeTransaction,
  User,
} from "./types";

export * from "./types";
export {
  ApiError,
  effacerMotifDeconnexion,
  estAnnulation,
  lireMotifDeconnexion,
  MESSAGE_RESEAU,
  MESSAGE_REVEIL,
  MESSAGE_SERVEUR_ENDORMI,
  reveilServeur,
  tokens,
  urlFichier,
} from "./client";

/* ─── AUTHENTIFICATION ─────────────────────────────────────── */

export interface ReponseAuth {
  message: string;
  user: User;
  access_token: string;
  refresh_token: string;
}

export const authAPI = {
  inscrire: (data: {
    email: string;
    password: string;
    full_name: string;
    role: Exclude<Role, "admin">;
    phone?: string;
    pays?: string;
    ville?: string;
    quartier?: string;
  }) => api.post<ReponseAuth>("/auth/register", data),

  connecter: (email: string, password: string) =>
    api.post<ReponseAuth>("/auth/login", { email, password }),

  /**
   * Révoque côté serveur toutes les sessions du compte (`token_version`,
   * lot 1.12). Le jeton est passé explicitement : celui d'accès, ou celui de
   * rafraîchissement, que le serveur accepte aussi. Un 401 n'entraîne ni
   * rafraîchissement ni redirection (route hors session, client.ts), et un
   * POST n'est jamais rejoué.
   */
  deconnecter: (jeton: string, signal?: AbortSignal) =>
    api.post<{ message: string }>("/auth/logout", undefined, {
      headers: { Authorization: `Bearer ${jeton}` },
      signal,
    }),

  // Une seule reprise au démarrage : pas deux minutes de chargeur.
  moi: () => api.get<User>("/auth/me", { reprises: 1 }),

  /**
   * Le serveur révoque tous les jetons du compte et en renvoie de nouveaux
   * pour l'appareil courant : ils sont stockés ici, sinon la requête suivante
   * déconnecterait l'utilisateur. Tolère une réponse sans jetons (backend
   * antérieur au lot 1.4), qui ne révoque rien.
   */
  changerMotDePasse: async (ancien_mot_de_passe: string, nouveau_mot_de_passe: string) => {
    const reponse = await api.put<{ message: string; access_token?: string; refresh_token?: string }>(
      "/auth/password",
      { ancien_mot_de_passe, nouveau_mot_de_passe },
    );
    if (reponse.access_token) tokens.set(reponse.access_token, reponse.refresh_token);
    return reponse;
  },

  /**
   * Mot de passe oublié, étape 1 (lot 3.8) : demande un code par SMS. La
   * réponse est la même que le numéro corresponde à un compte ou non (message
   * neutre, à afficher tel quel) ; seul un numéro **vérifié** reçoit un code.
   */
  demanderReinitialisation: (phone: string) =>
    api.post<{ message: string; expire_dans: number }>("/auth/mot-de-passe-oublie", { phone }),

  /**
   * Étape 2 : code reçu + nouveau mot de passe. En cas de succès, le serveur
   * révoque toutes les sessions du compte et n'en ouvre aucune : il faut se
   * reconnecter. Tout échec du code répond le même 400.
   */
  confirmerReinitialisation: (phone: string, code: string, nouveau_mot_de_passe: string) =>
    api.post<{ message: string }>("/auth/mot-de-passe-oublie/confirmer", {
      phone,
      code,
      nouveau_mot_de_passe,
    }),

  envoyerOTP: (phone?: string) =>
    api.post<{ message: string; phone: string; expire_dans: number; debug_code?: string }>(
      "/auth/send-otp",
      phone ? { phone } : {},
    ),

  verifierOTP: (code: string) =>
    api.post<{ message: string; trust_level: number; badge: string }>("/auth/verify-otp", { code }),

  niveaux: () =>
    api.get<{ niveaux: { niveau: number; label: string; critere: string; debloque: string }[] }>(
      "/auth/niveaux",
    ),
};

/* ─── ANNONCES ─────────────────────────────────────────────── */

export interface FiltresAnnonces {
  q?: string;
  /** Louer ou acheter — deux marchés qu'on ne mélange pas dans une liste. */
  transaction?: TypeTransaction;
  pays?: string;
  ville?: string;
  quartier?: string;
  type?: string;
  prix_min?: number;
  prix_max?: number;
  nb_pieces_min?: number;
  surface_min?: number;
  has_water?: boolean;
  has_generator?: boolean;
  has_wifi?: boolean;
  is_secured?: boolean;
  has_parking?: boolean;
  has_ac?: boolean;
  meuble?: boolean;
  certified_only?: boolean;
  tri?: "recent" | "prix_asc" | "prix_desc" | "surface" | "match";
  page?: number;
  per_page?: number;
}

export interface PageAnnonces {
  listings: Listing[];
  total: number;
  pages: number;
  page: number;
  per_page: number;
}

/**
 * Corps accepté par POST/PUT /listings. Ni `devise` (déduite du pays par le
 * serveur), ni `status`/`is_visible` (retrait : `retirer`), ni `images`
 * (routes `/photos`) : le serveur refuse tout champ en trop (422).
 */
export interface DonneesAnnonce {
  title_fr: string;
  description_fr: string;
  pays: string;
  ville: string;
  quartier?: string;
  adresse?: string;
  type_transaction?: TypeTransaction;
  type_bien: string;
  prix: number;
  charges?: number;
  caution?: number;
  nb_pieces?: number;
  superficie?: number;
  etage?: number;
  meuble?: boolean;
  disponible_a_partir?: string;
  has_generator?: boolean;
  has_water?: boolean;
  has_wifi?: boolean;
  is_secured?: boolean;
  has_parking?: boolean;
  has_ac?: boolean;
}

export const listingsAPI = {
  rechercher: (filtres: FiltresAnnonces = {}) =>
    api.get<PageAnnonces>(`/listings/${queryString(filtres)}`, { optionnel: true }),

  recommandations: (limite = 10) =>
    api.get<{ listings: Listing[]; total: number; passeport_complet: boolean }>(
      `/listings/recommandations${queryString({ limite })}`,
    ),

  /**
   * `inclure_retirees` ajoute les annonces retirées (lot 2.2), pour les
   * remettre en ligne ; les `stats` ne portent que sur les annonces en ligne.
   */
  mesAnnonces: (options: { inclure_retirees?: boolean } = {}) =>
    api.get<{
      listings: Listing[];
      total: number;
      stats: { actives: number; certifiees: number; vues: number; candidatures: number };
    }>(
      `/listings/mes-annonces${queryString({ inclure_retirees: options.inclure_retirees ? 1 : undefined })}`,
    ),

  detail: (id: string) => api.get<Listing>(`/listings/${id}`, { optionnel: true }),

  creer: (data: DonneesAnnonce) =>
    api.post<{ message: string; listing: Listing }>("/listings/", data),

  modifier: (id: string, data: Partial<DonneesAnnonce>) =>
    api.put<{ message: string; listing: Listing }>(`/listings/${id}`, data),

  /**
   * Retire l'annonce de la recherche, de façon réversible (`reactiver`).
   * Un serveur antérieur au lot 2.2 ne connaît pas PUT /retirer (404 ou
   * 405) : il reçoit alors l'ancien DELETE, qui a le même effet.
   */
  retirer: async (id: string) => {
    try {
      return await api.put<{ message: string; listing?: Listing }>(`/listings/${id}/retirer`);
    } catch (err) {
      if (err instanceof ApiError && (err.statut === 404 || err.statut === 405)) {
        return api.delete<{ message: string; listing?: Listing }>(`/listings/${id}`);
      }
      throw err;
    }
  },

  /**
   * Remet en ligne une annonce retirée. Refus : 403 `telephone_non_verifie`
   * (D3), 409 `annonce_conclue` (bien loué ou vendu).
   */
  reactiver: (id: string) =>
    api.put<{ message: string; listing: Listing }>(`/listings/${id}/reactiver`),

  demanderCertification: (id: string) =>
    api.post<{ message: string; listing: Listing }>(`/listings/${id}/certification`),

  /* ─── Photos du bien (publiques) ─────────────────────── */

  /**
   * Une photo par requête, avec progression. L'appelant les envoie l'une
   * après l'autre : le serveur réécrit la liste complète à chaque ajout.
   */
  televerserPhoto: (id: string, fichier: File, options?: OptionsEnvoi) => {
    const form = new FormData();
    // Le nom (avec extension) est obligatoire : le serveur en déduit le format.
    form.append("file", fichier, fichier.name);
    // `url` : celle de cette photo, ajoutée ou déjà présente (doublon).
    return envoyerFichier<{ message: string; images: string[]; url: string | null }>(
      `/listings/${id}/photos`,
      form,
      options,
    );
  },

  supprimerPhoto: (id: string, url: string) =>
    api.delete<{ message: string; images: string[] }>(`/listings/${id}/photos`, {
      body: JSON.stringify({ url }),
      headers: { "Content-Type": "application/json" },
    }),

  reordonnerPhotos: (id: string, images: string[]) =>
    api.put<{ message: string; images: string[] }>(`/listings/${id}/photos/ordre`, { images }),

  /* ─── Pièces administratives (jamais publiques) ──────── */

  televerserDocuments: (id: string, fichiers: File[]) => {
    const form = new FormData();
    fichiers.forEach((f) => form.append("files", f));
    return api.post<{ message: string; nb_documents: number }>(
      `/listings/${id}/documents`,
      form,
    );
  },

  documents: (id: string) =>
    api.get<{ documents: DocumentPiece[]; total: number }>(`/listings/${id}/documents`),

  supprimerDocument: (id: string, url: string) =>
    api.delete<{ message: string; nb_documents: number }>(`/listings/${id}/documents`, {
      body: JSON.stringify({ url }),
      headers: { "Content-Type": "application/json" },
    }),
};

/* ─── MISES EN RELATION ────────────────────────────────────── */

export interface StatsMatches {
  total: number;
  en_attente: number;
  acceptees: number;
  refusees?: number;
  conclues: number;
}

export const matchesAPI = {
  candidater: (listing_id: string, message?: string) =>
    api.post<{ message: string; match: Match }>("/matches/", { listing_id, message }),

  mesCandidatures: (statut?: MatchStatus) =>
    api.get<{ matches: Match[]; stats: StatsMatches }>(
      `/matches/mes-candidatures${queryString({ statut })}`,
    ),

  mesDemandes: (filtres: { statut?: MatchStatus; listing_id?: string } = {}) =>
    api.get<{ matches: Match[]; stats: StatsMatches }>(
      `/matches/mes-demandes${queryString(filtres)}`,
    ),

  candidatsSuggeres: (listing_id: string, limite = 10) =>
    api.get<{ candidats: CandidatSuggere[]; total: number }>(
      `/matches/candidats-suggeres${queryString({ listing_id, limite })}`,
    ),

  detail: (id: string) => api.get<Match>(`/matches/${id}`),

  repondre: (id: string, statut: "accepted" | "rejected") =>
    api.put<{ message: string; match: Match }>(`/matches/${id}/statut`, { statut }),

  planifierVisite: (id: string, visite_date: string) =>
    api.put<{ message: string; match: Match }>(`/matches/${id}/visite`, { visite_date }),

  conclure: (id: string) =>
    api.put<{ message: string; match: Match; commission: number; devise: string }>(
      `/matches/${id}/conclure`,
    ),

  retirer: (id: string) => api.delete<{ message: string }>(`/matches/${id}`),
};

/* ─── PASSEPORT LOCATAIRE ──────────────────────────────────── */

export type TypeDocument = "cni_recto" | "cni_verso" | "passport" | "income";

export const passportAPI = {
  recuperer: () => api.get<TenantPassport>("/passport/"),

  mettreAJour: (data: {
    revenu_mensuel?: number;
    devise?: string;
    employeur?: string;
    situation_pro?: string;
    a_un_garant?: boolean;
    garant_nom?: string;
    garant_revenu?: number;
  }) => api.post<{ message: string; passport: TenantPassport }>("/passport/", data),

  enregistrerCriteres: (data: {
    budget_min?: number;
    budget_max?: number;
    ville_souhaitee?: string;
    quartiers_souhaites?: string[];
    type_bien_souhaite?: string;
    nb_pieces_min?: number;
    nb_occupants?: number;
    date_emmenagement?: string;
  }) => api.put<{ message: string; passport: TenantPassport }>("/passport/preferences", data),

  televerser: (type: TypeDocument, fichier: File) => {
    const form = new FormData();
    form.append("file", fichier);
    return api.post<{ message: string; url: string; score: number; trust_level: number }>(
      `/passport/upload/${type}`,
      form,
    );
  },

  supprimerDocument: (type: TypeDocument) =>
    api.delete<{ message: string; score: number }>(`/passport/upload/${type}`),

  voir: (tenantId: string) => api.get<TenantPassport>(`/passport/${tenantId}`),
};

/* ─── MESSAGERIE ───────────────────────────────────────────── */

export const messagesAPI = {
  /** Sans paramètre : toutes les conversations. `page`/`per_page` (≤ 50) : une page. */
  conversations: (pagination: { page?: number; per_page?: number } = {}, signal?: AbortSignal) =>
    api.get<PageConversations>(`/messages/conversations${queryString(pagination)}`, { signal }),

  fil: (conversationId: string) =>
    api.get<Conversation>(`/messages/conversations/${conversationId}`),

  /**
   * Sans `page` : le fil complet. Avec `limite` (1 à 100) et `avant` (id d'un
   * message) : les `limite` messages qui précèdent `avant`, et un bloc
   * `pagination`. Un serveur antérieur au lot 2.8 ignore ces paramètres et
   * renvoie le fil complet, sans `pagination`.
   */
  filParMatch: (matchId: string, signal?: AbortSignal, page: PageFil = {}) =>
    api.get<Conversation>(`/messages/par-match/${matchId}${queryString(page)}`, { signal }),

  envoyer: (conversationId: string, contenu: string) =>
    api.post<{ message: string; data: Message }>(`/messages/conversations/${conversationId}`, {
      contenu,
    }),

  nonLus: () => api.get<{ non_lus: number }>("/messages/non-lus"),

  /** Messages types du côté de l'appelant (404 sur un serveur antérieur au lot 2.8). */
  modeles: (signal?: AbortSignal) => api.get<ModelesMessages>("/messages/modeles", { signal }),
};

/** Page du fil : `limite` messages avant le message `avant`. */
export interface PageFil {
  limite?: number;
  avant?: string;
}

/* ─── FAVORIS ──────────────────────────────────────────────── */

export const favorisAPI = {
  liste: () => api.get<{ listings: Listing[]; total: number }>("/favorites/"),
  ajouter: (listingId: string) =>
    api.post<{ message: string; is_favorite: boolean }>(`/favorites/${listingId}`),
  retirer: (listingId: string) =>
    api.delete<{ message: string; is_favorite: boolean }>(`/favorites/${listingId}`),
};

/* ─── NOTIFICATIONS ────────────────────────────────────────── */

export const notificationsAPI = {
  liste: (nonLues = false) =>
    api.get<{ notifications: Notification[]; non_lues: number }>(
      `/notifications/${queryString({ non_lues: nonLues })}`,
    ),
  compteur: () => api.get<{ non_lues: number }>("/notifications/non-lues"),
  marquerLue: (id: string) => api.put<{ message: string }>(`/notifications/${id}/lue`),
  toutMarquerLu: () => api.put<{ message: string }>("/notifications/tout-lire"),
  supprimer: (id: string) => api.delete<{ message: string }>(`/notifications/${id}`),
};

/* ─── AVIS ─────────────────────────────────────────────────── */

export const avisAPI = {
  pourUtilisateur: (userId: string) =>
    api.get<{
      reviews: Review[];
      moyenne: number;
      total: number;
      positifs: number;
      repartition: Record<string, number>;
    }>(`/reviews/user/${userId}`, { optionnel: true }),

  aDonner: () => api.get<{ a_donner: AvisADonner[]; total: number }>("/reviews/a-donner"),

  publier: (data: { match_id: string; note: number; commentaire?: string }) =>
    api.post<{ message: string; review: Review }>("/reviews/", data),
};

/* ─── PAIEMENTS ────────────────────────────────────────────── */

export const paiementsAPI = {
  tarifs: () =>
    api.get<{ devise: string; services: Tarif[] }>("/payments/tarifs", { optionnel: true }),

  initier: (data: {
    type_paiement: TypePaiementPayable;
    match_id?: string;
    listing_id?: string;
    methode?: string;
  }) =>
    api.post<{
      message: string;
      payment_url: string | null;
      transaction_id?: string;
      paiement: Payment;
      mode?: string;
    }>("/payments/initier", data),

  mesPaiements: (statut?: Payment["statut"]) =>
    api.get<{ paiements: Payment[]; total: number; total_paye: number; devise: string }>(
      `/payments/mes-paiements${queryString({ statut })}`,
    ),

  recu: (id: string) => api.get<Payment>(`/payments/${id}`),

  verifier: (id: string) =>
    api.post<{ message: string; paiement: Payment }>(`/payments/${id}/verifier`),
};

/* ─── UTILISATEURS ─────────────────────────────────────────── */

export const usersAPI = {
  profil: (id: string) =>
    api.get<User & { avis: Review[]; annonces?: Listing[]; nb_annonces?: number; passeport?: TenantPassport }>(
      `/users/${id}`,
      { optionnel: true },
    ),

  modifier: (data: Partial<Pick<User, "full_name" | "pays" | "ville" | "quartier" | "bio" | "preferred_lang">>) =>
    api.put<{ message: string; user: User }>("/users/me", data),

  desactiver: () => api.delete<{ message: string }>("/users/me"),

  televerserAvatar: (fichier: File) => {
    const form = new FormData();
    form.append("file", fichier);
    return api.post<{ message: string; avatar_url: string; user: User }>(
      "/users/me/avatar",
      form,
    );
  },

  supprimerAvatar: () => api.delete<{ message: string; user: User }>("/users/me/avatar"),
};

/* ─── GÉOGRAPHIE ───────────────────────────────────────────── */

export const geoAPI = {
  pays: () => api.get<{ pays: Pays[] }>("/geo/pays", { optionnel: true }),
  villes: (pays: string) =>
    api.get<{ pays: string; villes: string[] }>(`/geo/villes/${encodeURIComponent(pays)}`, {
      optionnel: true,
    }),
  quartiers: (pays: string, ville: string) =>
    api.get<{ pays: string; ville: string; quartiers: string[] }>(
      `/geo/quartiers/${encodeURIComponent(pays)}/${encodeURIComponent(ville)}`,
      { optionnel: true },
    ),
  referentiel: () => api.get<Referentiel>("/geo/referentiel", { optionnel: true }),
};

/* ─── ADMINISTRATION ───────────────────────────────────────── */

export interface StatsAdmin {
  utilisateurs: {
    total: number;
    locataires: number;
    proprietaires: number;
    agences: number;
    nouveaux_30j: number;
    par_niveau: Record<string, number>;
  };
  annonces: { total: number; actives: number; certifiees: number; louees: number };
  mises_en_relation: { total: number; en_attente: number; acceptees: number; conclues: number };
  revenus: {
    total_encaisse: number;
    commissions: number;
    nb_paiements: number;
    fonds_de_tiers_historiques: number;
    devise: string;
  };
  file_de_verification: {
    cni_en_attente: number;
    revenus_en_attente: number;
    annonces_en_attente: number;
    paiements_a_rembourser: number;
  };
  avis: { total: number };
}

/**
 * Liens temporaires vers les pièces d'un passeport, valables quelques
 * minutes. `null` : la pièce existe mais le lien n'a pas pu être signé.
 */
export type PiecesPasseport = Partial<Record<TypeDocument, string | null>>;

/** Pourquoi un paiement encaissé doit être rendu. */
export type MotifRemboursement = "hors_plateforme" | "doublon";

export const adminAPI = {
  stats: () => api.get<StatsAdmin>("/admin/stats"),

  cniEnAttente: () =>
    api.get<{ user: User; passport: TenantPassport | null; pieces: PiecesPasseport }[]>(
      "/admin/cni-pending",
    ),

  validerCNI: (userId: string, approuve: boolean, motif?: string) =>
    api.put<{ message: string; trust_level: number; badge: string }>(
      `/admin/verify-cni/${userId}`,
      { approuve, motif },
    ),

  revenusEnAttente: () =>
    api.get<{ passport: TenantPassport; user: User | null; pieces: PiecesPasseport }[]>(
      "/admin/revenus-pending",
    ),

  validerRevenus: (userId: string, approuve: boolean, motif?: string) =>
    api.put<{ message: string; trust_level: number }>(`/admin/verify-revenus/${userId}`, {
      approuve,
      motif,
    }),

  certificationsEnAttente: () =>
    api.get<(Listing & { documents: (string | null)[]; demande_le?: string })[]>(
      "/admin/certifications-pending",
    ),

  certifier: (listingId: string, approuve: boolean, motif?: string) =>
    api.put<{ message: string; listing: Listing }>(`/admin/certifier/${listingId}`, {
      approuve,
      motif,
    }),

  paiementsARembourser: () =>
    api.get<(Payment & { motif: MotifRemboursement; cinetpay_transaction_id: string | null })[]>(
      "/admin/paiements-a-rembourser",
    ),

  marquerRembourse: (paymentId: string, reference_remboursement?: string) =>
    api.put<{ message: string; paiement: Payment }>(`/admin/paiements/${paymentId}/rembourse`, {
      reference_remboursement,
    }),

  utilisateurs: (filtres: { role?: Role; q?: string; page?: number } = {}) =>
    api.get<{ users: User[]; total: number; pages: number; page: number }>(
      `/admin/users${queryString(filtres)}`,
    ),

  basculerStatut: (userId: string, is_active: boolean) =>
    api.put<{ message: string; user: User }>(`/admin/users/${userId}/statut`, { is_active }),
};

export { BASE_URL, tokens as jetons };
