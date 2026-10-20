/**
 * sw.ts — Service worker du site (vite-plugin-pwa, stratégie injectManifest).
 *
 * • L'interface (JS, CSS, HTML, icônes ; pas les photos du hero) est
 *   précachée : le site s'ouvre sans réseau et pendant le réveil de l'API
 *   Render, et affiche ses propres messages « Connexion lente ou absente ».
 *   Les espaces admin et propriétaire sont exclus du précache
 *   (vite.config.ts) : ils se téléchargent à la première visite.
 * • Lectures publiques seulement (src/pwa/regles.ts) : stale-while-revalidate,
 *   la version en cache s'affiche tout de suite et se rafraîchit derrière.
 * • Une nouvelle version attend l'accord de l'utilisateur (bandeau
 *   « Nouvelle version disponible ») : rien ne recharge la page sans lui.
 *
 * Jamais enregistré dans l'application Android (voir src/pwa/MiseAJourPwa.tsx).
 */
/// <reference lib="webworker" />
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import type { WorkboxPlugin } from "workbox-core/types";

import { cachePublic } from "../src/pwa/regles";

declare const self: ServiceWorkerGlobalScope;

const JOUR = 24 * 60 * 60;
const CACHE_ANNONCES = "tcheyna-annonces";

/**
 * Annonce retirée ou masquée : la revérification reçoit 404/410, que
 * CacheableResponsePlugin ne garde pas. Sans ce plugin, l'ancienne copie
 * resterait servie jusqu'à son expiration (7 jours).
 */
const oublierAnnonceRetiree: WorkboxPlugin = {
  async fetchDidSucceed({ request, response }) {
    if (response.status === 404 || response.status === 410) {
      const cache = await caches.open(CACHE_ANNONCES);
      await cache.delete(request);
    }
    return response;
  },
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Application monopage : toute navigation reçoit index.html (comme la règle
// de réécriture de render.yaml), servi depuis le précache.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/uploads\//],
  }),
);

const API = new URL(import.meta.env.VITE_API_URL ?? "/api", self.location.origin);

registerRoute(
  ({ request, url }) => cachePublic(request, url, API) === "annonces",
  new StaleWhileRevalidate({
    cacheName: CACHE_ANNONCES,
    plugins: [
      oublierAnnonceRetiree,
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * JOUR }),
    ],
  }),
);

registerRoute(
  ({ request, url }) => cachePublic(request, url, API) === "photos",
  new StaleWhileRevalidate({
    cacheName: "tcheyna-photos",
    plugins: [
      // 0 : réponse « opaque » d'une <img> vers Supabase (autre origine).
      // Chrome compte chacune ~7 Mo dans le quota : 50 photos au plus.
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * JOUR, purgeOnQuotaError: true }),
    ],
  }),
);

// Filet de sécurité : une navigation que ni le précache ni le réseau ne
// peuvent servir (précache incomplet) reçoit une page simple en français.
// En temps normal, hors ligne, c'est l'interface précachée qui s'affiche.
setCatchHandler(async ({ request }) => {
  if (request.destination === "document") {
    return (await matchPrecache("hors-ligne.html")) ?? Response.error();
  }
  return Response.error();
});

// Envoyé par le bandeau de mise à jour (virtual:pwa-register).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
