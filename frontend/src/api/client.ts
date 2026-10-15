/// <reference types="vite/client" />
/**
 * client.ts — Couche transport de l'API.
 *
 * Gère l'en-tête d'authentification, le rafraîchissement silencieux du jeton et
 * la remontée des messages d'erreur du backend (qui sont déjà en français).
 *
 * Pensé pour le terrain (3G instable, serveur Render qui dort 30 à 60 s) :
 *   • chaque tentative est bornée, lecture du corps comprise : 15 s pour un
 *     GET, 60 s pour une écriture (comme `gunicorn --timeout 60`) ;
 *   • un GET qui échoue pour une raison réseau (coupure, délai, 502/503/504)
 *     est rejoué deux fois, après 1 s puis 3 s. Jamais un POST, un PUT ni un
 *     DELETE : ils peuvent avoir abouti côté serveur malgré l'erreur, et les
 *     rejouer créerait un doublon (annonce, message, paiement) ;
 *   • une coupure pendant le rafraîchissement du jeton ne déconnecte pas :
 *     seul un refus explicite du serveur (401/403) met fin à la session, et
 *     sa raison est transmise à la page de connexion ;
 *   • un 401 sur la connexion, l'inscription ou le changement de mot de
 *     passe juge les identifiants saisis, jamais la session.
 */

export const BASE_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

/** Durée maximale d'une tentative de requête JSON. */
export const DELAI_REQUETE_MS = 15_000;
/**
 * Durée maximale d'un POST/PUT/DELETE JSON, alignée sur `gunicorn --timeout
 * 60` : une écriture n'est jamais rejouée, mieux vaut attendre sa réponse.
 */
export const DELAI_ECRITURE_MS = 60_000;
/** Pauses avant chaque reprise d'un GET (une entrée par reprise). */
export const PAUSES_REPRISE_MS = [1_000, 3_000];
/**
 * Durée maximale d'un envoi de fichier. Plus longue que pour une requête
 * JSON : 300 Ko en 3G lente prennent déjà une douzaine de secondes, et le
 * serveur peut devoir se réveiller. Alignée sur `gunicorn --timeout 60`.
 */
export const DELAI_ENVOI_FICHIER_MS = 60_000;
/**
 * Débit plancher supposé pour borner un envoi lourd (octets par ms, soit
 * 25 Ko/s ≈ 200 kbit/s, une 3G médiocre) : 8 Mo disposent de 5 min et demie.
 */
const DEBIT_PLANCHER = 25;

/** Délai d'un envoi de fichier, proportionné à son poids. */
export function delaiEnvoi(octets: number): number {
  return Math.max(DELAI_ENVOI_FICHIER_MS, Math.ceil(octets / DEBIT_PLANCHER));
}

function poidsFormulaire(form: FormData): number {
  let total = 0;
  form.forEach((valeur) => {
    total += typeof valeur === "string" ? valeur.length : valeur.size;
  });
  return total;
}

export const MESSAGE_RESEAU =
  "Connexion lente ou absente. Vérifiez votre réseau, puis réessayez.";

const CLE_ACCESS = "tcheyna_access_token";
const CLE_REFRESH = "tcheyna_refresh_token";

