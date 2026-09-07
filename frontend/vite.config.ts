import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],

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
