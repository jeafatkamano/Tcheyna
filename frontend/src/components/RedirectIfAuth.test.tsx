/**
 * Garde de la connexion et de l'inscription (lot 3.14) : un utilisateur déjà
 * connecté va dans son espace, mais juste après une inscription la garde suit
 * la destination fixée par RegisterPage (code SMS, onboarding), même si la
 * session est renseignée avant que la page ait navigué.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../api";

const session = vi.hoisted(() => ({ user: null as User | null, ecouteurs: new Set<() => void>() }));

vi.mock("../context/AuthContext", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useAuth: () => {
      const [, forcer] = useState(0);
      useEffect(() => {
        const ecouteur = () => forcer((n) => n + 1);
        session.ecouteurs.add(ecouteur);
        return () => {
          session.ecouteurs.delete(ecouteur);
        };
      }, []);
      return {
        user: session.user,
        chargement: false,
        accueilDuRole: (role?: string) => (role === "tenant" ? "/tenant/dashboard" : "/owner/dashboard"),
        // Comme AuthContext : la session est renseignée avant que la promesse se résolve.
        inscrire: async (d: { role: User["role"] }) => {
          session.user = { id: "u1", role: d.role } as User;
          session.ecouteurs.forEach((e) => e());
          return session.user;
        },
      };
    },
  };
});
vi.mock("../hooks/useGeo", () => ({ useGeo: () => ({ villes: ["Conakry"], quartiers: [] }) }));

const { RedirectIfAuth } = await import("./RedirectIfAuth");
const { RegisterPage } = await import("../pages/RegisterPage");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

function Destination() {
  const { pathname } = useLocation();
  return <p>Destination {pathname}</p>;
}

beforeEach(() => {
  session.user = null;
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

function ouvrir(chemin: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/inscription",
        element: (
          <RedirectIfAuth>
            <RegisterPage />
          </RedirectIfAuth>
        ),
      },
      { path: "*", Component: Destination },
    ],
    { initialEntries: [chemin] },
  );
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return router;
}

function saisir(id: string, valeur: string) {
  const el = conteneur.querySelector<HTMLInputElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, valeur);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function soumettre() {
  await act(async () => {
    conteneur.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function inscrire(phone: string) {
  saisir("nom", "Aminata Diallo");
  saisir("email", "aminata@exemple.com");
  saisir("tel", phone);
  await soumettre();
  saisir("mdp", "un-bon-secret");
  act(() => conteneur.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await soumettre();
}

describe("RedirectIfAuth", () => {
  it("utilisateur déjà connecté : son espace", () => {
    session.user = { id: "u1", role: "tenant" } as User;
    const router = ouvrir("/inscription");
    expect(router.state.location.pathname).toBe("/tenant/dashboard");
  });

  it("juste après l'inscription avec un numéro : l'écran du code SMS, pas l'espace", async () => {
    const router = ouvrir("/inscription?role=tenant");
    await inscrire("622 52 92 52");
    expect(router.state.location.pathname).toBe("/inscription/verification");
    expect(router.state.location.state).toEqual({ suite: "/onboarding/tenant" });
  });

  it("juste après l'inscription sans numéro : l'onboarding du rôle", async () => {
    const router = ouvrir("/inscription?role=landlord");
    await inscrire("");
    expect(router.state.location.pathname).toBe("/onboarding/owner");
  });

  it("la destination ne survit pas à la page : une visite suivante, connecté, mène à l'espace", async () => {
    const router = ouvrir("/inscription?role=tenant");
    await inscrire("622 52 92 52");
    act(() => racine?.unmount());

    const second = ouvrir("/inscription");
    expect(second.state.location.pathname).toBe("/tenant/dashboard");
    expect(router).toBeDefined();
  });
});
