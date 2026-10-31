/**
 * Sensation d'application native (lot 3.16) : classe `app-native` dans
 * l'application seulement, bouton retour d'Android (feuille ou menu fermé
 * d'abord, écrans de départ qui ferment l'appli), vibration, transitions.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const natif = vi.hoisted(() => ({ actif: false }));
const app = vi.hoisted(() => ({
  ecouteur: null as null | ((e: { canGoBack: boolean }) => void),
  exitApp: vi.fn(),
}));
const haptics = vi.hoisted(() => ({ impact: vi.fn() }));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => natif.actif } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_nom: string, ecouteur: (e: { canGoBack: boolean }) => void) => {
      app.ecouteur = ecouteur;
      return { remove: vi.fn() };
    }),
    exitApp: app.exitApp,
  },
}));
vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact: haptics.impact },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
}));

const { initialiserNatif, retourAndroid } = await import("./natif");
const { enregistrerFermable, fermerDernier } = await import("./fermables");
const { vibrerLegerement } = await import("./vibration");
const { transitionPage } = await import("./transitions");
const { FeuilleBas } = await import("../components/FeuilleBas");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  natif.actif = false;
  app.ecouteur = null;
  app.exitApp.mockReset();
  haptics.impact.mockReset();
  document.documentElement.classList.remove("app-native");
  while (fermerDernier()) {
    /* vide la pile */
  }
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("classe app-native", () => {
  it("posée sur <html> dans l'application seulement", async () => {
    await initialiserNatif();
    expect(document.documentElement.classList.contains("app-native")).toBe(false);

    natif.actif = true;
    await initialiserNatif();
    expect(document.documentElement.classList.contains("app-native")).toBe(true);
  });
});

describe("bouton retour d'Android", () => {
  const actions = () => ({ reculer: vi.fn(), quitter: vi.fn() });

  it.each(["/tenant/dashboard", "/owner/dashboard", "/admin", "/bienvenue", "/login", "/login/"])(
    "sur %s, il ferme l'application même avec une page précédente",
    (chemin) => {
      const a = actions();
      expect(retourAndroid(chemin, true, a)).toBe("quitte");
      expect(a.quitter).toHaveBeenCalledOnce();
      expect(a.reculer).not.toHaveBeenCalled();
    },
  );

  it("ailleurs, il revient à la page précédente ; sans page précédente, il ferme l'appli", () => {
    const a = actions();
    expect(retourAndroid("/listing/a1", true, a)).toBe("recule");
    expect(a.reculer).toHaveBeenCalledOnce();
    expect(retourAndroid("/listing/a1", false, a)).toBe("quitte");
    expect(a.quitter).toHaveBeenCalledOnce();
  });

  it("une feuille du bas ou le menu ouvert se ferme d'abord, même sur un écran de départ", () => {
    const fermerMenu = vi.fn();
    const desinscrire = enregistrerFermable(fermerMenu);
    const a = actions();
    expect(retourAndroid("/tenant/dashboard", true, a)).toBe("ferme");
    expect(fermerMenu).toHaveBeenCalledOnce();
    expect(a.quitter).not.toHaveBeenCalled();
    desinscrire();
    expect(retourAndroid("/tenant/dashboard", true, a)).toBe("quitte");
  });

  it("une feuille du bas ouverte s'inscrit, et le bouton retour la ferme", () => {
    const onFermer = vi.fn();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <FeuilleBas titre="Filtres" onFermer={onFermer}>
              <p>Quartier</p>
            </FeuilleBas>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine!.render(<RouterProvider router={router} />));

    expect(retourAndroid("/tenant/listings", true, actions())).toBe("ferme");
    expect(onFermer).toHaveBeenCalledOnce();

    // Feuille démontée : plus rien à fermer.
    act(() => racine?.unmount());
    racine = null;
    expect(fermerDernier()).toBe(false);
  });

  it("dans l'application, l'écouteur applique ces règles avec l'historique réel", async () => {
    natif.actif = true;
    const recul = vi.spyOn(window.history, "back").mockImplementation(() => {});
    window.history.replaceState(null, "", "/messages/M1");
    await initialiserNatif();
    app.ecouteur!({ canGoBack: true });
    expect(recul).toHaveBeenCalledOnce();

    window.history.replaceState(null, "", "/login");
    app.ecouteur!({ canGoBack: true });
    expect(app.exitApp).toHaveBeenCalledOnce();
    window.history.replaceState(null, "", "/");
  });
});

describe("vibration légère", () => {
  it("dans l'application : impact léger ; sur le site : rien", async () => {
    await vibrerLegerement();
    expect(haptics.impact).not.toHaveBeenCalled();

    natif.actif = true;
    await vibrerLegerement();
    expect(haptics.impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("un appareil sans vibreur ne fait pas échouer l'action", async () => {
    natif.actif = true;
    haptics.impact.mockRejectedValue(new Error("non disponible"));
    await expect(vibrerLegerement()).resolves.toBeUndefined();
  });
});

describe("transition entre les pages", () => {
  it("seulement dans l'application, avec startViewTransition, sans mouvement réduit", () => {
    const doc = document as unknown as { startViewTransition?: unknown };
    const avant = doc.startViewTransition;
    doc.startViewTransition = () => undefined;
    try {
      expect(transitionPage()).toBe(false); // site

      document.documentElement.classList.add("app-native");
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      expect(transitionPage()).toBe(true);

      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
      expect(transitionPage()).toBe(false); // mouvement réduit

      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      doc.startViewTransition = undefined;
      expect(transitionPage()).toBe(false); // navigateur sans View Transitions
    } finally {
      doc.startViewTransition = avant;
    }
  });
});
