/**
 * Création d'annonce : quitter la page pendant l'envoi des photos ne doit pas
 * y ramener l'utilisateur quand l'envoi s'arrête.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const televerserPhoto = vi.fn();
const creer = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    geoAPI: { referentiel: () => Promise.reject(new Error("hors ligne")) },
    listingsAPI: { ...reel.listingsAPI, creer, televerserPhoto },
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
  televerserPhoto.mockReset();
  creer.mockReset();
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
