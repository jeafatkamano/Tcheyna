/**
 * Route « / » (lot 3.13) : Landing sur le site ; dans l'application, espace
 * du rôle, présentation ou connexion selon la session et la mémorisation.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../api";

const natif = vi.hoisted(() => ({ actif: true }));
const session = vi.hoisted(() => ({
  user: null as User | null,
  chargement: false,
  erreurSession: null as string | null,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => natif.actif },
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    ...session,
    reessayerSession: vi.fn(),
    accueilDuRole: (role?: string) => (role === "tenant" ? "/tenant/dashboard" : "/owner/dashboard"),
  }),
}));
vi.mock("./Landing", () => ({ Landing: () => <p>Page d'accueil du site</p> }));

const { Entree } = await import("./Entree");
const { CLE_PRESENTATION } = await import("../lib/presentation");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  natif.actif = true;
  session.user = null;
  session.chargement = false;
  session.erreurSession = null;
  localStorage.clear();
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function ouvrir() {
  const router = createMemoryRouter(
    [
      { path: "/", Component: Entree },
      { path: "/bienvenue", element: <p>Présentation</p> },
      { path: "/login", element: <p>Connexion</p> },
      { path: "/tenant/dashboard", element: <p>Espace locataire</p> },
      { path: "/owner/dashboard", element: <p>Espace propriétaire</p> },
    ],
    { initialEntries: ["/"] },
  );
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return { conteneur, router };
}

describe("Entree, dans l'application", () => {
  it("connecté : l'espace du rôle", () => {
    session.user = { id: "u1", role: "landlord" } as User;
    const { conteneur, router } = ouvrir();
    expect(router.state.location.pathname).toBe("/owner/dashboard");
    expect(conteneur.textContent).toBe("Espace propriétaire");
  });

  it("non connecté, présentation pas encore vue : /bienvenue", () => {
    const { router } = ouvrir();
    expect(router.state.location.pathname).toBe("/bienvenue");
  });

  it("non connecté, présentation déjà vue : /login", () => {
    localStorage.setItem(CLE_PRESENTATION, "1");
    const { router } = ouvrir();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("stockage illisible : la présentation, sans planter", () => {
    localStorage.setItem(CLE_PRESENTATION, "1");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { router } = ouvrir();
    expect(router.state.location.pathname).toBe("/bienvenue");
  });

  it("session en cours de vérification : écran neutre, sans redirection", () => {
    session.chargement = true;
    localStorage.setItem(CLE_PRESENTATION, "1");
    const { conteneur, router } = ouvrir();
    expect(router.state.location.pathname).toBe("/");
    expect(conteneur.querySelector('[aria-label="Tcheyna"]')).not.toBeNull();
    expect(conteneur.textContent).not.toContain("Connexion");
    expect(conteneur.textContent).not.toContain("Page d'accueil du site");
  });

  it("session impossible à vérifier (réseau) : proposition de réessayer, pas de déconnexion", () => {
    session.erreurSession = "Connexion impossible.";
    const { conteneur, router } = ouvrir();
    expect(router.state.location.pathname).toBe("/");
    expect(conteneur.textContent).toContain("Connexion impossible.");
  });
});

describe("Entree, sur le site web", () => {
  it("garde la page d'accueil, connecté ou non, présentation vue ou non", () => {
    natif.actif = false;
    const { conteneur, router } = ouvrir();
    expect(router.state.location.pathname).toBe("/");
    expect(conteneur.textContent).toBe("Page d'accueil du site");
    act(() => racine?.unmount());

    session.user = { id: "u1", role: "tenant" } as User;
    localStorage.setItem(CLE_PRESENTATION, "1");
    const second = ouvrir();
    expect(second.router.state.location.pathname).toBe("/");
    expect(second.conteneur.textContent).toBe("Page d'accueil du site");
  });
});
