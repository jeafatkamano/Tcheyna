import { describe, expect, it } from "vitest";

import { cachePublic } from "./regles";

const API = new URL("https://tcheyna-api.onrender.com/api");
const SUPABASE = "https://abcdefgh.supabase.co/storage/v1/object/public";

function lire(url: string, options: { method?: string; jeton?: boolean } = {}) {
  const headers = new Headers();
  if (options.jeton) headers.set("Authorization", "Bearer x.y.z");
  return cachePublic({ method: options.method ?? "GET", headers }, new URL(url), API);
}

describe("cachePublic — lectures publiques mises en cache", () => {
  it.each([
    "https://tcheyna-api.onrender.com/api/listings/",
    "https://tcheyna-api.onrender.com/api/listings/?ville=Conakry&page=2",
    "https://tcheyna-api.onrender.com/api/listings/42",
    "https://tcheyna-api.onrender.com/api/listings/3f2b9c1e-uuid",
  ])("annonces : %s", (url) => {
    expect(lire(url)).toBe("annonces");
  });

  it.each([
    `${SUPABASE}/tcheyna-photos/photos/annonce-42-ab12cd34ef56.webp`,
    "https://tcheyna-api.onrender.com/uploads/annonce-42-ab12cd34ef56.webp",
  ])("photos d'annonce : %s", (url) => {
    expect(lire(url)).toBe("photos");
  });

  it("API relative (développement) : résolue sur l'origine du site", () => {
    const api = new URL("/api", "http://localhost:5173");
    const url = new URL("http://localhost:5173/api/listings/?page=1");
    expect(cachePublic({ method: "GET", headers: new Headers() }, url, api)).toBe("annonces");
  });
});

describe("cachePublic — jamais de cache", () => {
  it("une requête avec un en-tête Authorization, même vers une route publique", () => {
    expect(lire("https://tcheyna-api.onrender.com/api/listings/", { jeton: true })).toBeNull();
    expect(lire("https://tcheyna-api.onrender.com/api/listings/42", { jeton: true })).toBeNull();
    expect(
      lire(`${SUPABASE}/tcheyna-photos/photos/annonce-42-ab12cd34ef56.webp`, { jeton: true }),
    ).toBeNull();
  });

  it.each(["POST", "PUT", "DELETE"])("une écriture (%s)", (method) => {
    expect(lire("https://tcheyna-api.onrender.com/api/listings/", { method })).toBeNull();
  });

  it.each([
    // Routes authentifiées ou personnelles
    "https://tcheyna-api.onrender.com/api/listings/recommandations?limite=6",
    "https://tcheyna-api.onrender.com/api/listings/mes-annonces",
    "https://tcheyna-api.onrender.com/api/listings/42/documents",
    "https://tcheyna-api.onrender.com/api/listings/42/photos",
    "https://tcheyna-api.onrender.com/api/auth/me",
    "https://tcheyna-api.onrender.com/api/users/me",
    // Paiements, messages, admin
    "https://tcheyna-api.onrender.com/api/payments/",
    "https://tcheyna-api.onrender.com/api/payments/callback",
    "https://tcheyna-api.onrender.com/api/messages/12",
    "https://tcheyna-api.onrender.com/api/matches/",
    "https://tcheyna-api.onrender.com/api/admin/diagnostic",
    "https://tcheyna-api.onrender.com/api/favorites/",
    "https://tcheyna-api.onrender.com/api/notifications/",
    // Fichiers privés ou hors photos d'annonce
    `${SUPABASE}/tcheyna-documents/documents/propriete-42-ab12cd34ef56.pdf`,
    `${SUPABASE}/tcheyna-photos/avatars/profil-7-ab12cd34ef56.webp`,
    "https://tcheyna-api.onrender.com/uploads/propriete-42-ab12cd34ef56.pdf",
    "https://tcheyna-api.onrender.com/uploads/profil-7-ab12cd34ef56.webp",
    // Même chemin, autre hôte : pas notre API ni notre stockage
    "https://exemple.test/api/listings/",
    "https://exemple.test/storage/v1/object/public/tcheyna-photos/photos/annonce-1-a.webp",
  ])("%s", (url) => {
    expect(lire(url)).toBeNull();
  });
});
