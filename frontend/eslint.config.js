// eslint.config.js — Lint du frontend (ESLint 9, configuration « flat »).
//
// ESLint 9 et non 10 : la version 10 exige Node ≥ 20.19, alors que Render et la
// CI construisent avec Node 20.18 (render.yaml).
//
// Le typage strict est déjà assuré par `tsc --noEmit` (npm run typecheck) :
// ESLint se concentre sur ce que le compilateur ne voit pas, en premier lieu
// les règles des hooks React.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    // Un commentaire `eslint-disable` qui ne désactive plus rien doit être
    // retiré : sinon il finirait par masquer un vrai problème.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Les règles « React Compiler » du plugin (refs, set-state-in-effect,
      // preserve-manual-memoization…) sont actives depuis le lot 1.7, qui a
      // réécrit useApi, AuthContext et Layout pour les respecter.
      // Avertissement seulement : un fichier qui exporte aussi un hook ou une
      // constante (useAuth, routes…) recharge la page entière en développement
      // au lieu du seul composant. Sans effet sur le build de production.
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Fichiers de configuration exécutés par Node, pas par le navigateur.
    files: ["vite.config.ts", "vitest.config.ts", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
);
