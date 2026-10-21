/**
 * Création d'annonce : quitter la page pendant l'envoi des photos ne doit pas
 * y ramener l'utilisateur quand l'envoi s'arrête.
 *
 * Modification : un refus du serveur (changement de type de transaction avec
 * des candidatures en cours, D1) s'affiche sans perdre la saisie.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const televerserPhoto = vi.fn();
const creer = vi.fn();
const detail = vi.fn();
const modifier = vi.fn();
const documents = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    geoAPI: { referentiel: () => Promise.reject(new Error("hors ligne")) },
    listingsAPI: { ...reel.listingsAPI, creer, televerserPhoto, detail, modifier, documents },
  };
});
vi.mock("../../lib/image", async (original) => ({
  ...(await original<typeof import("../../lib/image")>()),
  preparerPhoto: async (f: File) => f, // pas de canvas dans happy-dom
}));

const { OwnerListingForm } = await import("./OwnerListingForm");
const { ApiError, MESSAGE_RESEAU } = await import("../../api/client");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  for (const f of [televerserPhoto, creer, detail, modifier, documents]) f.mockReset();
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function creerAvecUnePhoto() {
  const router = createMemoryRouter(
    [
      { path: "/owner/listings/nouveau", Component: OwnerListingForm },
      { path: "/owner/listings/:id", element: <p>annonce</p> },
      { path: "/ailleurs", element: <p>ailleurs</p> },
    ],
    { initialEntries: ["/owner/listings/nouveau"] },
  );
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));

  const champ = conteneur.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(champ, "files", {
    value: [new File([new Uint8Array(10)], "salon.jpg", { type: "image/jpeg" })],
  });
  act(() => champ.dispatchEvent(new Event("change", { bubbles: true })));
  await attendreUnPeu();

  act(() => {
    conteneur.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await attendreUnPeu();
  return router;
}

describe("OwnerListingForm — création avec photos", () => {
  it("ne ramène pas sur l'annonce un utilisateur parti pendant l'envoi", async () => {
    creer.mockResolvedValue({ message: "ok", listing: { id: "L1" } });
    // Envoi qui ne finit jamais, mais obéit à l'annulation (démontage).
    televerserPhoto.mockImplementation(
      (_id: string, _f: File, { signal }: { signal: AbortSignal }) =>
        new Promise((_r, rejeter) =>
          signal.addEventListener("abort", () => rejeter(new DOMException("annulé", "AbortError"))),
        ),
    );

    const router = await creerAvecUnePhoto();
    expect(televerserPhoto).toHaveBeenCalledTimes(1);

    await act(() => router.navigate("/ailleurs"));
    await attendreUnPeu();

    expect(router.state.location.pathname).toBe("/ailleurs");
  });

  it("va sur l'annonce une fois toutes les photos envoyées", async () => {
    creer.mockResolvedValue({ message: "ok", listing: { id: "L1" } });
    televerserPhoto.mockResolvedValue({ message: "ok", images: ["/uploads/a.jpg"] });

    const router = await creerAvecUnePhoto();

    expect(router.state.location.pathname).toBe("/owner/listings/L1");
  });

  it("après un échec puis « Réessayer » réussi, bandeau retiré et navigation", async () => {
    creer.mockResolvedValue({ message: "ok", listing: { id: "L1" } });
    televerserPhoto
      .mockRejectedValueOnce(new ApiError(MESSAGE_RESEAU, 0))
      .mockResolvedValueOnce({ message: "ok", images: ["/uploads/a.webp"] });

    const router = await creerAvecUnePhoto();
    const page = document.body;
    expect(router.state.location.pathname).toBe("/owner/listings/nouveau");
    expect(page.textContent).toContain("Certaines photos restent à envoyer");

    const bouton = page.querySelector<HTMLButtonElement>('button[aria-label^="Réessayer"]')!;
    act(() => bouton.click());
    await attendreUnPeu();

    expect(televerserPhoto).toHaveBeenCalledTimes(2);
    expect(router.state.location.pathname).toBe("/owner/listings/L1");
  });
});

describe("OwnerListingForm — modification refusée par le serveur", () => {
  it("409 du changement de type : message du serveur, saisie conservée", async () => {
    const message =
      "Le type de transaction ne peut pas changer tant que des candidatures sont en attente ou acceptées sur cette annonce : refusez-les d'abord.";
    detail.mockResolvedValue({
      id: "L1",
      title: "Villa de test",
      description: "Une description de test assez longue.",
      pays: "Guinée",
      ville: "Conakry",
      quartier: "Kaloum",
      type_transaction: "location",
      est_vente: false,
      type_bien: "villa",
      prix: 3_000_000,
      charges: 0,
      devise: "GNF",
      nb_pieces: 4,
      meuble: false,
      equipements: {
        generateur: false,
        eau: true,
        wifi: false,
        securite: false,
        parking: false,
        climatisation: false,
      },
      certification_status: "none",
      nb_documents: 0,
      is_certified: false,
      is_premium: false,
      status: "active",
      images: [],
    });
    documents.mockResolvedValue({ documents: [], total: 0 });
    modifier.mockRejectedValue(new ApiError(message, 409, { error: message }));

    const router = createMemoryRouter([{ path: "/owner/listings/:id", Component: OwnerListingForm }], {
      initialEntries: ["/owner/listings/L1"],
    });
    const conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine!.render(<RouterProvider router={router} />));
    await attendreUnPeu();

    const versVente = [...conteneur.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Mettre en vente"),
    )!;
    act(() => versVente.click());
    act(() => {
      conteneur.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await attendreUnPeu();

    expect(modifier).toHaveBeenCalledWith("L1", expect.objectContaining({ type_transaction: "vente" }));
    expect(conteneur.textContent).toContain(message);
    // Le formulaire est toujours là, avec la saisie : type « vente » et titre.
    expect(conteneur.querySelector("form")).not.toBeNull();
    expect(conteneur.textContent).toContain("aucun frais de mise en");
    const titre = [...conteneur.querySelectorAll<HTMLInputElement>("input")].find(
      (i) => i.value === "Villa de test",
    );
    expect(titre).toBeDefined();
    expect(router.state.location.pathname).toBe("/owner/listings/L1");
  });
});
