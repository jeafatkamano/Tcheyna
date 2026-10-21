/**
 * Acceptation d'une candidature (D1) : sur une location, le serveur répond
 * 402 et l'acceptation passe par le paiement des frais de mise en relation ;
 * sur une vente, elle reste directe.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Match, Payment } from "../../api";

const mesDemandes = vi.fn();
const repondre = vi.fn();
const mesPaiements = vi.fn();
const initier = vi.fn();
const verifier = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    matchesAPI: { ...reel.matchesAPI, mesDemandes, repondre },
    paiementsAPI: { ...reel.paiementsAPI, mesPaiements, initier, verifier },
  };
});

const { OwnerMatches } = await import("./OwnerMatches");
const { ApiError } = await import("../../api/client");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE_402 =
  "Pour accepter cette candidature, réglez les frais de mise en relation (250 000 GNF). L'acceptation prendra effet dès la confirmation du paiement.";

function candidature(vente = false): Match {
  return {
    id: "M1",
    status: "pending",
    commission: 0,
    tenant: { id: "T1", full_name: "Aïssatou Test", trust_level: 2 } as Match["tenant"],
    listing: {
      id: "L1",
      title: "Appartement test",
      quartier: "Kaloum",
      prix: 2_000_000,
      devise: "GNF",
      est_vente: vente,
      type_transaction: vente ? "vente" : "location",
      images: [],
    } as unknown as Match["listing"],
  };
}

function paiementFrais(statut: Payment["statut"]): Payment {
  return {
    id: "P1",
    reference: "TCH-1",
    type_paiement: "frais_mise_en_relation",
    type_label: "Frais de mise en relation",
    montant: 250_000,
    commission: 0,
    devise: "GNF",
    statut,
    match_id: "M1",
  };
}

const ERREUR_402 = new ApiError(MESSAGE_402, 402, {
  error: MESSAGE_402,
  action_requise: "payer_frais_mise_en_relation",
  paiement: { type_paiement: "frais_mise_en_relation", match_id: "M1", montant: 250_000, devise: "GNF" },
});

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

let racine: ReturnType<typeof createRoot> | null = null;

function preparer({ vente = false, paiements = [] as Payment[] } = {}) {
  mesDemandes.mockResolvedValue({
    matches: [candidature(vente)],
    stats: { total: 1, en_attente: 1, acceptees: 0, conclues: 0 },
  });
  mesPaiements.mockResolvedValue({ paiements, total: paiements.length, total_paye: 0, devise: "GNF" });
}

async function afficher() {
  const router = createMemoryRouter([{ path: "/owner/matches", Component: OwnerMatches }], {
    initialEntries: ["/owner/matches"],
  });
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await attendreUnPeu();
  return conteneur;
}

function bouton(texte: string) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(texte));
}

async function cliquer(texte: string) {
  const cible = bouton(texte);
  expect(cible, `bouton « ${texte} »`).toBeDefined();
  act(() => cible!.click());
  await attendreUnPeu();
}

beforeEach(() => {
  for (const f of [mesDemandes, repondre, mesPaiements, initier, verifier]) f.mockReset();
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

describe("OwnerMatches — acceptation et frais de mise en relation", () => {
  it("402 : ouvre le paiement des frais pour cette candidature, sans rien accepter", async () => {
    preparer();
    repondre.mockRejectedValue(ERREUR_402);
    initier.mockResolvedValue({
      message: "ok",
      payment_url: null,
      paiement: { ...paiementFrais("pending"), reference: "TCH-9" },
      mode: "hors_ligne",
    });
    await afficher();

    await cliquer("Accepter et discuter");

    expect(repondre).toHaveBeenCalledWith("M1", "accepted");
    const page = document.body.textContent ?? "";
    expect(page).toContain("Frais de mise en relation");
    expect(page).toContain("250 000 GNF");
    expect(page).toContain("l'acceptation de cette candidature de location");
    expect(page).toContain("L'acceptation prend effet au paiement confirmé");
    // L'erreur 402 n'est pas affichée comme un échec.
    expect(page).not.toContain(MESSAGE_402);
    // La liste n'est pas rechargée : rien n'a changé côté serveur.
    expect(mesDemandes).toHaveBeenCalledTimes(1);

    await cliquer("Payer");

    expect(initier).toHaveBeenCalledWith({
      type_paiement: "frais_mise_en_relation",
      match_id: "M1",
      listing_id: undefined,
      methode: "orange_money",
    });
    // Paiement enregistré : l'historique est relu pour afficher l'attente.
    expect(mesPaiements).toHaveBeenCalledTimes(2);
  });

  it("paiement en attente : « en attente du paiement », aucun second paiement", async () => {
    preparer({ paiements: [paiementFrais("pending")] });
    await afficher();

    const page = document.body.textContent ?? "";
    expect(page).toContain("Acceptation en attente du paiement");
    expect(bouton("Accepter et discuter")).toBeUndefined();
    expect(bouton("Réessayer")).toBeUndefined();
    expect(document.querySelector('a[href="/paiements/P1"]')).not.toBeNull();

    // Vérification : confirmé, il a accepté la candidature : tout est relu.
    verifier.mockResolvedValue({ message: "Paiement confirmé", paiement: paiementFrais("success") });
    await cliquer("Vérifier le paiement");

    expect(verifier).toHaveBeenCalledWith("P1");
    expect(mesPaiements).toHaveBeenCalledTimes(2);
    expect(mesDemandes).toHaveBeenCalledTimes(2);
    expect(repondre).not.toHaveBeenCalled();
    expect(initier).not.toHaveBeenCalled();
  });

  it("paiement échoué : « Réessayer » relance l'acceptation et rouvre le paiement", async () => {
    preparer({ paiements: [paiementFrais("failed")] });
    repondre.mockRejectedValue(ERREUR_402);
    await afficher();

    expect(document.body.textContent).toContain("n'a pas abouti");
    expect(bouton("Accepter et discuter")).toBeUndefined();

    await cliquer("Réessayer");

    expect(repondre).toHaveBeenCalledWith("M1", "accepted");
    expect(bouton("Payer")).toBeDefined();
  });

  it("vente : acceptation directe, sans paiement", async () => {
    preparer({ vente: true });
    repondre.mockResolvedValue({ message: "Candidature acceptée", match: { ...candidature(true), status: "accepted" } });
    await afficher();

    await cliquer("Accepter et discuter");

    expect(repondre).toHaveBeenCalledWith("M1", "accepted");
    expect(mesDemandes).toHaveBeenCalledTimes(2);
    expect(bouton("Payer")).toBeUndefined();
    expect(initier).not.toHaveBeenCalled();
  });

  it("annonce hors GNF : le message du serveur, pas de paiement", async () => {
    preparer();
    const message =
      "Les frais de mise en relation ne sont proposés qu'en GNF pour le moment : cette candidature ne peut pas encore être acceptée.";
    repondre.mockRejectedValue(new ApiError(message, 400, { error: message }));
    await afficher();

    await cliquer("Accepter et discuter");

    expect(document.body.textContent).toContain(message);
    expect(bouton("Payer")).toBeUndefined();
  });

  it("paiements en chargement : pas d'acceptation d'une location", async () => {
    preparer();
    mesPaiements.mockReturnValue(new Promise(() => {}));
    await afficher();

    expect(document.body.textContent).toContain("Vérification des frais de mise en relation");
    expect(bouton("Accepter et discuter")).toBeUndefined();
    expect(bouton("Refuser")).toBeDefined();
  });

  it("paiements en erreur : erreur affichée, pas d'acceptation, rechargement possible", async () => {
    preparer();
    mesPaiements.mockRejectedValueOnce(new ApiError("Connexion impossible.", 0));
    await afficher();

    expect(document.body.textContent).toContain("Connexion impossible.");
    expect(document.body.textContent).toContain("L'acceptation reste indisponible");
    expect(bouton("Accepter et discuter")).toBeUndefined();

    await cliquer("Recharger les paiements");

    expect(mesPaiements).toHaveBeenCalledTimes(2);
    expect(bouton("Accepter et discuter")).toBeDefined();
    expect(repondre).not.toHaveBeenCalled();
  });

  it("vente : l'état des paiements n'empêche pas l'acceptation", async () => {
    preparer({ vente: true });
    mesPaiements.mockRejectedValue(new ApiError("Connexion impossible.", 0));
    await afficher();

    expect(bouton("Accepter et discuter")).toBeDefined();
  });

  it("plus aucun bouton « Régler la commission » sur une location conclue", async () => {
    mesDemandes.mockResolvedValue({
      matches: [{ ...candidature(), status: "completed", commission: 120_000 }],
      stats: { total: 1, en_attente: 0, acceptees: 0, conclues: 1 },
    });
    mesPaiements.mockResolvedValue({ paiements: [], total: 0, total_paye: 0, devise: "GNF" });
    await afficher();

    const page = document.body.textContent ?? "";
    expect(page).not.toContain("Régler la commission");
    expect(page).not.toContain("6 %");
  });
});
