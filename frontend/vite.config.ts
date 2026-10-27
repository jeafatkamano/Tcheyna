import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Site installable et utilisable hors ligne (lot 3.3). Le service worker
    // est écrit à la main (sw/sw.ts) : ses règles de cache sont testées dans
    // src/pwa/regles.test.ts. Il est enregistré par src/pwa/MiseAJourPwa.tsx,
    // jamais dans l'application Android.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      injectManifest: {
        // JS, CSS et HTML seulement (les icônes du manifest sont ajoutées par
        // le plugin) : les photos du hero existent en deux formats (avif,
        // webp) et le navigateur n'en charge qu'un.
        globPatterns: ["**/*.{js,css,html}"],
        // Espaces admin et propriétaire : réservés à une minorité, ils ne sont
        // pas téléchargés d'avance chez chaque visiteur en 3G.
        globIgnores: ["**/espace-admin-*.js", "**/espace-proprietaire-*.js"],
      },
      manifest: {
        name: "Tcheyna — La location immobilière, en toute confiance",
        short_name: "Tcheyna",
        description: "Location immobilière de confiance à Conakry.",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#1E3A5F",
        background_color: "#F0F4FA",
        // Logo « tcheyna. » (lot 3.11) ; la masquable garde le mot dans le
        // cercle de 80 % que les systèmes peuvent découper.
        icons: [
          { src: "/icons/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icone-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icone-masquable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    // En développement, `/api` est relayé vers Flask : le frontend n'a donc
    // pas besoin de VITE_API_URL en local, et il n'y a pas de problème de CORS.
    proxy: {
      "/api": { target: "http://localhost:5000", changeOrigin: true },
      "/uploads": { target: "http://localhost:5000", changeOrigin: true },
    },
  },

  preview: { host: "0.0.0.0", port: 4173 },

  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Sépare React du code applicatif : le cache navigateur reste valide
        // entre deux déploiements qui ne touchent pas aux dépendances.
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
        },
      },
    },
  },
});
