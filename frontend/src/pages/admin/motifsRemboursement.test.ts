import { describe, expect, it } from "vitest";

import { MOTIFS_REMBOURSEMENT as MOTIFS } from "./motifsRemboursement";

describe("AdminDashboard — motifs de remboursement", () => {
  it("donne un libellé à chaque motif renvoyé par l'API, frais de mise en relation compris", () => {
    expect(Object.keys(MOTIFS).sort()).toEqual([
      "candidature_close",
      "doublon",
      "ecartee_par_le_bailleur",
      "hors_plateforme",
    ]);
    expect(MOTIFS.ecartee_par_le_bailleur).toContain("écartée par le propriétaire");
    for (const libelle of Object.values(MOTIFS)) expect(libelle.length).toBeGreaterThan(0);
  });
});
