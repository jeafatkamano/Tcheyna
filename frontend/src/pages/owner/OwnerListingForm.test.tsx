/**
 * Création d'annonce : quitter la page pendant l'envoi des photos ne doit pas
 * y ramener l'utilisateur quand l'envoi s'arrête. Publier exige un téléphone
 * vérifié (D3) : bandeau avant la saisie, refus 403 relayé avec la
 * vérification sur place, brouillon conservé.
 *
 * Modification : un refus du serveur (changement de type de transaction avec
 * des candidatures en cours, D1) s'affiche sans perdre la saisie.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../../api";

const televerserPhoto = vi.fn();
const creer = vi.fn();
const envoyerOTP = vi.fn();
const verifierOTP = vi.fn();

/** Utilisateur connecté, modifiable par test (le contexte est simulé). */
const auth: { user: Partial<User> | null; rafraichir: () => Promise<null> } = {
  user: null,
  rafraichir: async () => null,
};
vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));
const detail = vi.fn();
const modifier = vi.fn();
const documents = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    geoAPI: { referentiel: () => Promise.reject(new Error("hors ligne")) },
    listingsAPI: { ...reel.listingsAPI, creer, televerserPhoto, detail, modifier, documents },
    authAPI: { ...reel.authAPI, envoyerOTP, verifierOTP },
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
  envoyerOTP.mockReset();
  verifierOTP.mockReset();
  auth.user = { id: "U1", role: "landlord", phone: "622000000", phone_verified: true };
  auth.rafraichir = async () => null;
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

/* ─── Publication réservée au téléphone vérifié (D3) ───────── */

/** Saisie dans un champ contrôlé par React (le setter natif, puis `input`). */
function saisir(champ: HTMLInputElement | HTMLTextAreaElement, valeur: string) {
  const proto = champ instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!.call(champ, valeur);
  act(() => champ.dispatchEvent(new Event("input", { bubbles: true })));
}

function boutons(texte: string) {
  return [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === texte);
}

function monterCreation() {
  const router = createMemoryRouter(
    [
      { path: "/owner/listings/nouveau", Component: OwnerListingForm },
      { path: "/owner/listings/:id", element: <p>annonce</p> },
    ],
    { initialEntries: ["/owner/listings/nouveau"] },
  );
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return { router, conteneur };
}