export const tokens = {
  access: () => localStorage.getItem(CLE_ACCESS),
  refresh: () => localStorage.getItem(CLE_REFRESH),
  set(access: string, refresh?: string) {
    localStorage.setItem(CLE_ACCESS, access);
    if (refresh) localStorage.setItem(CLE_REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(CLE_ACCESS);
    localStorage.removeItem(CLE_REFRESH);
  },
};

/**
 * Erreur d'API : porte le statut HTTP pour que l'appelant puisse réagir.
 * `statut === 0` signale une erreur de transport (coupure, délai dépassé) :
 * le serveur n'a pas répondu, ou sa réponse s'est perdue.
 */
export class ApiError extends Error {
  statut: number;
  details?: unknown;

  constructor(message: string, statut: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statut = statut;
    this.details = details;
  }
}

/** Vrai si l'erreur vient d'une annulation voulue par l'appelant (démontage…). */
export function estAnnulation(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function erreurReseau(cause: "reseau" | "delai") {
  return new ApiError(MESSAGE_RESEAU, 0, { cause });
}

function erreurAnnulation() {
  return new DOMException("Requête annulée", "AbortError");
}

/** Réponse lue en entier : statut et corps JSON (null si vide ou illisible). */
interface Reponse {
  status: number;
  ok: boolean;
  corps: unknown;
}

/**
 * `fetch` borné dans le temps, **corps compris** : une réponse dont le corps
 * cale en 3G est coupée au même délai que son en-tête. Un corps de succès
 * illisible (réponse tronquée) compte comme une erreur réseau, donc un GET
 * est rejoué.
 *
 * `AbortSignal.any` et `AbortSignal.timeout` seraient plus courts, mais
 * manquent aux WebView Android encore répandues : le signal de l'appelant
 * est relayé à la main.
 */
async function fetchBorne(
  url: string,
  init: RequestInit,
  signalAppelant?: AbortSignal | null,
  delaiMs = DELAI_REQUETE_MS,
): Promise<Reponse> {
  if (signalAppelant?.aborted) throw erreurAnnulation();

  const controleur = new AbortController();
  let delaiDepasse = false;
  const minuterie = setTimeout(() => {
    delaiDepasse = true;
    controleur.abort();
  }, delaiMs);
  const relayer = () => controleur.abort();
  signalAppelant?.addEventListener("abort", relayer);

  let res: Response;
  let texte: string;
  try {
    res = await fetch(url, { ...init, signal: controleur.signal });
    texte = await res.text();
  } catch {
    if (signalAppelant?.aborted) throw erreurAnnulation();
    throw erreurReseau(delaiDepasse ? "delai" : "reseau");
  } finally {
    clearTimeout(minuterie);
    signalAppelant?.removeEventListener("abort", relayer);
  }

  let corps: unknown = null;
  if (texte) {
    try {
      corps = JSON.parse(texte);
    } catch {
      // Succès au corps illisible : réponse tronquée par le réseau. Une page
      // d'erreur HTML (502 d'un proxy) garde en revanche son statut.
      if (res.ok) throw erreurReseau("reseau");
    }
  }
  return { status: res.status, ok: res.ok, corps };
}

/** Attente interrompue par l'annulation de l'appelant. */
function attendre(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(erreurAnnulation());
    const minuterie = setTimeout(() => {
      signal?.removeEventListener("abort", annuler);
      resolve();
    }, ms);
    function annuler() {
      clearTimeout(minuterie);
      reject(erreurAnnulation());
    }
    signal?.addEventListener("abort", annuler, { once: true });
  });
}

/* ─── Session ──────────────────────────────────────────────── */

/**
 * Un seul rafraîchissement à la fois, même si plusieurs requêtes échouent
 * ensemble. Résout `true` (nouveau jeton) ou `false` (refus : la session est
 * finie) ; rejette une `ApiError` si le serveur est injoignable ou en panne,
 * auquel cas les jetons sont conservés.
 */
let rafraichissementEnCours: Promise<Rafraichissement> | null = null;

type Rafraichissement = { ok: true } | { ok: false; raison?: string };

function messageServeur(corps: unknown): string | undefined {
  const erreur = (corps as { error?: unknown } | null)?.error;
  return typeof erreur === "string" ? erreur : undefined;
}

