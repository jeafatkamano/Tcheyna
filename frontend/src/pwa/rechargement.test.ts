import { describe, expect, it, vi } from "vitest";

import { siModuleIntrouvable } from "./rechargement";

function stockageMemoire() {
  const valeurs = new Map<string, string>();
  return {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
  };
}

describe("siModuleIntrouvable", () => {
  it("recharge une seule fois, puis laisse l'erreur remonter", () => {
    const stockage = stockageMemoire();
    const recharger = vi.fn();

    const premier = new Event("vite:preloadError", { cancelable: true });
    siModuleIntrouvable(premier, stockage, recharger);
    expect(recharger).toHaveBeenCalledOnce();
    expect(premier.defaultPrevented).toBe(true);

    const second = new Event("vite:preloadError", { cancelable: true });
    siModuleIntrouvable(second, stockage, recharger);
    expect(recharger).toHaveBeenCalledOnce();
    expect(second.defaultPrevented).toBe(false);
  });

  it("stockage indisponible : ni rechargement ni boucle", () => {
    const recharger = vi.fn();
    const stockage = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {},
    };
    const evenement = new Event("vite:preloadError", { cancelable: true });
    siModuleIntrouvable(evenement, stockage, recharger);
    expect(recharger).not.toHaveBeenCalled();
    expect(evenement.defaultPrevented).toBe(false);
  });
});
