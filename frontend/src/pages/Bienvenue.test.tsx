/**
 * Présentation du premier lancement (lot 3.13) : navigation entre les trois
 * écrans, annonce de la position, liens du troisième écran et mémorisation.
 * Lot 3.17 : déclenchement des animations à l'arrivée sur chaque écran.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Bienvenue } from "./Bienvenue";
import { CLE_PRESENTATION } from "../lib/presentation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Lu tel quel : Vitest ne fournit pas le texte des feuilles CSS importées.
const cssPresentation = readFileSync(resolve(process.cwd(), "src/styles/presentation.css"), "utf8");

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

  /** Simule la position du défilement (jsdom ne défile pas) et l'événement « scroll ». */
  function defilerA(conteneur: HTMLElement, position: number) {
    const defileur = conteneur.querySelector("main > div")!;
    Object.defineProperty(defileur, "clientWidth", { value: 390, configurable: true });
    Object.defineProperty(defileur, "scrollLeft", { value: position * 390, configurable: true });
    act(() => {
      defileur.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  }
  const etats = (c: HTMLElement) => ecrans(c).map((e) => e.dataset.pres);

  it("animations : l'écran courant joue, les écrans pas encore vus attendent", () => {
    const { conteneur } = ouvrir();
    expect(etats(conteneur)).toEqual(["joue", "attente", "attente"]);
    act(() => boutons(conteneur, "Suivant")[0].click());
    // Pendant le glissement, l'écran visé attend ; l'écran quitté reste « joue ».
    expect(etats(conteneur)).toEqual(["joue", "attente", "attente"]);
    defilerA(conteneur, 1);
    expect(etats(conteneur)).toEqual(["joue", "joue", "attente"]);
  });

  it("animations : les positions intermédiaires d'un glissement par bouton sont ignorées", () => {
    const { conteneur } = ouvrir();
    act(() => boutons(conteneur, "Passer")[0].click());
    // « Passer » glisse de l'écran 1 au 3 en passant par le 2 : ni l'écran 1
    // ni le 2 ne redeviennent courants, aucun ne rejoue son animation.
    defilerA(conteneur, 0.2);
    defilerA(conteneur, 1);
    expect(annonce(conteneur)).toBe("Écran 3 sur 3");
    expect(etats(conteneur)).toEqual(["joue", "attente", "attente"]);
    defilerA(conteneur, 2);
    expect(etats(conteneur)).toEqual(["joue", "attente", "joue"]);
    // Ensuite, le doigt reprend la main normalement.
    defilerA(conteneur, 1);
    expect(annonce(conteneur)).toBe("Écran 2 sur 3");
  });

  it("animations : revenir sur un écran relance son animation sans le recréer", () => {
    const { conteneur } = ouvrir();
    const titre = ecrans(conteneur)[1].querySelector("h1");
    act(() => boutons(conteneur, "Suivant")[0].click());
    defilerA(conteneur, 1);
    act(() => boutons(conteneur, "Passer")[1].click());
    defilerA(conteneur, 2);
    const observateur = new MutationObserver(() => undefined);
    observateur.observe(ecrans(conteneur)[1], { attributes: true, attributeFilter: ["data-pres"], attributeOldValue: true });
    act(() => boutons(conteneur, "Écran précédent")[0].click());
    defilerA(conteneur, 1);
    // takeRecords : les enregistrements en attente, lus avant leur remise asynchrone.
    const anciennes = observateur.takeRecords().map((r) => r.oldValue);
    observateur.disconnect();
    // Retour sur l'écran 2 : « joue » → « attente » (glissement) → « joue » (arrivée).
    expect(anciennes).toEqual(["joue", "attente", "attente"]);
    expect(ecrans(conteneur)[1].dataset.pres).toBe("joue");
    expect(ecrans(conteneur)[1].querySelector("h1")).toBe(titre);
    expect(document.activeElement).toBe(titre);
  });

  it("animations : sans signal d'arrivée, l'écran visé s'anime quand même", () => {
    vi.useFakeTimers();
    try {
      const { conteneur } = ouvrir();
      act(() => boutons(conteneur, "Suivant")[0].click());
      expect(ecrans(conteneur)[1].dataset.pres).toBe("attente");
      act(() => vi.advanceTimersByTime(700));
      expect(ecrans(conteneur)[1].dataset.pres).toBe("joue");
    } finally {
      vi.useRealTimers();
    }
  });

  it("mouvement réduit : l'écran visé s'affiche aussitôt, sans attendre", () => {
    vi.stubGlobal("matchMedia", (requete: string) => ({ matches: requete.includes("reduce") }));
    const { conteneur } = ouvrir();
    act(() => boutons(conteneur, "Suivant")[0].click());
    expect(ecrans(conteneur)[1].dataset.pres).toBe("joue");
  });

  it("CSS : en mouvement réduit, rien ne reste masqué", () => {
    const reduit = cssPresentation.slice(cssPresentation.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduit).toMatch(/\[data-pres\] \.pa\s*\{\s*opacity:\s*1;/);
    expect(reduit).toMatch(/\[data-pres\] \.pres-coche path\s*\{\s*stroke-dashoffset:\s*0;/);
    // Les animations ne sont déclarées que si le mouvement est permis.
    const avant = cssPresentation.slice(0, cssPresentation.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(avant).not.toMatch(/animation:/);
  });

  it("les décors animés restent cachés aux lecteurs d'écran", () => {
    const { conteneur } = ouvrir();
    for (const decor of conteneur.querySelectorAll(".pres-confetti, .pres-tape, .pres-etincelle")) {
      expect(decor.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(conteneur.querySelectorAll(".pres-confetti").length).toBeGreaterThan(0);
  });
});
