/** Compression : calculs purs (le canvas réel se vérifie sur téléphone). */
import { describe, expect, it } from "vitest";

import {
  COTE_MAX,
  COTE_REPLI,
  dimensionsCibles,
  encoderSousPlafond,
  nomCompresse,
  originalEnvoyable,
  PLAFOND_OCTETS,
  POIDS_MAX_SERVEUR,
} from "./image";

describe("dimensionsCibles", () => {
  it("ramène le côté long d'une photo paysage à 1280 px", () => {
    expect(dimensionsCibles(4000, 3000)).toEqual({ largeur: 1280, hauteur: 960 });
  });

  it("ramène le côté long d'une photo portrait à 1280 px", () => {
    expect(dimensionsCibles(3024, 4032)).toEqual({ largeur: 960, hauteur: 1280 });
  });

  it("n'agrandit jamais une petite photo", () => {
    expect(dimensionsCibles(800, 600)).toEqual({ largeur: 800, hauteur: 600 });
    expect(dimensionsCibles(1280, 720)).toEqual({ largeur: 1280, hauteur: 720 });
  });

  it("respecte un côté maximal plus petit (repli)", () => {
    expect(dimensionsCibles(4000, 4000, COTE_REPLI)).toEqual({ largeur: 1024, hauteur: 1024 });
  });

  it("garde au moins 1 px sur une image très allongée", () => {
    expect(dimensionsCibles(20000, 10)).toEqual({ largeur: 1280, hauteur: 1 });
  });
});

/** Encodeur simulé : le poids baisse avec la qualité et la taille. */
function encodeurSimule(poids: (qualite: number, cote: number) => number) {
  const appels: Array<[number, number]> = [];
  const encoder = async (qualite: number, cote: number) => {
    appels.push([qualite, cote]);
    return new Blob([new Uint8Array(Math.round(poids(qualite, cote)))], { type: "image/webp" });
  };
  return { encoder, appels };
}

describe("encoderSousPlafond", () => {
  it("s'arrête à la première qualité sous 300 Ko", async () => {
    const { encoder, appels } = encodeurSimule((q) => q * 400 * 1024);

    const blob = await encoderSousPlafond(encoder);

    expect(blob.size).toBeLessThanOrEqual(PLAFOND_OCTETS);
    expect(appels).toEqual([
      [0.82, COTE_MAX],
      [0.72, COTE_MAX],
    ]);
  });

  it("garde la meilleure qualité quand elle suffit déjà", async () => {
    const { encoder, appels } = encodeurSimule(() => 120 * 1024);

    await encoderSousPlafond(encoder);

    expect(appels).toEqual([[0.82, COTE_MAX]]);
  });

  it("réduit à 1024 px quand la qualité seule ne suffit pas", async () => {
    const { encoder, appels } = encodeurSimule((q, cote) => (cote === COTE_MAX ? 700 : 300) * 1024 * q);

    const blob = await encoderSousPlafond(encoder);

    expect(blob.size).toBeLessThanOrEqual(PLAFOND_OCTETS);
    expect(appels.filter(([, cote]) => cote === COTE_MAX)).toHaveLength(4);
    expect(appels.at(-1)).toEqual([0.82, COTE_REPLI]);
  });

  it("renvoie le résultat le plus léger si le plafond reste hors d'atteinte", async () => {
    const { encoder, appels } = encodeurSimule((q, cote) => 2_000_000 * q * (cote / COTE_MAX));

    const blob = await encoderSousPlafond(encoder);

    expect(appels).toHaveLength(8);
    expect(blob.size).toBe(Math.round(2_000_000 * 0.52 * (COTE_REPLI / COTE_MAX)));
  });
});

describe("nomCompresse", () => {
  it("remplace l'extension selon le format produit", () => {
    expect(nomCompresse("IMG_2024.HEIC", "image/webp")).toBe("IMG_2024.webp");
    expect(nomCompresse("salon.png", "image/jpeg")).toBe("salon.jpg");
  });

  it("donne toujours une extension, même à un Blob sans nom", () => {
    expect(nomCompresse("blob", "image/webp")).toBe("blob.webp");
    expect(nomCompresse("", "image/jpeg")).toBe("photo.jpg");
  });

  it("nettoie les caractères gênants", () => {
    expect(nomCompresse("Chambre à coucher (1).jpeg", "image/webp")).toBe("Chambre-coucher-1.webp");
  });
});

describe("originalEnvoyable", () => {
  it("accepte un JPEG raisonnable, refuse un HEIC ou un fichier trop lourd", () => {
    expect(originalEnvoyable(new File(["x"], "a.jpg"))).toBe(true);
    expect(originalEnvoyable(new File(["x"], "a.heic"))).toBe(false);
    const lourd = new File([new Uint8Array(POIDS_MAX_SERVEUR + 1)], "a.jpg");
    expect(originalEnvoyable(lourd)).toBe(false);
  });
});
