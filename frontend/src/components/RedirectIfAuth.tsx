/**
 * RedirectIfAuth.tsx — Empêche un utilisateur déjà connecté de revoir la
 * connexion ou l'inscription (déplacé de routes.tsx au lot 3.14, pour être
 * testé).
 *
 * Juste après une inscription, la session est renseignée avant que la page
 * ait navigué : la garde suit alors la destination fixée par RegisterPage
 * (code SMS ou onboarding) au lieu de l'espace du rôle.
 */
import type { ReactNode } from "react";
import { Navigate } from "react-router";

import { useAuth } from "../context/AuthContext";
import { destinationApresInscription } from "../lib/apresInscription";

export function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, chargement, accueilDuRole } = useAuth();
  if (chargement) return null;
  if (user) {
    const apres = destinationApresInscription();
    if (apres) return <Navigate to={apres.vers} state={apres.state} replace />;
    return <Navigate to={accueilDuRole(user.role)} replace />;
  }
  return <>{children}</>;
}
