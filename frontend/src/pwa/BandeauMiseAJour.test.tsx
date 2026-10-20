import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BandeauMiseAJour } from "./BandeauMiseAJour";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

function afficher(onRecharger = vi.fn(), onFermer = vi.fn()) {
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<BandeauMiseAJour onRecharger={onRecharger} onFermer={onFermer} />));
  const boutons = [...conteneur.querySelectorAll("button")];
  return {
    conteneur,
    recharger: boutons.find((b) => b.textContent === "Recharger")!,
    plusTard: boutons.find((b) => b.textContent === "Plus tard")!,
  };
}

describe("BandeauMiseAJour", () => {
  it("annonce la nouvelle version sans bloquer la page", () => {
    const { conteneur } = afficher();
    expect(conteneur.textContent).toContain("Nouvelle version disponible");
    expect(conteneur.querySelector('[role="status"]')).not.toBeNull();
  });

  it("« Recharger » demande la mise à jour, « Plus tard » ferme seulement", () => {
    const onRecharger = vi.fn();
    const onFermer = vi.fn();
    const { recharger, plusTard } = afficher(onRecharger, onFermer);

    act(() => plusTard.click());
    expect(onFermer).toHaveBeenCalledOnce();
    expect(onRecharger).not.toHaveBeenCalled();

    act(() => recharger.click());
    expect(onRecharger).toHaveBeenCalledOnce();
  });
});
