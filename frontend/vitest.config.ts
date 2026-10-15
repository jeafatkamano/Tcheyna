// vitest.config.ts — Tests unitaires du frontend (npm test).
//
// happy-dom fournit localStorage, XMLHttpRequest, AbortController et
// document : de quoi tester le client HTTP, la file d'envoi des photos et les
// calculs de compression. Pas de vrai canvas ni de createImageBitmap : la
// compression elle-même se vérifie sur un vrai téléphone (cf. PR du lot 1.7).
// Aucun accès réseau : `fetch` et XMLHttpRequest sont simulés dans chaque test.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // Page publique : une déconnexion simulée n'essaie pas de naviguer.
    environmentOptions: { happyDOM: { url: "http://localhost/" } },
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
