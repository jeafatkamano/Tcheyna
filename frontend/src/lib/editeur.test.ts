import { describe, expect, it } from "vitest";

import { champsACompleter, EDITEUR } from "./editeur";

describe("identité de l'éditeur", () => {
  it("désigne Kamino comme éditeur (décision D11)", () => {
    expect(EDITEUR.nomCommercial).toBe("Kamino");
  });

  it("rappelle les champs encore à fournir", () => {
    const manquants = champsACompleter();
    if (manquants.length > 0) {
      // Rappel visible dans la sortie de `npm test` : les pages légales ne
      // sont pas définitives tant que cette liste n'est pas vide.
      console.info(`Pages légales non définitives, champs à compléter dans editeur.ts : ${manquants.join(", ")}`);
    }
    expect(manquants).not.toContain("nomCommercial");
  });

  // Garde-fou : lancer `VITE_PAGES_LEGALES_DEFINITIVES=true npm test` avant de
  // déclarer les pages légales définitives fait échouer ce test s'il reste un trou.
  it.runIf(import.meta.env.VITE_PAGES_LEGALES_DEFINITIVES === "true")(
    "n'a plus aucun champ vide quand les pages sont déclarées définitives",
    () => {
      expect(champsACompleter()).toEqual([]);
    },
  );
});
