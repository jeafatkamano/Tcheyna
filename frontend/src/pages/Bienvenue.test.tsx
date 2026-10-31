/**
 * Présentation du premier lancement (lot 3.13) : navigation entre les trois
 * écrans, annonce de la position, liens du troisième écran et mémorisation.
 * Lot 3.17 : déclenchement des animations à l'arrivée sur chaque écran.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Bienvenue } from "./Bienvenue";
import { CLE_PRESENTATION } from "../lib/presentation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
const defiler = vi.fn();

function Destination() {
  const { pathname, search } = useLocation();
  return <p>Destination {pathname + search}</p>;
}

beforeEach(() => {
  localStorage.clear();
  defiler.mockReset();
  Element.prototype.scrollTo = defiler as unknown as typeof Element.prototype.scrollTo;
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
      { path: "/bienvenue", Component: Bienvenue },
      { path: "*", Component: Destination },
    ],
    { initialEntries: ["/bienvenue"] },
  );
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return { conteneur, router };
}

const annonce = (c: HTMLElement) => c.querySelector('[aria-live="polite"]')!.textContent;
const ecrans = (c: HTMLElement) => [...c.querySelectorAll("section")];
const ecranVisible = (c: HTMLElement) => ecrans(c).findIndex((s) => !s.hasAttribute("inert"));
const boutons = (c: HTMLElement, texte: string) =>
  [...c.querySelectorAll("button")].filter(
    (b) => b.textContent === texte || b.getAttribute("aria-label") === texte,
  );

describe("Bienvenue", () => {
  it("trois écrans ; seul le premier est lisible au départ", () => {
    const { conteneur } = ouvrir();
    expect(ecrans(conteneur)).toHaveLength(3);
    expect(ecranVisible(conteneur)).toBe(0);
    expect(ecrans(conteneur).filter((s) => s.hasAttribute("inert"))).toHaveLength(2);
    expect(annonce(conteneur)).toBe("Écran 1 sur 3");
    expect(conteneur.querySelector('[role="img"][aria-label="Écran 1 sur 3"]')).not.toBeNull();
  });

  it("la flèche avance d'un écran et l'annonce", () => {
    const { conteneur } = ouvrir();
    act(() => boutons(conteneur, "Suivant")[0].click());
    expect(annonce(conteneur)).toBe("Écran 2 sur 3");
    expect(ecranVisible(conteneur)).toBe(1);
    expect(defiler).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));

    act(() => boutons(conteneur, "Suivant")[1].click());
    expect(annonce(conteneur)).toBe("Écran 3 sur 3");
  });

  it("le focus passe au titre du nouvel écran, une fois celui-ci lisible", () => {
    const { conteneur } = ouvrir();
    act(() => boutons(conteneur, "Suivant")[0].click());
    const titre = ecrans(conteneur)[1].querySelector("h1")!;
    expect(document.activeElement).toBe(titre);
    expect(ecrans(conteneur)[1].hasAttribute("inert")).toBe(false);
  });

  it("« Passer » mène au troisième écran, la flèche retour au deuxième", () => {
    const { conteneur } = ouvrir();
    act(() => boutons(conteneur, "Passer")[0].click());
    expect(annonce(conteneur)).toBe("Écran 3 sur 3");
    expect(ecranVisible(conteneur)).toBe(2);

    act(() => boutons(conteneur, "Écran précédent")[0].click());
    expect(annonce(conteneur)).toBe("Écran 2 sur 3");
  });

  it("le glissement au doigt met à jour l'écran courant", () => {
    const { conteneur } = ouvrir();
    const defileur = conteneur.querySelector("main > div")!;
    Object.defineProperty(defileur, "clientWidth", { value: 390, configurable: true });
    Object.defineProperty(defileur, "scrollLeft", { value: 780, configurable: true });
    act(() => {
      defileur.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(annonce(conteneur)).toBe("Écran 3 sur 3");
  });

  it("mouvement réduit : pas de défilement animé", () => {
    vi.stubGlobal("matchMedia", (requete: string) => ({ matches: requete.includes("reduce") }));
    const { conteneur } = ouvrir();
    act(() => boutons(conteneur, "Suivant")[0].click());
    expect(defiler).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("troisième écran : les liens portent le bon rôle", () => {
    const { conteneur } = ouvrir();
    const href = (texte: string) =>
      [...conteneur.querySelectorAll("a")].find((a) => a.textContent?.includes(texte))?.getAttribute("href");
    expect(href("Je cherche un logement")).toBe("/inscription?role=tenant");
    expect(href("Je mets en location")).toBe("/inscription?role=landlord");
    expect(href("Se connecter")).toBe("/login");
  });

  it.each([
    ["Je cherche un logement", "/inscription?role=tenant"],
    ["Je mets en location", "/inscription?role=landlord"],
    ["Se connecter", "/login"],
  ])("« %s » mémorise la présentation et ouvre %s", (texte, destination) => {
    const { conteneur, router } = ouvrir();
    expect(localStorage.getItem(CLE_PRESENTATION)).toBeNull();
    const lien = [...conteneur.querySelectorAll("a")].find((a) => a.textContent?.includes(texte))!;
    act(() => lien.click());
    expect(localStorage.getItem(CLE_PRESENTATION)).toBe("1");
    expect(router.state.location.pathname + router.state.location.search).toBe(destination);
  });

  it("stockage indisponible : le lien fonctionne quand même", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { conteneur, router } = ouvrir();
    const lien = [...conteneur.querySelectorAll("a")].find((a) => a.textContent?.includes("Se connecter"))!;
    act(() => lien.click());
    expect(router.state.location.pathname).toBe("/login");
    vi.unstubAllGlobals();
  });

  it("animations : l'écran courant joue, les écrans pas encore vus attendent", () => {
    const { conteneur } = ouvrir();
    expect(ecrans(conteneur).map((e) => e.dataset.pres)).toEqual(["joue", "attente", "attente"]);
    act(() => boutons(conteneur, "Suivant")[0].click());
    // L'écran quitté reste « joue » : il ne disparaît pas en glissant hors de vue.
    expect(ecrans(conteneur).map((e) => e.dataset.pres)).toEqual(["joue", "joue", "attente"]);
  });

  it("animations : revenir sur un écran relance son animation sans le recréer", () => {
    const { conteneur } = ouvrir();
    const titre = ecrans(conteneur)[1].querySelector("h1");
    act(() => boutons(conteneur, "Suivant")[0].click());
    const observateur = new MutationObserver(() => undefined);
    observateur.observe(ecrans(conteneur)[1], { attributes: true, attributeFilter: ["data-pres"], attributeOldValue: true });
    act(() => boutons(conteneur, "Passer")[1].click());
    act(() => boutons(conteneur, "Écran précédent")[0].click());
    // Valeur de l'attribut après chaque changement : l'ancienne valeur du suivant.
    const anciennes = observateur.takeRecords().map((r) => r.oldValue);
    observateur.disconnect();
    // Retour sur l'écran 2 : « joue » → « attente » → « joue », même élément (le focus tient).
    expect(anciennes.slice(-2)).toEqual(["joue", "attente"]);
    expect(ecrans(conteneur)[1].dataset.pres).toBe("joue");
    expect(ecrans(conteneur)[1].querySelector("h1")).toBe(titre);
    expect(document.activeElement).toBe(titre);
  });

  it("les décors animés restent cachés aux lecteurs d'écran", () => {
    const { conteneur } = ouvrir();
    for (const decor of conteneur.querySelectorAll(".pres-confetti, .pres-tape, .pres-etincelle")) {
      expect(decor.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(conteneur.querySelectorAll(".pres-confetti").length).toBeGreaterThan(0);
  });
});
