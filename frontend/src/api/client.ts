/// <reference types="vite/client" />
/**
 * client.ts — Couche transport de l'API.
 *
 * Gère l'en-tête d'authentification, le rafraîchissement silencieux du jeton et
 * la remontée des messages d'erreur du backend (qui sont déjà en français).
 */

export const BASE_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

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

/** Erreur d'API : porte le statut HTTP pour que l'appelant puisse réagir. */
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

/** Un seul rafraîchissement à la fois, même si plusieurs requêtes échouent ensemble. */
let rafraichissementEnCours: Promise<boolean> | null = null;

async function rafraichirJeton(): Promise<boolean> {
  const refresh = tokens.refresh();
  if (!refresh) return false;

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${refresh}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    tokens.set(data.access_token);
    return true;
  } catch {
    return false;
  }
}

function deconnecter() {
  tokens.clear();
  // Sur les pages publiques, inutile de rediriger vers la connexion.
  const publiques = ["/", "/login", "/inscription"];
  if (!publiques.includes(window.location.pathname)) {
    window.location.href = "/login";
  }
}

interface Options extends RequestInit {
  /** Requête tolérant l'absence de jeton (recherche publique, page d'accueil). */
  optionnel?: boolean;
}

async function executer(endpoint: string, options: Options, avecJeton: boolean): Promise<Response> {
  const jeton = avecJeton ? tokens.access() : null;
  const estFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(estFormData ? {} : { "Content-Type": "application/json" }),
    ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  return fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
}

export async function request<T>(endpoint: string, options: Options = {}): Promise<T> {
  let res = await executer(endpoint, options, true);

  // Jeton expiré : on tente un rafraîchissement, puis on rejoue une seule fois.
  if (res.status === 401 && tokens.refresh()) {
    rafraichissementEnCours ??= rafraichirJeton().finally(() => {
      rafraichissementEnCours = null;
    });
    const rafraichi = await rafraichissementEnCours;

    if (rafraichi) {
      res = await executer(endpoint, options, true);
    } else if (!options.optionnel) {
      deconnecter();
      throw new ApiError("Session expirée, veuillez vous reconnecter", 401);
    }
  }

  if (res.status === 401 && !options.optionnel) {
    deconnecter();
    throw new ApiError("Session expirée, veuillez vous reconnecter", 401);
  }

  if (!res.ok) {
    const corps = await res.json().catch(() => null);
    throw new ApiError(
      corps?.error ?? `Erreur ${res.status}`,
      res.status,
      corps,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
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
