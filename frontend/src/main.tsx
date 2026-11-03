import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { surveillerReveilServeur } from "./api";
import { initialiserNatif } from "./lib/natif";
import { surveillerModulesIntrouvables } from "./pwa/rechargement";
import "./styles/index.css";

// Le serveur (Render gratuit) dort peut-être : on le réveille dès l'ouverture,
// pendant que la personne lit l'écran ou saisit ses identifiants.
surveillerReveilServeur();
// Sans effet sur le site web : seulement dans l'application Android.
void initialiserNatif();
// Espace chargé à la demande introuvable après un déploiement : un rechargement.
surveillerModulesIntrouvables();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
