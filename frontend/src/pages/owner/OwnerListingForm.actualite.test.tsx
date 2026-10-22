/**
 * « Toujours d'actualité ? » (D6, lot 2.3) : confirmer une annonce en ligne
 * depuis sa page, et bandeau d'arrivée depuis la relance (`?echeance=`).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing } from "../../api";

const detail = vi.fn();
const confirmer = vi.fn();
const modifier = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    geoAPI: { referentiel: () => Promise.reject(new Error("hors ligne")) },
    listingsAPI: {
      ...reel.listingsAPI,
      detail,
      confirmer,
      modifier,
      documents: () => Promise.resolve({ documents: [], total: 0 }),
    },
  };
});

const { OwnerListingForm } = await import("./OwnerListingForm");
const { ApiError } = await import("../../api/client");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LIBELLE_BOUTON = "Confirmer que l'annonce est toujours d'actualité";

function annonce(surcharge: Partial<Listing> = {}): Listing {
  return {
    id: "L1",
    title: "Appartement Kipé",
    description: "Trois pièces",
    ville: "Conakry",
    quartier: "Kipé",
    adresse: null,
    type_transaction: "location",
    type_bien: "appartement",
    prix: 2_800_000,
    charges: 0,
    caution: null,
    nb_pieces: 3,
    superficie: null,
    etage: null,
    meuble: false,
    disponible_a_partir: null,
    devise: "GNF",
    images: [],
    nb_documents: 0,
    certification_status: "none",
    status: "active",
    equipements: {
      generateur: false,
      eau: true,
      wifi: false,
      securite: false,
      parking: false,
      climatisation: false,
    },
    ...surcharge,
  } as unknown as Listing;
}

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  detail.mockReset();
  confirmer.mockReset();
  modifier.mockReset();
  detail.mockResolvedValue(annonce());
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function ouvrir(url = "/owner/listings/L1") {
  const router = createMemoryRouter([{ path: "/owner/listings/:id", Component: OwnerListingForm }], {
    initialEntries: [url],
  });
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine!.render(<RouterProvider router={router} />));
  await act(() => new Promise((r) => setTimeout(r, 5)));
  return { router, page: conteneur };
}

function bouton(page: HTMLElement) {
  return [...page.querySelectorAll("button")].find((b) => b.textContent?.includes(LIBELLE_BOUTON));
}

async function cliquer(b: HTMLButtonElement) {
  await act(async () => b.click());
  await act(() => new Promise((r) => setTimeout(r, 5)));
}

describe("OwnerListingForm — confirmer qu'une annonce est toujours d'actualité", () => {
  it("annonce en ligne : le bouton, hors du formulaire, confirme et donne la date de retrait", async () => {
    confirmer.mockResolvedValue({
      message: "Annonce confirmée : elle reste en ligne",
      expiration_prevue: "2026-11-21T08:30:00",
      listing: annonce(),
    });
    const { page } = await ouvrir();

    const b = bouton(page)!;
    expect(b).toBeDefined();
    expect(b.type).toBe("button");
    expect(b.closest("form")).toBeNull(); // ne soumet jamais l'annonce

    await cliquer(b);

    expect(confirmer).toHaveBeenCalledWith("L1");
    expect(modifier).not.toHaveBeenCalled();
    expect(page.textContent).toContain(
      "Annonce confirmée. Sans autre activité, elle sera retirée le 21 novembre 2026.",
    );
    expect(bouton(page)).toBeUndefined();
  });

  it("409 : message du serveur, et l'annonce est relue", async () => {
    const message =
      "Cette annonce n'est pas en ligne : remettez-la en ligne pour la publier de nouveau.";
    confirmer.mockRejectedValue(new ApiError(message, 409));
    const { page } = await ouvrir();
    detail.mockResolvedValue(annonce({ status: "closed" }));

    await cliquer(bouton(page)!);

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(detail).toHaveBeenCalledTimes(2);
    expect(bouton(page)).toBeUndefined(); // l'annonce n'est plus en ligne
  });

  it.each([404, 405])("%i (serveur antérieur au lot 2.3) : pas d'erreur bloquante", async (statut) => {
    confirmer.mockRejectedValue(new ApiError("Ressource introuvable", statut));
    const { page } = await ouvrir();

    await cliquer(bouton(page)!);

    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(page.textContent).toContain("La confirmation n'est pas encore disponible");
    expect(bouton(page)).toBeUndefined();
    // La page reste utilisable : le formulaire est toujours là.
    expect(page.querySelector("form")).not.toBeNull();
    expect(page.textContent).toContain("Enregistrer les modifications");
  });

  it("annonce retirée ou conclue : pas de bouton", async () => {
    detail.mockResolvedValue(annonce({ status: "closed" }));
    const { page } = await ouvrir("/owner/listings/L1?echeance=2099-12-31");

    expect(bouton(page)).toBeUndefined();
    expect(page.textContent).not.toContain("sera retirée");
  });
});

describe("OwnerListingForm — arrivée depuis la relance (?echeance=)", () => {
  it("échéance valide : bandeau avec la date, puis le paramètre disparaît après confirmation", async () => {
    confirmer.mockResolvedValue({
      message: "ok",
      expiration_prevue: "2100-01-30T00:00:00",
      listing: annonce(),
    });
    const { page, router } = await ouvrir("/owner/listings/L1?echeance=2099-12-31");

    const bandeau = page.querySelector('[role="alert"]')!;
    expect(bandeau.textContent).toContain(
      "Votre annonce sera retirée le 31 décembre 2099 faute d'activité : confirmez qu'elle est toujours d'actualité",
    );
    // Le même bouton, dans le bandeau.
    expect(bandeau.contains(bouton(page)!)).toBe(true);

    await cliquer(bouton(page)!);

    expect(confirmer).toHaveBeenCalledWith("L1");
    expect(router.state.location.search).toBe("");
    expect(page.textContent).not.toContain("faute d'activité :");
    expect(page.textContent).toContain("elle sera retirée le 30 janvier 2100");
  });

  it("échéance passée : bandeau sans date", async () => {
    const { page } = await ouvrir("/owner/listings/L1?echeance=2020-01-15");

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      "Votre annonce sera bientôt retirée faute d'activité",
    );
    expect(page.textContent).not.toContain("2020");
  });

  it.each([
    "2099-13-01",
    "2099-02-30",
    "2099-1-5",
    "31/12/2099",
    "2099-12-31T00:00",
    "2099-12-31 <img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "",
  ])("échéance invalide (%j) : pas de bandeau, bouton ordinaire", async (valeur) => {
    const { page } = await ouvrir(`/owner/listings/L1?echeance=${encodeURIComponent(valeur)}`);

    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(page.textContent).not.toContain("faute d'activité");
    expect(page.querySelector("img[src='x'], script")).toBeNull();
    expect(bouton(page)).toBeDefined();
  });
});
