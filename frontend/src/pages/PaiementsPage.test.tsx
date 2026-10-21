/**
 * Grille tarifaire (D1) : les frais de mise en relation remplacent la
 * commission de 6 %, que la page n'affiche plus, même si un serveur antérieur
 * au lot 2.4 renvoie encore son bloc.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tarifs = vi.fn();
const mesPaiements = vi.fn();

vi.mock("../api", async (original) => {
  const reel = await original<typeof import("../api")>();
  return { ...reel, paiementsAPI: { ...reel.paiementsAPI, tarifs, mesPaiements } };
});
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "U1", role: "landlord" } }),
}));

const { PaiementsPage } = await import("./PaiementsPage");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRAIS = {
  type: "frais_mise_en_relation",
  libelle: "Frais de mise en relation",
  montant: 250_000,
  payeur: "Propriétaire",
  moment: "À l'acceptation d'une candidature de location",
  description:
    "Dus par le propriétaire ou l'agence quand il accepte une candidature de location : l'acceptation prend effet à la confirmation du paiement. Aucun frais sur une vente.",
};
const CERTIFICATION = {
  type: "certification",
  libelle: "Certification d'annonce",
  montant: 250_000,
  payeur: "Propriétaire",
  description: "Vérification des documents de propriété et badge Annonce Certifiée",
};
const COMMISSION_AVANT_D1 = {
  taux: 0.06,
  libelle: "Commission de mise en relation",
  payeur: "Propriétaire",
  description: "6 % du premier loyer, dus par le propriétaire lorsqu'une location est conclue via Tcheyna",
};

let racine: ReturnType<typeof createRoot> | null = null;

async function afficher() {
  const router = createMemoryRouter([{ path: "/paiements", Component: PaiementsPage }], {
    initialEntries: ["/paiements"],
  });
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await act(() => new Promise((r) => setTimeout(r, 5)));
  return conteneur.textContent ?? "";
}

beforeEach(() => {
  tarifs.mockReset();
  mesPaiements.mockReset();
  mesPaiements.mockResolvedValue({ paiements: [], total: 0, total_paye: 0, devise: "GNF" });
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

describe("PaiementsPage — grille tarifaire", () => {
  it("affiche les frais de mise en relation, leur moment, la gratuité de la vente, sans commission", async () => {
    tarifs.mockResolvedValue({ devise: "GNF", services: [FRAIS, CERTIFICATION] });

    const page = await afficher();

    expect(page).toContain("Frais de mise en relation");
    expect(page).toContain("À l'acceptation d'une candidature de location");
    expect(page).toContain("Aucun frais sur une vente.");
    expect(page).not.toContain("6 %");
    expect(page).not.toContain("Commission");
  });

  it("ignore le bloc commission d'un serveur antérieur au lot 2.4", async () => {
    tarifs.mockResolvedValue({
      devise: "GNF",
      services: [CERTIFICATION],
      commission: COMMISSION_AVANT_D1,
    });

    const page = await afficher();

    expect(page).toContain("Certification d'annonce");
    expect(page).not.toContain("6 %");
    expect(page).not.toContain("Commission de mise en relation");
  });
});
