/**
 * Entree.tsx — Page de la route « / » (lot 3.13).
 *
 * Sur le site web : la page d'accueil (Landing), comme avant.
 * Dans l'application Android, pas de page d'accueil marketing :
 *   - connecté : l'espace du rôle ;
 *   - sinon, présentation pas encore vue : /bienvenue ;
 *   - sinon : /login.
 * Pendant la vérification de la session, un écran neutre aux couleurs de
 * l'app évite un éclair de la connexion avant l'espace de l'utilisateur.
 */
import { Capacitor } from "@capacitor/core";
import { Navigate } from "react-router";

import { EcranMarque } from "../components/Marque";
import { Erreur } from "../components/Etats";
import { useAuth } from "../context/AuthContext";
import { presentationVue } from "../lib/presentation";
import { Landing } from "./Landing";

export function Entree() {
  if (!Capacitor.isNativePlatform()) return <Landing />;
  return <EntreeApp />;
}

function EntreeApp() {
  const { user, chargement, erreurSession, reessayerSession, accueilDuRole } = useAuth();

  if (chargement) return <EcranMarque />;
  if (user) return <Navigate to={accueilDuRole(user.role)} replace />;
  if (erreurSession) {
    // Réseau absent ou serveur endormi : la session n'est pas perdue, on
    // propose de réessayer plutôt que d'envoyer vers la connexion.
    return (
      <div className="sous-barre-etat min-h-dvh flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Erreur message={erreurSession} onReessayer={reessayerSession} />
      </div>
    );
  }
  return <Navigate to={presentationVue() ? "/login" : "/bienvenue"} replace />;
}
