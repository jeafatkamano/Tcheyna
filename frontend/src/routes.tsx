/**
 * routes.tsx — Plan de navigation.
 *
 * Les routes applicatives passent par `RequireAuth`, qui redirige vers la
 * connexion et empêche un rôle d'accéder à l'espace d'un autre.
 */
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import type { ReactNode } from "react";

import type { Role } from "./api";
import { Chargement } from "./components/Etats";
import { Layout } from "./components/Layout";
import { useAuth } from "./context/AuthContext";

import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { Landing } from "./pages/Landing";
import { ListingDetail } from "./pages/ListingDetail";
import { LoginPage } from "./pages/LoginPage";
import { NotFound } from "./pages/NotFound";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OnboardingOwner } from "./pages/OnboardingOwner";
import { OnboardingTenant } from "./pages/OnboardingTenant";
import { OwnerDashboard } from "./pages/owner/OwnerDashboard";
import { OwnerListingForm } from "./pages/owner/OwnerListingForm";
import { OwnerListings } from "./pages/owner/OwnerListings";
import { OwnerMatches } from "./pages/owner/OwnerMatches";
import { OwnerProfile } from "./pages/owner/OwnerProfile";
import { PaiementsPage } from "./pages/PaiementsPage";
import { RecuPage } from "./pages/RecuPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ConversationPage } from "./pages/shared/ConversationPage";
import { MessagesList } from "./pages/shared/MessagesList";
import { TenantProfileView } from "./pages/shared/TenantProfileView";
import { FavorisPage } from "./pages/tenant/FavorisPage";
import { ListingsPage } from "./pages/tenant/ListingsPage";
import { TenantDashboard } from "./pages/tenant/TenantDashboard";
import { TenantMatches } from "./pages/tenant/TenantMatches";
import { TenantProfile } from "./pages/tenant/TenantProfile";

// ─── Gardes ──────────────────────────────────────────────────

function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, chargement } = useAuth();
  const location = useLocation();

  if (chargement) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement />
      </div>
    );
  }

  if (!user) {
    // On mémorise la destination pour y revenir après connexion.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    const accueil = { tenant: "/tenant/dashboard", landlord: "/owner/dashboard", agency: "/owner/dashboard", admin: "/admin" }[user.role];
    return <Navigate to={accueil} replace />;
  }

  return <>{children}</>;
}

/** Empêche un utilisateur déjà connecté de revoir la connexion ou l'inscription. */
function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, chargement } = useAuth();
  if (chargement) return null;
  if (user) {
    const accueil = { tenant: "/tenant/dashboard", landlord: "/owner/dashboard", agency: "/owner/dashboard", admin: "/admin" }[user.role];
    return <Navigate to={accueil} replace />;
  }
  return <>{children}</>;
}

function EspaceProtege({ roles }: { roles?: Role[] }) {
  return (
    <RequireAuth roles={roles}>
      <Layout />
    </RequireAuth>
  );
}

// ─── Plan de routes ──────────────────────────────────────────

export const router = createBrowserRouter([
  { path: "/", Component: Landing },
  {
    path: "/login",
    element: (
      <RedirectIfAuth>
        <LoginPage />
      </RedirectIfAuth>
    ),
  },
  {
    path: "/inscription",
    element: (
      <RedirectIfAuth>
        <RegisterPage />
      </RedirectIfAuth>
    ),
  },
  { path: "/onboarding/tenant", Component: OnboardingTenant },
  { path: "/onboarding/owner", Component: OnboardingOwner },

  // Fiche annonce : consultable sans compte, avec CTA d'inscription.
  { path: "/listing/:id", Component: ListingDetail },

  // ─── Espace locataire ──────────────────────────────────────
  {
    path: "/tenant",
    element: <EspaceProtege roles={["tenant"]} />,
    children: [
      { index: true, element: <Navigate to="/tenant/dashboard" replace /> },
      { path: "dashboard", Component: TenantDashboard },
      { path: "listings", Component: ListingsPage },
      { path: "matches", Component: TenantMatches },
      { path: "favoris", Component: FavorisPage },
      { path: "profile", Component: TenantProfile },
    ],
  },

  // ─── Espace propriétaire / agence ──────────────────────────
  {
    path: "/owner",
    element: <EspaceProtege roles={["landlord", "agency"]} />,
    children: [
      { index: true, element: <Navigate to="/owner/dashboard" replace /> },
      { path: "dashboard", Component: OwnerDashboard },
      { path: "listings", Component: OwnerListings },
      { path: "listings/nouveau", Component: OwnerListingForm },
      { path: "listings/:id", Component: OwnerListingForm },
      { path: "matches", Component: OwnerMatches },
      { path: "profile", Component: OwnerProfile },
    ],
  },

  // ─── Espace administrateur ─────────────────────────────────
  {
    path: "/admin",
    element: <EspaceProtege roles={["admin"]} />,
    children: [
      { index: true, Component: AdminDashboard },
      { path: "users", Component: AdminUsers },
    ],
  },

  // ─── Pages communes à tous les rôles connectés ─────────────
  {
    element: <EspaceProtege />,
    children: [
      { path: "/messages", Component: MessagesList },
      { path: "/notifications", Component: NotificationsPage },
      { path: "/paiements", Component: PaiementsPage },
      { path: "/paiements/:id", Component: RecuPage },
      { path: "/profil/:id", Component: TenantProfileView },
    ],
  },

  // Le fil de discussion occupe tout l'écran : pas de coque de navigation.
  {
    path: "/messages/:matchId",
    element: (
      <RequireAuth>
        <ConversationPage />
      </RequireAuth>
    ),
  },

  { path: "*", Component: NotFound },
]);
