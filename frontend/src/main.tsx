import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { initialiserNatif } from "./lib/natif";
import { surveillerModulesIntrouvables } from "./pwa/rechargement";
import "./styles/index.css";

// Sans effet sur le site web : seulement dans l'application Android.
void initialiserNatif();
// Espace chargé à la demande introuvable après un déploiement : un rechargement.
surveillerModulesIntrouvables();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
