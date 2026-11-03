/**
 * Écran de marque (lot 3.18) : pendant le réveil du serveur, une ligne le
 * dit, sinon l'application paraît bloquée au démarrage.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const reveil = vi.hoisted(() => ({ enCours: false, abonnes: new Set<() => void>() }));

vi.mock("../api", () => ({
  MESSAGE_REVEIL: "Le serveur démarre, cela peut prendre jusqu'à une minute et demie…",
  reveilServeur: {
    subscribe(abonne: () => void) {
      reveil.abonnes.add(abonne);
      return () => {
        reveil.abonnes.delete(abonne);
      };
    },
    enCours: () => reveil.enCours,
  },
}));

import { EcranMarque } from "./Marque";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;

function monter() {
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<EcranMarque />));
  return conteneur;
}

function basculer(enCours: boolean) {
  act(() => {
    reveil.enCours = enCours;
    reveil.abonnes.forEach((abonne) => abonne());
  });
}

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  reveil.enCours = false;
  document.body.innerHTML = "";
});

describe("EcranMarque", () => {
  it("n'affiche que le monogramme quand le serveur répond", () => {
    const conteneur = monter();
    expect(conteneur.textContent).not.toContain("Le serveur démarre");
    expect(conteneur.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Chargement");
  });

  it("annonce le réveil du serveur, puis le retire", () => {
    const conteneur = monter();

    basculer(true);
    expect(conteneur.textContent).toContain("Le serveur démarre");
    expect(conteneur.querySelector('[role="status"]')?.getAttribute("aria-label")).toMatch(/^Le serveur démarre/);

    basculer(false);
    expect(conteneur.textContent).not.toContain("Le serveur démarre");
  });
});
