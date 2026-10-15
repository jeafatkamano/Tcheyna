/// <reference types="vite/client" />
/**
 * client.ts — Couche transport de l'API.
 *
 * Gère l'en-tête d'authentification, le rafraîchissement silencieux du jeton et
 * la remontée des messages d'erreur du backend (qui sont déjà en français).
 *
 * Pensé pour le terrain (3G instable, serveur Render qui dort 30 à 60 s) :
 *   • chaque tentative est bornée à 15 s ;
 *   • un GET qui échoue pour une raison réseau (coupure, délai, 502/503/504)
 *     est rejoué deux fois, après 1 s puis 3 s. Jamais un POST, un PUT ni un
 *     DELETE : ils peuvent avoir abouti côté serveur malgré l'erreur, et les
 *     rejouer créerait un doublon (annonce, message, paiement) ;
 *   • une coupure pendant le rafraîchissement du jeton ne déconnecte pas :
 *     seul un refus explicite du serveur (401/403) met fin à la session.
 */

export const BASE_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

/** Durée maximale d'une tentative de requête JSON. */
export const DELAI_REQUETE_MS = 15_000;
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

/**
 * `fetch` borné dans le temps. `AbortSignal.any` et `AbortSignal.timeout`
 * seraient plus courts, mais manquent aux WebView Android encore répandues :
 * le signal de l'appelant est relayé à la main.
 */
async function fetchBorne(
  url: string,
  init: RequestInit,
  signalAppelant?: AbortSignal | null,
  delaiMs = DELAI_REQUETE_MS,
): Promise<Response> {
  if (signalAppelant?.aborted) throw erreurAnnulation();

  const controleur = new AbortController();
  let delaiDepasse = false;
  const minuterie = setTimeout(() => {
    delaiDepasse = true;
    controleur.abort();
  }, delaiMs);
  const relayer = () => controleur.abort();
  signalAppelant?.addEventListener("abort", relayer);

  try {
    return await fetch(url, { ...init, signal: controleur.signal });
  } catch {
    if (signalAppelant?.aborted) throw erreurAnnulation();
    throw erreurReseau(delaiDepasse ? "delai" : "reseau");
  } finally {
    clearTimeout(minuterie);
    signalAppelant?.removeEventListener("abort", relayer);
  }
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
let rafraichissementEnCours: Promise<boolean> | null = null;

async function rafraichirJeton(): Promise<boolean> {
  const refresh = tokens.refresh();
  if (!refresh) return false;

  const res = await fetchBorne(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refresh}` },
  });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) {
    // 5xx, 429… : le serveur n'a pas jugé la session, on la garde.
    const corps = await res.json().catch(() => null);
    throw new ApiError(corps?.error ?? messageStatut(res.status), res.status, corps);
  }
  const data = await res.json();
  tokens.set(data.access_token);
  return true;
}

function rafraichirUneFois(): Promise<boolean> {
  rafraichissementEnCours ??= rafraichirJeton().finally(() => {
    rafraichissementEnCours = null;
  });
  return rafraichissementEnCours;
}

function deconnecter() {
  tokens.clear();
  // Sur les pages publiques, inutile de rediriger vers la connexion.
  const publiques = ["/", "/login", "/inscription"];
  if (!publiques.includes(window.location.pathname)) {
    window.location.href = "/login";
  }
}

function sessionExpiree() {
  return new ApiError("Session expirée, veuillez vous reconnecter", 401);
}

function messageStatut(statut: number): string {
  if (statut === 413) return "Fichier trop lourd pour le serveur.";
  if (statut >= 502 && statut <= 504) {
    return "Le serveur démarre ou est indisponible. Réessayez dans un instant.";
  }
  return `Erreur ${statut}`;
}

/* ─── Requêtes JSON ────────────────────────────────────────── */

interface Options extends RequestInit {
  /** Requête tolérant l'absence de jeton (recherche publique, page d'accueil). */
  optionnel?: boolean;
}

async function executer(endpoint: string, options: Options): Promise<Response> {
  // `optionnel` n'est pas une option de fetch, qui l'ignore.
  const { signal, ...init } = options;
  const jeton = tokens.access();
  const estFormData = init.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(estFormData ? {} : { "Content-Type": "application/json" }),
    ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  // Pièces et avatar passent encore par ici (8 Mo, non compressés) : leur
  // délai suit leur poids, les 15 s ne valent que pour les requêtes JSON.
  const delai = estFormData ? delaiEnvoi(poidsFormulaire(init.body as FormData)) : DELAI_REQUETE_MS;
  return fetchBorne(`${BASE_URL}${endpoint}`, { ...init, headers }, signal, delai);
}

/** Une tentative : requête, puis au besoin rafraîchissement et seconde exécution. */
async function tentative<T>(endpoint: string, options: Options): Promise<T> {
  let res = await executer(endpoint, options);

  // Jeton expiré : on tente un rafraîchissement, puis on rejoue une seule fois.
  // Ce rejeu fait partie de la tentative : il ne compte pas comme une reprise.
  if (res.status === 401 && tokens.refresh()) {
    const rafraichi = await rafraichirUneFois();
    if (rafraichi) {
      res = await executer(endpoint, options);
    } else if (!options.optionnel) {
      deconnecter();
      throw sessionExpiree();
    }
  }

  if (res.status === 401 && !options.optionnel) {
    deconnecter();
    throw sessionExpiree();
  }

  if (!res.ok) {
    const corps = await res.json().catch(() => null);
    throw new ApiError(corps?.error ?? messageStatut(res.status), res.status, corps);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Erreurs passagères : coupure, délai dépassé, serveur en cours de réveil. */
function estPassagere(err: unknown): boolean {
  return err instanceof ApiError && (err.statut === 0 || (err.statut >= 502 && err.statut <= 504));
}

export async function request<T>(endpoint: string, options: Options = {}): Promise<T> {
  const methode = (options.method ?? "GET").toUpperCase();
  // Seul un GET se rejoue sans risque : voir l'en-tête du fichier.
  const pauses = methode === "GET" ? PAUSES_REPRISE_MS : [];

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
    if (await rafraichirUneFois()) {
      options.onProgression?.(0);
      reponse = await envoyerXhr(endpoint, form, options);
    } else {
      deconnecter();
      throw sessionExpiree();
    }
  }
  if (reponse.statut === 401) {
    deconnecter();
    throw sessionExpiree();
  }

  let corps: unknown = null;
  try {
    corps = reponse.texte ? JSON.parse(reponse.texte) : null;
  } catch {
    corps = null;
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
