/**
 * regles.ts — Ce que le service worker a le droit de mettre en cache.
 *
 * Seules les lectures publiques sont gardées hors ligne : la liste et le
 * détail des annonces, et les photos d'annonce. Tout le reste (compte,
 * paiements, messages, admin, pièces privées) passe toujours par le réseau.
 * Une requête qui porte un en-tête Authorization n'est jamais mise en cache,
 * même vers une route publique : sa réponse peut dépendre de l'utilisateur.
 *
 * Module pur, partagé par le service worker (sw/sw.ts) et ses tests.
 */

export type CachePublic = "annonces" | "photos";

interface RequeteLue {
  method: string;
  headers: Headers;
}

/** Liste des annonces : GET /listings/ (filtres en query string). */
const LISTE = /^\/listings\/?$/;
/** Détail d'une annonce : GET /listings/<id>, sans sous-ressource. */
const DETAIL = /^\/listings\/([^/]+)\/?$/;
/** Sous-chemins de /listings qui ne sont pas des identifiants d'annonce. */
const PAS_UNE_ANNONCE = new Set(["recommandations", "mes-annonces"]);

/**
 * Photos d'annonce : bucket public Supabase `tcheyna-photos`
 * (SUPABASE_BUCKET_PUBLIC dans render.yaml), dossier `photos/`, fichiers
 * `annonce-…` (backend/app/routes/listings.py). Le bucket privé
 * `tcheyna-documents` ne correspond jamais.
 */
const PHOTO_SUPABASE = /^\/storage\/v1\/object\/public\/tcheyna-photos\/photos\/annonce-[^/]+$/;
/** Photos d'annonce servies par l'API en développement (stockage disque). */
const PHOTO_DISQUE = /^\/uploads\/annonce-[^/]+$/;

/**
 * Nom du cache où ranger la réponse, ou `null` pour ne jamais la cacher.
 * `api` est l'URL absolue de l'API (VITE_API_URL résolue).
 */
export function cachePublic(requete: RequeteLue, url: URL, api: URL): CachePublic | null {
  if (requete.method !== "GET") return null;
  if (requete.headers.has("Authorization")) return null;

  if (url.origin === api.origin) {
    const prefixe = api.pathname.replace(/\/+$/, "");
    if (url.pathname.startsWith(`${prefixe}/`)) {
      const chemin = url.pathname.slice(prefixe.length);
      if (LISTE.test(chemin)) return "annonces";
      const detail = DETAIL.exec(chemin);
      if (detail && !PAS_UNE_ANNONCE.has(detail[1])) return "annonces";
      return null;
    }
    if (PHOTO_DISQUE.test(url.pathname)) return "photos";
    return null;
  }

  if (url.hostname.endsWith(".supabase.co") && PHOTO_SUPABASE.test(url.pathname)) {
    return "photos";
  }
  return null;
}
