/**
 * espaces.tsx — Pages des espaces, chargées à la demande (routes.tsx).
 *
 * Un fichier JS par espace (pages/<espace>/espace-<nom>.ts), téléchargé à la
 * première visite de l'espace : le premier chargement en 3G n'embarque que
 * l'accueil, les annonces publiques, la connexion et l'inscription.
 */
import { lazy } from "react";

const locataire = () => import("./tenant/espace-locataire");
const proprietaire = () => import("./owner/espace-proprietaire");
const admin = () => import("./admin/espace-admin");
const legal = () => import("./legal/espace-legal");
const motDePasseOublie = () => import("./MotDePasseOubliePage");

export const TenantDashboard = lazy(() => locataire().then((m) => ({ default: m.TenantDashboard })));
export const ListingsPage = lazy(() => locataire().then((m) => ({ default: m.ListingsPage })));
export const TenantMatches = lazy(() => locataire().then((m) => ({ default: m.TenantMatches })));
export const FavorisPage = lazy(() => locataire().then((m) => ({ default: m.FavorisPage })));
export const TenantProfile = lazy(() => locataire().then((m) => ({ default: m.TenantProfile })));

export const OwnerDashboard = lazy(() => proprietaire().then((m) => ({ default: m.OwnerDashboard })));
export const OwnerListings = lazy(() => proprietaire().then((m) => ({ default: m.OwnerListings })));
export const OwnerListingForm = lazy(() =>
  proprietaire().then((m) => ({ default: m.OwnerListingForm })),
);
export const OwnerMatches = lazy(() => proprietaire().then((m) => ({ default: m.OwnerMatches })));
export const OwnerProfile = lazy(() => proprietaire().then((m) => ({ default: m.OwnerProfile })));

export const AdminDashboard = lazy(() => admin().then((m) => ({ default: m.AdminDashboard })));
export const AdminUsers = lazy(() => admin().then((m) => ({ default: m.AdminUsers })));

export const CGU = lazy(() => legal().then((m) => ({ default: m.CGU })));
export const Confidentialite = lazy(() => legal().then((m) => ({ default: m.Confidentialite })));
export const MentionsLegales = lazy(() => legal().then((m) => ({ default: m.MentionsLegales })));

// Présentation du premier lancement : utile à l'application seulement, hors
// du premier chargement du site.
export const Bienvenue = lazy(() => import("./Bienvenue").then((m) => ({ default: m.Bienvenue })));

// Rarement utile : hors du premier chargement, comme les espaces.
export const MotDePasseOubliePage = lazy(() =>
  motDePasseOublie().then((m) => ({ default: m.MotDePasseOubliePage })),
);
