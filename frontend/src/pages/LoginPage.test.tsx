/**
 * Connexion (lot 3.14, maquette Connexion) : titre sans émoji, attributs de
 * saisie, flèche de retour selon l'historique, sur le site et dans l'app.
 * La logique (erreurs, succès, retour après connexion) est couverte par
 * MotDePasseOubliePage.test.tsx.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const natif = vi.hoisted(() => ({ actif: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => natif.actif } }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ connecter: vi.fn(), accueilDuRole: () => "/tenant/dashboard" }),
}));

const { LoginPage } = await import("./LoginPage");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  natif.actif = false;
  document.body.innerHTML = "";
});

function ouvrir(entrees: string[]) {
  const router = createMemoryRouter(
    [
      { path: "/login", Component: LoginPage },
      { path: "*", element: <p>Ailleurs</p> },
    ],
    { initialEntries: entrees, initialIndex: entrees.length - 1 },
  );
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return router;
}

const retour = () => conteneur.querySelector<HTMLButtonElement>('button[aria-label="Retour"]');

describe("LoginPage", () => {
  it("titre « Bon retour. » sans émoji ; attributs de saisie", () => {
    ouvrir(["/login"]);
    expect(conteneur.querySelector("h1")?.textContent).toBe("Bon retour.");
    const identifiant = conteneur.querySelector("#identifiant")!;
    expect(identifiant.getAttribute("autocomplete")).toBe("username");
    expect(identifiant.getAttribute("enterkeyhint")).toBe("next");
    const mdp = conteneur.querySelector("#mdp")!;
    expect(mdp.getAttribute("autocomplete")).toBe("current-password");
    expect(mdp.getAttribute("enterkeyhint")).toBe("go");
    expect(conteneur.querySelector('button[aria-label="Afficher le mot de passe"]')).not.toBeNull();
  });

  it("garde les liens existants : mot de passe oublié, inscription, onboarding", () => {
    ouvrir(["/login"]);
    const liens = [...conteneur.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(liens).toEqual(
      expect.arrayContaining(["/mot-de-passe-oublie", "/inscription", "/onboarding/tenant", "/onboarding/owner"]),
    );
  });

  it("avec une page précédente, la flèche y revient", async () => {
    const router = ouvrir(["/bienvenue", "/login"]);
    await act(async () => retour()!.click());
    expect(router.state.location.pathname).toBe("/bienvenue");
  });

  it("premier écran de l'app : pas de flèche ; sur le site : retour à l'accueil", async () => {
    natif.actif = true;
    ouvrir(["/login"]);
    expect(retour()).toBeNull();
    act(() => racine?.unmount());

    natif.actif = false;
    const router = ouvrir(["/login"]);
    await act(async () => retour()!.click());
    expect(router.state.location.pathname).toBe("/");
  });
});
