/**
 * Tableau de bord propriétaire : publier exige un téléphone vérifié (D3).
 * Le bandeau prévient le bailleur ou l'agence avant qu'il ne commence une
 * annonce, et s'efface une fois le numéro vérifié sur place.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../../api";

const envoyerOTP = vi.fn();
const verifierOTP = vi.fn();

const auth: { user: Partial<User> | null; rafraichir: () => Promise<null> } = {
  user: null,
  rafraichir: async () => null,
};
vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    authAPI: { ...reel.authAPI, envoyerOTP, verifierOTP },
    listingsAPI: {
      ...reel.listingsAPI,
      mesAnnonces: async () => ({ listings: [], total: 0, stats: {} }),
    },
    matchesAPI: { ...reel.matchesAPI, mesDemandes: async () => ({ matches: [], stats: {} }) },
  };
});

const { OwnerDashboard } = await import("./OwnerDashboard");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVERTISSEMENT = "Vérifiez votre numéro pour publier une annonce.";

let racine: ReturnType<typeof createRoot> | null = null;

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

async function monter() {
  const router = createMemoryRouter([{ path: "/owner/dashboard", Component: OwnerDashboard }], {
    initialEntries: ["/owner/dashboard"],
  });
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await attendreUnPeu();
}

function boutons(texte: string) {
  return [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === texte);
}

beforeEach(() => {
  envoyerOTP.mockReset();
  verifierOTP.mockReset();
  auth.user = {
    id: "U1",
    full_name: "Ibrahima Sow",
    role: "landlord",
    phone: "622000000",
    phone_verified: false,
    trust_level: 0,
  };
  auth.rafraichir = async () => null;
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

describe("OwnerDashboard — téléphone à vérifier pour publier", () => {
  it("bandeau et bouton pour un bailleur au téléphone non vérifié", async () => {
    await monter();

    expect(document.querySelector('[role="status"]')?.textContent).toBe(AVERTISSEMENT);
    expect(boutons("Vérifier mon numéro")).toHaveLength(1);
  });

  it("bandeau pour une agence au téléphone non vérifié", async () => {
    auth.user = { ...auth.user, role: "agency" };
    await monter();

    expect(document.body.textContent).toContain(AVERTISSEMENT);
  });

  it("aucun bandeau quand le téléphone est vérifié", async () => {
    auth.user = { ...auth.user, phone_verified: true };
    await monter();

    expect(document.body.textContent).not.toContain(AVERTISSEMENT);
    expect(boutons("Vérifier mon numéro")).toHaveLength(0);
  });

  it("le bandeau disparaît après la vérification sur place", async () => {
    auth.rafraichir = async () => {
      auth.user = { ...auth.user, phone_verified: true };
      return null;
    };
    envoyerOTP.mockResolvedValue({ message: "ok", phone: "+224622000000", expire_dans: 300 });
    verifierOTP.mockResolvedValue({ message: "ok", trust_level: 1, badge: "Basique" });
    await monter();

    act(() => boutons("Vérifier mon numéro")[0].click());
    act(() => boutons("Recevoir le code par SMS")[0].click());
    await attendreUnPeu();
    const champ = document.querySelector<HTMLInputElement>('input[aria-label="Code de vérification"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ, "654321");
    act(() => champ.dispatchEvent(new Event("input", { bubbles: true })));
    act(() => boutons("Valider le code")[0].click());
    await attendreUnPeu();

    expect(verifierOTP).toHaveBeenCalledWith("654321");
    expect(document.body.textContent).not.toContain(AVERTISSEMENT);
    expect(document.body.textContent).toContain("Numéro vérifié : vous pouvez publier vos annonces.");
    // Le bandeau a quitté la page : le focus va au lien « Publier », pas à <body>.
    expect(document.activeElement?.textContent?.trim()).toBe("Publier");
  });
});
