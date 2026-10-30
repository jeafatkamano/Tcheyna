/**
 * routes.tsx — Plan de navigation.
 *
 * Les routes applicatives passent par `RequireAuth`, qui redirige vers la
 * connexion et empêche un rôle d'accéder à l'espace d'un autre.
 */
import { createBrowserRouter, Navigate, useLocation, type RouteObject } from "react-router";
import { Suspense, type ComponentType, type ReactNode } from "react";

import type { Role } from "./api";
import { Chargement, Erreur, ErreurRoute } from "./components/Etats";
import { Layout } from "./components/Layout";
import { useAuth } from "./context/AuthContext";

import { Bienvenue } from "./pages/Bienvenue";
import { Entree } from "./pages/Entree";
import { ListingDetail } from "./pages/ListingDetail";
import { LoginPage } from "./pages/LoginPage";
import { NotFound } from "./pages/NotFound";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OnboardingOwner } from "./pages/OnboardingOwner";
import { OnboardingTenant } from "./pages/OnboardingTenant";
import { PaiementsPage } from "./pages/PaiementsPage";
import { RecuPage } from "./pages/RecuPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ConversationPage } from "./pages/shared/ConversationPage";
import { MessagesList } from "./pages/shared/MessagesList";
import { TenantProfileView } from "./pages/shared/TenantProfileView";

// Pages des espaces locataire, propriétaire, admin et légal : chargées à la
// demande, un fichier JS par espace (voir pages/espaces.tsx).
import {
  AdminDashboard,
  AdminUsers,
  CGU,
  Confidentialite,
  FavorisPage,
  ListingsPage,
  MentionsLegales,
  MotDePasseOubliePage,
  OwnerDashboard,
  OwnerListingForm,
  OwnerListings,
  OwnerMatches,
  OwnerProfile,
  TenantDashboard,
  TenantMatches,
  TenantProfile,
} from "./pages/espaces";

/** Page chargée à la demande : indicateur de chargement le temps du téléchargement. */
function aLaDemande(Page: ComponentType) {
  return (
    <Suspense
      fallback={
        <div className="py-16 flex items-center justify-center">
          <Chargement />
        </div>
      }
    >
      <Page />
    </Suspense>
  );
}

// ─── Gardes ──────────────────────────────────────────────────

function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, chargement, erreurSession, reessayerSession } = useAuth();
  const location = useLocation();

  if (chargement) {
    return (
      <div className="sous-barre-etat min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement />
      </div>
    );
  }

  if (!user && erreurSession) {
    // Réseau absent ou serveur endormi : la session n'est pas perdue.
    return (
      <div className="sous-barre-etat min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Erreur message={erreurSession} onReessayer={reessayerSession} />
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

const ROUTES: RouteObject[] = [
  // Site : page d'accueil. Application : espace, présentation ou connexion.
  { path: "/", Component: Entree },
  // Présentation du premier lancement (application) ; inoffensive sur le site.
  { path: "/bienvenue", Component: Bienvenue },
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
  // Accessible aussi connecté : une réinitialisation réussie vide alors la
  // session locale, que le serveur vient de révoquer.
  { path: "/mot-de-passe-oublie", element: aLaDemande(MotDePasseOubliePage) },
  { path: "/onboarding/tenant", Component: OnboardingTenant },
  { path: "/onboarding/owner", Component: OnboardingOwner },

  // Fiche annonce : consultable sans compte, avec CTA d'inscription.
  { path: "/listing/:id", Component: ListingDetail },

  // Pages légales : lisibles sans compte, puisqu'il faut les accepter pour en créer un.
  { path: "/legal/cgu", element: aLaDemande(CGU) },
  { path: "/legal/confidentialite", element: aLaDemande(Confidentialite) },
  { path: "/legal/mentions", element: aLaDemande(MentionsLegales) },

  // ─── Espace locataire ──────────────────────────────────────
  {
    path: "/tenant",
    element: <EspaceProtege roles={["tenant"]} />,
    children: [
      { index: true, element: <Navigate to="/tenant/dashboard" replace /> },
      { path: "dashboard", element: aLaDemande(TenantDashboard) },
      { path: "listings", element: aLaDemande(ListingsPage) },
      { path: "matches", element: aLaDemande(TenantMatches) },
      { path: "favoris", element: aLaDemande(FavorisPage) },
      { path: "profile", element: aLaDemande(TenantProfile) },
    ],
  },

  // ─── Espace propriétaire / agence ──────────────────────────
  {
    path: "/owner",
    element: <EspaceProtege roles={["landlord", "agency"]} />,
    children: [
      { index: true, element: <Navigate to="/owner/dashboard" replace /> },
      { path: "dashboard", element: aLaDemande(OwnerDashboard) },
      { path: "listings", element: aLaDemande(OwnerListings) },
      { path: "listings/nouveau", element: aLaDemande(OwnerListingForm) },
      { path: "listings/:id", element: aLaDemande(OwnerListingForm) },
      { path: "matches", element: aLaDemande(OwnerMatches) },
      { path: "profile", element: aLaDemande(OwnerProfile) },
    ],
  },

  // ─── Espace administrateur ─────────────────────────────────
  {
    path: "/admin",
    element: <EspaceProtege roles={["admin"]} />,
    children: [
      { index: true, element: aLaDemande(AdminDashboard) },
      { path: "users", element: aLaDemande(AdminUsers) },
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
];

// Route racine sans chemin : son écran d'erreur, en français, couvre toutes les pages.
export const router = createBrowserRouter([{ errorElement: <ErreurRoute />, children: ROUTES }]);
