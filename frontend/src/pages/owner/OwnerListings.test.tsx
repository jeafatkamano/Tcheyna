/**
 * « Mes biens » (lot 2.2) : annonces retirées listées avec un badge, remise
 * en ligne, refus du serveur (téléphone à vérifier, bien déjà conclu) et état
 * de la re-soumission de certification.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing } from "../../api";

const mesAnnonces = vi.fn();
const reactiver = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return { ...reel, listingsAPI: { ...reel.listingsAPI, mesAnnonces, reactiver } };
});
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "B1", role: "landlord", phone: "622000000", phone_verified: false },
    rafraichir: vi.fn(),
  }),
}));

const { OwnerListings } = await import("./OwnerListings");
const { ApiError } = await import("../../api/client");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function annonce(champs: Partial<Listing> = {}): Listing {
  return {
    id: "L1",
    title: "Appartement à Kipé",
    ville: "Conakry",
    quartier: "Kipé",
    type_bien: "appartement",
    prix: 3_000_000,
    devise: "GNF",
    est_vente: false,
    status: "active",
    views_count: 0,
    nb_candidatures: 0,
    images: [],
    certification_status: "none",
    is_premium: false,
    ...champs,
  } as Listing;
}

function page(listings: Listing[]) {
  return {
    listings,
    total: listings.length,
    stats: { actives: 0, certifiees: 0, vues: 0, candidatures: 0 },
  };
}

function refus(message: string, code: string, statut: number) {
  return new ApiError(message, statut, {
    error: message,
    details: [{ champ: "__root__", code, message }],
  });
}

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  mesAnnonces.mockReset();
  reactiver.mockReset();
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function afficher() {
  const router = createMemoryRouter(
    [
      { path: "/owner/listings", Component: OwnerListings },
      { path: "/owner/listings/nouveau", element: <p>nouvelle annonce</p> },
    ],
    { initialEntries: ["/owner/listings"] },
  );
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await attendreUnPeu();
  return conteneur;
}

function bouton(conteneur: HTMLElement, texte: string) {
  return [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte));
}

describe("OwnerListings — annonces retirées", () => {
  it("demande les annonces retirées et les marque d'un badge « Retirée »", async () => {
    mesAnnonces.mockResolvedValue(
      page([
        annonce({ id: "L1", title: "En ligne" }),
        annonce({ id: "L2", title: "Mise de côté", status: "closed", retiree: true }),
      ]),
    );

    const conteneur = await afficher();

    expect(mesAnnonces).toHaveBeenCalledWith({ inclure_retirees: true });
    const cartes = [...conteneur.querySelectorAll("h3")].map((h) => h.closest("div.rounded-2xl")!);
    expect(cartes[0].textContent).not.toContain("Retirée");
    expect(cartes[1].textContent).toContain("Retirée");
    // Une annonce retirée ne se met pas en avant, elle se remet en ligne.
    expect(cartes[1].textContent).not.toContain("Mettre en avant");
    expect(bouton(cartes[1] as HTMLElement, "Remettre en ligne")).toBeTruthy();
    expect(bouton(cartes[0] as HTMLElement, "Remettre en ligne")).toBeUndefined();
  });

  it("remet en ligne par PUT /reactiver puis recharge la liste", async () => {
    mesAnnonces
      .mockResolvedValueOnce(page([annonce({ status: "closed", retiree: true })]))
      .mockResolvedValueOnce(page([annonce()]));
    reactiver.mockResolvedValue({ message: "Annonce remise en ligne", listing: annonce() });

    const conteneur = await afficher();
    act(() => bouton(conteneur, "Remettre en ligne")!.click());
    await attendreUnPeu();

    expect(reactiver).toHaveBeenCalledWith("L1");
    expect(mesAnnonces).toHaveBeenCalledTimes(2);
    expect(conteneur.textContent).toContain("Annonce remise en ligne");
    expect(conteneur.textContent).not.toContain("Retirée");
  });

  it("sur 403 « telephone_non_verifie », propose la vérification du téléphone", async () => {
    mesAnnonces.mockResolvedValue(page([annonce({ status: "closed", retiree: true })]));
    reactiver.mockRejectedValue(
      refus("Vérifiez votre numéro de téléphone pour publier une annonce.", "telephone_non_verifie", 403),
    );

    const conteneur = await afficher();
    act(() => bouton(conteneur, "Remettre en ligne")!.click());
    await attendreUnPeu();

    expect(conteneur.querySelector('[role="alert"]')?.textContent).toContain(
      "Vérifiez votre numéro de téléphone",
    );
    expect(conteneur.textContent).toContain("Vérification du téléphone");
    expect(bouton(conteneur, "Recevoir le code par SMS")).toBeTruthy();
  });

  it("sur 409 « annonce_conclue », affiche le message et propose une nouvelle annonce", async () => {
    const message =
      "Ce bien a été loué ou vendu : son annonce ne peut pas être remise en ligne. Publiez une nouvelle annonce.";
    mesAnnonces.mockResolvedValue(page([annonce({ status: "closed", retiree: true })]));
    reactiver.mockRejectedValue(refus(message, "annonce_conclue", 409));

    const conteneur = await afficher();
    act(() => bouton(conteneur, "Remettre en ligne")!.click());
    await attendreUnPeu();

    expect(conteneur.textContent).toContain(message);
    expect(bouton(conteneur, "Remettre en ligne")).toBeUndefined();
    const lien = [...conteneur.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Publier une nouvelle annonce"),
    );
    expect(lien?.getAttribute("href")).toBe("/owner/listings/nouveau");
  });

  it("une annonce conclue n'a pas de bouton de remise en ligne", async () => {
    mesAnnonces.mockResolvedValue(page([annonce({ status: "matched", retiree: true })]));

    const conteneur = await afficher();

    expect(bouton(conteneur, "Remettre en ligne")).toBeUndefined();
    expect(conteneur.textContent).toContain("Publier une nouvelle annonce");
    expect(reactiver).not.toHaveBeenCalled();
  });
});

describe("OwnerListings — re-soumission de certification", () => {
  const etat = (paiement_requis: boolean, resoumission_gratuite: boolean) => ({
    nb_refus: 1,
    nb_paiements: 1,
    paiement_requis,
    resoumission_gratuite,
  });

  it("affiche ce que le serveur renvoie pour une certification refusée", async () => {
    mesAnnonces.mockResolvedValue(
      page([
        annonce({ id: "L1", certification_status: "rejected", certification_resoumission: etat(false, true) }),
        annonce({ id: "L2", certification_status: "rejected", certification_resoumission: etat(true, false) }),
        // Hors refus, ou sans le champ (serveur antérieur) : rien n'est affiché.
        annonce({ id: "L3", certification_status: "none", certification_resoumission: etat(true, false) }),
        annonce({ id: "L4", certification_status: "rejected" }),
      ]),
    );

    const conteneur = await afficher();
    const cartes = [...conteneur.querySelectorAll("h3")].map((h) => h.closest("div.rounded-2xl")!);

    expect(cartes[0].textContent).toContain("Re-soumission gratuite");
    expect(cartes[1].textContent).toContain("Paiement requis (tarif de la certification)");
    for (const carte of cartes.slice(2)) {
      expect(carte.textContent).not.toContain("Re-soumission gratuite");
      expect(carte.textContent).not.toContain("Paiement requis");
    }
  });
});