async function soumettre(conteneur: HTMLElement) {
  act(() => {
    conteneur.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await attendreUnPeu();
}

const MESSAGE_SERVEUR = "Vérifiez votre numéro de téléphone pour publier une annonce.";
const AVERTISSEMENT = "Vérifiez votre numéro pour publier une annonce.";

/** Corps exact renvoyé par POST /api/listings (PR #31). */
function refusTelephone() {
  return new ApiError(MESSAGE_SERVEUR, 403, {
    error: MESSAGE_SERVEUR,
    details: [{ champ: "__root__", code: "telephone_non_verifie", message: MESSAGE_SERVEUR }],
  });
}

describe("OwnerListingForm — téléphone vérifié pour publier", () => {
  it("prévient avant la saisie un bailleur au téléphone non vérifié", () => {
    auth.user = { ...auth.user, phone_verified: false };
    monterCreation();

    const bandeau = document.querySelector('[role="status"]');
    expect(bandeau?.textContent).toBe(AVERTISSEMENT);
    expect(boutons("Vérifier mon numéro")).toHaveLength(1);
  });

  it("prévient aussi une agence", () => {
    auth.user = { ...auth.user, role: "agency", phone_verified: false };
    monterCreation();

    expect(document.body.textContent).toContain(AVERTISSEMENT);
    expect(boutons("Vérifier mon numéro")).toHaveLength(1);
  });

  it("aucun bandeau quand le téléphone est vérifié", () => {
    monterCreation();

    expect(document.body.textContent).not.toContain("Vérifiez votre numéro");
    expect(boutons("Vérifier mon numéro")).toHaveLength(0);
  });

  it("refus 403 : message du serveur, bouton de vérification, brouillon conservé", async () => {
    creer.mockRejectedValue(refusTelephone());
    const { router, conteneur } = monterCreation();
    saisir(conteneur.querySelector<HTMLInputElement>("#titre")!, "Studio meublé à Kipé");
    saisir(conteneur.querySelector<HTMLTextAreaElement>("#desc")!, "Proche du marché.");
    saisir(conteneur.querySelector<HTMLInputElement>("#prix")!, "1500000");

    await soumettre(conteneur);

    const alertes = [...document.querySelectorAll('[role="alert"]')];
    expect(alertes).toHaveLength(1); // pas de doublon avec le message générique
    expect(alertes[0].textContent).toBe(MESSAGE_SERVEUR);
    expect(boutons("Vérifier mon numéro")).toHaveLength(1);
    // Le bandeau est hors du formulaire : sa vérification ne soumet pas l'annonce.
    expect(conteneur.querySelector("form")!.contains(boutons("Vérifier mon numéro")[0])).toBe(false);
    expect(router.state.location.pathname).toBe("/owner/listings/nouveau");
    expect(conteneur.querySelector<HTMLInputElement>("#titre")!.value).toBe("Studio meublé à Kipé");
    expect(conteneur.querySelector<HTMLTextAreaElement>("#desc")!.value).toBe("Proche du marché.");
    expect(conteneur.querySelector<HTMLInputElement>("#prix")!.value).toBe("1500000");
  });

  it("une autre erreur garde le message générique, sans bouton de vérification", async () => {
    const message = "Action réservée aux propriétaires ou agences";
    creer.mockRejectedValue(new ApiError(message, 403, { error: message }));
    const { conteneur } = monterCreation();

    await soumettre(conteneur);

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(boutons("Vérifier mon numéro")).toHaveLength(0);
  });

  it("après vérification sur place, republie sans ressaisir", async () => {
    auth.user = { ...auth.user, phone_verified: false };
    let rafraichi = false;
    auth.rafraichir = async () => {
      rafraichi = true;
      auth.user = { ...auth.user, phone_verified: true };
      return null;
    };
    creer
      .mockRejectedValueOnce(refusTelephone())
      .mockResolvedValueOnce({ message: "ok", listing: { id: "L9" } });
    envoyerOTP.mockResolvedValue({ message: "ok", phone: "+224622000000", expire_dans: 300 });
    verifierOTP.mockResolvedValue({ message: "ok", trust_level: 1, badge: "Basique" });

    const { router, conteneur } = monterCreation();
    saisir(conteneur.querySelector<HTMLInputElement>("#titre")!, "Villa à Lambanyi");
    await soumettre(conteneur);
    expect(creer).toHaveBeenCalledTimes(1);

    // Le refus remplace l'avertissement : un seul bandeau, qui reçoit le focus.
    const ouvrir = boutons("Vérifier mon numéro");
    expect(ouvrir).toHaveLength(1);
    expect(document.activeElement?.contains(ouvrir[0])).toBe(true);
    act(() => ouvrir[0].click());
    expect(ouvrir[0].getAttribute("aria-expanded")).toBe("true");

    act(() => boutons("Recevoir le code par SMS")[0].click());
    await attendreUnPeu();
    expect(envoyerOTP).toHaveBeenCalledWith("622000000");

    saisir(
      document.querySelector<HTMLInputElement>('input[aria-label="Code de vérification"]')!,
      "123456",
    );
    act(() => boutons("Valider le code")[0].click());
    await attendreUnPeu();

    expect(verifierOTP).toHaveBeenCalledWith("123456");
    expect(rafraichi).toBe(true);
    expect(document.body.textContent).not.toContain("Vérifiez votre numéro");
    expect(document.body.textContent).toContain("Numéro vérifié : vous pouvez publier votre annonce.");
    expect(conteneur.querySelector<HTMLInputElement>("#titre")!.value).toBe("Villa à Lambanyi");
    // Le bandeau a quitté la page : le focus va au bouton « Publier », pas à <body>.
    expect(document.activeElement?.textContent).toBe("Publier l'annonce");

    await soumettre(conteneur);

    expect(creer).toHaveBeenCalledTimes(2);
    expect(creer.mock.calls[1][0]).toMatchObject({ title_fr: "Villa à Lambanyi" });
    expect(router.state.location.pathname).toBe("/owner/listings/L9");
  });
});

describe("OwnerListingForm — vérification commencée avant le refus", () => {
  it("le 403 transforme le bandeau sans perdre la vérification en cours", async () => {
    auth.user = { ...auth.user, phone_verified: false };
    creer.mockRejectedValue(refusTelephone());
    envoyerOTP.mockResolvedValue({ message: "ok", phone: "+224622000000", expire_dans: 300 });

    const { conteneur } = monterCreation();
    act(() => boutons("Vérifier mon numéro")[0].click());
    act(() => boutons("Recevoir le code par SMS")[0].click());
    await attendreUnPeu();
    const champCode = () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Code de vérification"]');
    saisir(champCode()!, "12");

    await soumettre(conteneur);

    // Même bandeau : il passe en alerte avec le message du serveur…
    expect(document.querySelector('[role="status"]')).toBeNull();
    const alertes = [...document.querySelectorAll('[role="alert"]')];
    expect(alertes).toHaveLength(1);
    expect(alertes[0].textContent).toBe(MESSAGE_SERVEUR);
    expect(boutons("Masquer la vérification")).toHaveLength(1);
    // … et la vérification reste à l'étape du code, saisie comprise.
    expect(champCode()?.value).toBe("12");
    expect(envoyerOTP).toHaveBeenCalledTimes(1);
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
