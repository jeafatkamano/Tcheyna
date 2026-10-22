/**
 * Gestion d'une annonce (lot 2.2) : retrait confirmé puis rechargement,
 * remise en ligne, et demande de certification selon l'état de la
 * re-soumission renvoyé par le serveur (D4), 402 compris.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing } from "../../api";

const detail = vi.fn();
const retirer = vi.fn();
const reactiver = vi.fn();
const demanderCertification = vi.fn();
const documents = vi.fn();
const initier = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    geoAPI: { referentiel: () => Promise.reject(new Error("hors ligne")) },
    listingsAPI: {
      ...reel.listingsAPI,
      detail,
      retirer,
      reactiver,
      demanderCertification,
      documents,
    },
    paiementsAPI: { ...reel.paiementsAPI, initier },
  };
});
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "B1", role: "landlord", phone: "622000000", phone_verified: true },
    rafraichir: vi.fn(),
  }),
}));

const { OwnerListingForm } = await import("./OwnerListingForm");
const { ApiError } = await import("../../api/client");
const { TEXTE_CONFIRMATION_RETRAIT } = await import("../../components/CycleAnnonce");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function annonce(champs: Partial<Listing> = {}): Listing {
  return {
    id: "L1",
    title: "Appartement à Kipé",
    description: "Trois pièces lumineuses",
    pays: "Guinée",
    ville: "Conakry",
    quartier: "Kipé",
    type_transaction: "location",
    est_vente: false,
    type_bien: "appartement",
    prix: 3_000_000,
    charges: 0,
    devise: "GNF",
    meuble: false,
    nb_pieces: 3,
    equipements: {
      generateur: false,
      eau: true,
      wifi: false,
      securite: false,
      parking: false,
      climatisation: false,
    },
    status: "active",
    views_count: 0,
    nb_candidatures: 0,
    images: ["/uploads/a.webp"],
    nb_documents: 1,
    certification_status: "none",
    is_certified: false,
    is_premium: false,
    ...champs,
  } as Listing;
}

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  for (const simulacre of [detail, retirer, reactiver, demanderCertification, documents, initier]) {
    simulacre.mockReset();
  }
  documents.mockResolvedValue({ documents: [], total: 0 });
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function afficher() {
  const router = createMemoryRouter(
    [
      { path: "/owner/listings/:id", Component: OwnerListingForm },
      { path: "/owner/listings", element: <p>mes biens</p> },
    ],
    { initialEntries: ["/owner/listings/L1"] },
  );
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await attendreUnPeu();
  return { conteneur, router };
}

function bouton(conteneur: HTMLElement, texte: string) {
  return [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte));
}

describe("OwnerListingForm — retrait", () => {
  it("demande confirmation, retire par l'API puis recharge l'annonce", async () => {
    detail
      .mockResolvedValueOnce(annonce())
      .mockResolvedValueOnce(annonce({ status: "closed", retiree: true }));
    retirer.mockResolvedValue({ message: "Annonce retirée" });

    const { conteneur, router } = await afficher();
    act(() => bouton(conteneur, "Retirer l'annonce")!.click());

    // Rien n'est retiré avant la confirmation, qui dit ce que le retrait change.
    expect(retirer).not.toHaveBeenCalled();
    expect(conteneur.textContent).toContain(TEXTE_CONFIRMATION_RETRAIT);
    expect(TEXTE_CONFIRMATION_RETRAIT).toContain("n'apparaîtra plus dans la recherche");
    expect(TEXTE_CONFIRMATION_RETRAIT).toContain("Les candidatures en cours restent en l'état");

    act(() => bouton(conteneur, "Confirmer le retrait")!.click());
    await attendreUnPeu();

    expect(retirer).toHaveBeenCalledWith("L1");
    expect(detail).toHaveBeenCalledTimes(2);
    expect(router.state.location.pathname).toBe("/owner/listings/L1");
    expect(conteneur.textContent).toContain("Annonce retirée");
    expect(bouton(conteneur, "Remettre en ligne")).toBeTruthy();
    expect(bouton(conteneur, "Retirer l'annonce")).toBeUndefined();
  });

  it("« Annuler » referme la confirmation sans rien retirer", async () => {
    detail.mockResolvedValue(annonce());

    const { conteneur } = await afficher();
    act(() => bouton(conteneur, "Retirer l'annonce")!.click());
    act(() => bouton(conteneur, "Annuler")!.click());

    expect(retirer).not.toHaveBeenCalled();
    expect(conteneur.textContent).not.toContain(TEXTE_CONFIRMATION_RETRAIT);
    expect(bouton(conteneur, "Retirer l'annonce")).toBeTruthy();
  });

  it("remet en ligne une annonce retirée puis la recharge", async () => {
    detail
      .mockResolvedValueOnce(annonce({ status: "closed", retiree: true }))
      .mockResolvedValueOnce(annonce());
    reactiver.mockResolvedValue({ message: "Annonce remise en ligne", listing: annonce() });

    const { conteneur } = await afficher();
    act(() => bouton(conteneur, "Remettre en ligne")!.click());
    await attendreUnPeu();

    expect(reactiver).toHaveBeenCalledWith("L1");
    expect(detail).toHaveBeenCalledTimes(2);
    expect(conteneur.textContent).toContain("Annonce remise en ligne");
    expect(bouton(conteneur, "Retirer l'annonce")).toBeTruthy();
  });
});

describe("OwnerListingForm — certification refusée (D4)", () => {
  const rejetee = (paiement_requis: boolean, resoumission_gratuite: boolean) =>
    annonce({
      certification_status: "rejected",
      certification_resoumission: { nb_refus: 1, nb_paiements: 1, paiement_requis, resoumission_gratuite },
    });

  it("re-soumission gratuite : la demande part sans paiement", async () => {
    detail.mockResolvedValueOnce(rejetee(false, true)).mockResolvedValueOnce(
      annonce({ certification_status: "pending" }),
    );
    demanderCertification.mockResolvedValue({ message: "ok", listing: annonce() });

    const { conteneur } = await afficher();
    expect(conteneur.textContent).toContain("Re-soumission gratuite");
    expect(conteneur.textContent).not.toContain("Frais de certification");

    act(() => bouton(conteneur, "Relancer la certification")!.click());
    await attendreUnPeu();

    expect(demanderCertification).toHaveBeenCalledWith("L1");
    expect(initier).not.toHaveBeenCalled();
    expect(detail).toHaveBeenCalledTimes(2);
    expect(conteneur.textContent).toContain("Demande de certification envoyée");
  });

  it("paiement requis : l'état est affiché et le paiement s'ouvre d'abord", async () => {
    detail.mockResolvedValue(rejetee(true, false));

    const { conteneur } = await afficher();
    expect(conteneur.textContent).toContain("Paiement requis (tarif de la certification)");
    expect(conteneur.textContent).toContain("Frais de certification");

    act(() => bouton(conteneur, "Régler et demander la certification")!.click());

    expect(demanderCertification).not.toHaveBeenCalled();
    expect(conteneur.textContent).toContain("Certification de l'annonce");
  });

  it("sur 402, lance le paiement de certification puis recharge l'annonce", async () => {
    const motif =
      "Vous avez déjà utilisé la re-soumission gratuite de cette annonce. Réglez de nouveau les frais de certification pour soumettre votre dossier.";
    detail.mockResolvedValue(rejetee(false, true));
    demanderCertification
      .mockRejectedValueOnce(
        new ApiError(motif, 402, { error: motif, paiement_requis: "certification" }),
      )
      .mockResolvedValueOnce({ message: "ok", listing: annonce() });
    // Passerelle non configurée : le paiement est enregistré en attente.
    initier.mockResolvedValue({ message: "ok", payment_url: null, paiement: { reference: "TCH-1" } });

    const { conteneur } = await afficher();
    act(() => bouton(conteneur, "Relancer la certification")!.click());
    await attendreUnPeu();

    // La modale de paiement s'ouvre, avec le motif du serveur.
    expect(conteneur.textContent).toContain("Certification de l'annonce");
    expect(conteneur.textContent).toContain(motif);

    act(() => bouton(conteneur, "Payer")!.click());
    await attendreUnPeu();

    expect(initier).toHaveBeenCalledWith(
      expect.objectContaining({ type_paiement: "certification", listing_id: "L1" }),
    );
    expect(demanderCertification).toHaveBeenCalledTimes(2);
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it("un 409 de /payments/initier affiche le message du serveur", async () => {
    const message = "Remettez l'annonce en ligne avant de régler sa certification";
    detail.mockResolvedValue(rejetee(true, false));
    initier.mockRejectedValue(new ApiError(message, 409, { error: message }));

    const { conteneur } = await afficher();
    act(() => bouton(conteneur, "Régler et demander la certification")!.click());
    act(() => bouton(conteneur, "Payer")!.click());
    await attendreUnPeu();

    expect(conteneur.textContent).toContain(message);
    expect(demanderCertification).not.toHaveBeenCalled();
  });
});