async function rafraichirJeton(): Promise<Rafraichissement> {
  const refresh = tokens.refresh();
  if (!refresh) return { ok: false };

  const res = await fetchBorne(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refresh}` },
  });
  // Refus explicite (session révoquée, compte désactivé) : on garde la raison.
  if (res.status === 401 || res.status === 403) return { ok: false, raison: messageServeur(res.corps) };
  if (!res.ok) {
    // 5xx, 429… : le serveur n'a pas jugé la session, on la garde.
    throw new ApiError(messageServeur(res.corps) ?? messageStatut(res.status), res.status, res.corps);
  }
  tokens.set((res.corps as { access_token: string }).access_token);
  return { ok: true };
}

function rafraichirUneFois(): Promise<Rafraichissement> {
  rafraichissementEnCours ??= rafraichirJeton().finally(() => {
    rafraichissementEnCours = null;
  });
  return rafraichissementEnCours;
}

/** Clé où la raison d'une déconnexion forcée attend la page de connexion. */
export const CLE_MOTIF_DECONNEXION = "tcheyna_motif_deconnexion";

/** Raison de la dernière déconnexion forcée, à montrer sur la page de connexion. */
export function lireMotifDeconnexion(): string | null {
  try {
    return sessionStorage.getItem(CLE_MOTIF_DECONNEXION);
  } catch {
    return null;
  }
}

export function effacerMotifDeconnexion() {
  try {
    sessionStorage.removeItem(CLE_MOTIF_DECONNEXION);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
}

/** Fin de session décidée par le serveur ; renvoie l'erreur à lever. */
function deconnecter(raison?: string): ApiError {
  const message = raison ?? "Session expirée, veuillez vous reconnecter";
  tokens.clear();
  // Sur les pages publiques, inutile de rediriger vers la connexion.
  const publiques = ["/", "/login", "/inscription"];
  if (!publiques.includes(window.location.pathname)) {
    try {
      sessionStorage.setItem(CLE_MOTIF_DECONNEXION, message);
    } catch {
      // Stockage indisponible (navigation privée) : redirection muette.
    }
    window.location.href = "/login";
  }
  return new ApiError(message, 401);
}

function messageStatut(statut: number): string {
  if (statut === 413) return "Fichier trop lourd pour le serveur.";
  if (statut >= 502 && statut <= 504) {
    return "Le serveur démarre ou est indisponible. Réessayez dans un instant.";
  }
  return `Erreur ${statut}`;
}

/**
 * Routes où un 401 juge les identifiants saisis (« Identifiants incorrects »),
 * pas la session : ni rafraîchissement, ni déconnexion, le message du serveur
 * est affiché tel quel. /auth/password n'en fait pas partie : un ancien mot de
 * passe faux y répond 422, donc son 401 signale bien un jeton expiré.
 */
const ROUTES_IDENTIFIANTS = ["/auth/login", "/auth/register"];

function jugeIdentifiants(endpoint: string) {
  const chemin = endpoint.split("?")[0].replace(/\/+$/, "");
  return ROUTES_IDENTIFIANTS.includes(chemin);
}

/* ─── Requêtes JSON ────────────────────────────────────────── */

interface Options extends RequestInit {
  /** Requête tolérant l'absence de jeton (recherche publique, page d'accueil). */
  optionnel?: boolean;
  /** Nombre maximal de reprises d'un GET (2 par défaut). */
  reprises?: number;
}

async function executer(endpoint: string, options: Options): Promise<Reponse> {
  // `optionnel` et `reprises` ne sont pas des options de fetch, qui les ignore.
  const { signal, ...init } = options;
  const jeton = tokens.access();
  const estFormData = init.body instanceof FormData;
  const methode = (init.method ?? "GET").toUpperCase();

  const headers: Record<string, string> = {
    ...(estFormData ? {} : { "Content-Type": "application/json" }),
    ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  // Lecture : 15 s. Écriture : 60 s, comme `gunicorn --timeout 60` ; couper
  // plus tôt laisserait croire à un échec une écriture qui aboutit. Pièces et
  // avatar (8 Mo, non compressés) : délai proportionné au poids.
  const delai = estFormData
    ? delaiEnvoi(poidsFormulaire(init.body as FormData))
    : methode === "GET"
      ? DELAI_REQUETE_MS
      : DELAI_ECRITURE_MS;
  return fetchBorne(`${BASE_URL}${endpoint}`, { ...init, headers }, signal, delai);
}

/** Une tentative : requête, puis au besoin rafraîchissement et seconde exécution. */
async function tentative<T>(endpoint: string, options: Options): Promise<T> {
  let res = await executer(endpoint, options);
  const sessionEnJeu = !jugeIdentifiants(endpoint);

  // Jeton expiré : on tente un rafraîchissement, puis on rejoue une seule fois.
  // Ce rejeu fait partie de la tentative : il ne compte pas comme une reprise.
  if (sessionEnJeu && res.status === 401 && tokens.refresh()) {
    const rafraichi = await rafraichirUneFois();
    if (rafraichi.ok) {
      res = await executer(endpoint, options);
    } else if (!options.optionnel) {
      throw deconnecter(rafraichi.raison);
    }
  }

  if (sessionEnJeu && res.status === 401 && !options.optionnel) {
    throw deconnecter(messageServeur(res.corps));
  }

  if (!res.ok) {
    throw new ApiError(messageServeur(res.corps) ?? messageStatut(res.status), res.status, res.corps);
  }

  if (res.status === 204) return undefined as T;
  return res.corps as T;
}

/** Erreurs passagères : coupure, délai dépassé, serveur en cours de réveil. */
function estPassagere(err: unknown): boolean {
  return err instanceof ApiError && (err.statut === 0 || (err.statut >= 502 && err.statut <= 504));
}

export async function request<T>(endpoint: string, options: Options = {}): Promise<T> {
  const methode = (options.method ?? "GET").toUpperCase();
  // Seul un GET se rejoue sans risque : voir l'en-tête du fichier.
  const pauses = methode === "GET" ? PAUSES_REPRISE_MS.slice(0, options.reprises ?? 2) : [];

  for (let essai = 0; ; essai++) {
    try {
      return await tentative<T>(endpoint, options);
    } catch (err) {
      const pause = pauses[essai];
      if (pause === undefined || !estPassagere(err)) throw err;
      // Aléa de ±30 % : des clients coupés ensemble ne reviennent pas ensemble.
      await attendre(pause * (0.7 + Math.random() * 0.6), options.signal);
    }
  }
}

/* ─── Envoi de fichier avec progression ───────────────────── */

export interface OptionsEnvoi {
  /** Fraction envoyée, de 0 à 1. */
  onProgression?: (fraction: number) => void;
  signal?: AbortSignal;
  delaiMs?: number;
}

/**
 * Envoie un formulaire multipart en suivant la progression. `fetch` ne sait
 * pas mesurer l'envoi : on passe par XMLHttpRequest. Mêmes règles que
 * `request` pour le jeton (rafraîchi puis renvoyé une fois sur 401) et les
 * erreurs (`ApiError`), mais **aucune reprise automatique** : l'ajout d'une
 * photo n'est pas idempotent, la reprise est laissée à l'utilisateur.
 */
export async function envoyerFichier<T>(
  endpoint: string,
  form: FormData,
  options: OptionsEnvoi = {},
): Promise<T> {
  let reponse = await envoyerXhr(endpoint, form, options);

  if (reponse.statut === 401 && tokens.refresh()) {
    const rafraichi = await rafraichirUneFois();
    if (!rafraichi.ok) throw deconnecter(rafraichi.raison);
    options.onProgression?.(0);
    reponse = await envoyerXhr(endpoint, form, options);
  }

  let corps: unknown = null;
  try {
    corps = reponse.texte ? JSON.parse(reponse.texte) : null;
  } catch {
    corps = null;
  }
  if (reponse.statut === 401) throw deconnecter(messageServeur(corps));
  if (reponse.statut >= 200 && reponse.statut < 300 && corps === null) {
    // Succès sans corps lisible : réponse tronquée, sort de la photo inconnu.
    throw erreurReseau("reseau");
  }
  if (reponse.statut < 200 || reponse.statut >= 300) {
    const message =
      reponse.statut === 413
        ? "Photo trop lourde pour le serveur."
        : ((corps as { error?: string } | null)?.error ?? messageStatut(reponse.statut));
    throw new ApiError(message, reponse.statut, corps);
  }
  return corps as T;
}

function envoyerXhr(
  endpoint: string,
  form: FormData,
  { onProgression, signal, delaiMs = delaiEnvoi(poidsFormulaire(form)) }: OptionsEnvoi,
): Promise<{ statut: number; texte: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(erreurAnnulation());

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}${endpoint}`);
    xhr.timeout = delaiMs;
    const jeton = tokens.access();
    if (jeton) xhr.setRequestHeader("Authorization", `Bearer ${jeton}`);

    const annuler = () => xhr.abort();
    const nettoyer = () => signal?.removeEventListener("abort", annuler);
    signal?.addEventListener("abort", annuler, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgression?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      nettoyer();
      resolve({ statut: xhr.status, texte: xhr.responseText });
    };
    xhr.onerror = () => {
      nettoyer();
      // Coupure réseau, ou serveur qui ferme la connexion avant d'avoir lu le
      // corps (413 de Flask) : le navigateur ne voit alors aucune réponse.
      reject(erreurReseau("reseau"));
    };
    xhr.ontimeout = () => {
      nettoyer();
      reject(erreurReseau("delai"));
    };
    xhr.onabort = () => {
      nettoyer();
      reject(erreurAnnulation());
    };

    xhr.send(form);
  });
}

/* ─── Raccourcis ───────────────────────────────────────────── */

export const api = {
  get: <T>(endpoint: string, options: Options = {}) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(endpoint: string, body?: unknown, options: Options = {}) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),

  put: <T>(endpoint: string, body?: unknown, options: Options = {}) =>
    request<T>(endpoint, { ...options, method: "PUT", body: JSON.stringify(body ?? {}) }),

  delete: <T>(endpoint: string, options: Options = {}) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),
};

/** Construit une query string en ignorant les valeurs vides. */
export function queryString(params: object): string {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([cle, valeur]) => {
    if (valeur === undefined || valeur === null || valeur === "" || valeur === false) return;
    usp.append(cle, String(valeur));
  });
  const chaine = usp.toString();
  return chaine ? `?${chaine}` : "";
}

/** Préfixe les URLs relatives renvoyées par le backend (`/uploads/...`). */
export function urlFichier(chemin?: string | null): string | undefined {
  if (!chemin) return undefined;
  if (/^https?:\/\//.test(chemin)) return chemin;
  return `${BASE_URL.replace(/\/api$/, "")}${chemin}`;
}
