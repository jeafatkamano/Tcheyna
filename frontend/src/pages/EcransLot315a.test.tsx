/**
 * Écrans du lot 3.15a : accueil du locataire, liste des annonces, fiche
 * d'une annonce (barre du bas, compteur de photos).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing, User } from "../api";

const session = vi.hoisted(() => ({ user: null as User | null }));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  rechercher: vi.fn(),
  recommandations: vi.fn(),
  passeport: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("../hooks/useGeo", () => ({ useGeo: () => ({ villes: ["Conakry"], quartiers: ["Kipé"], typesBien: [] }) }));
vi.mock("../api", async (original) => {
  const reel = await original<typeof import("../api")>();
  return {
    ...reel,
    listingsAPI: {
      ...reel.listingsAPI,
      detail: api.detail,
      rechercher: api.rechercher,
      recommandations: api.recommandations,
    },
    passportAPI: { ...reel.passportAPI, recuperer: api.passeport },
  };
});

const { ListingDetail } = await import("./ListingDetail");
const { ListingsPage } = await import("./tenant/ListingsPage");
const { TenantDashboard } = await import("./tenant/TenantDashboard");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

const annonce = (extra: Partial<Listing> = {}) =>
  ({
    id: "a1",
    title: "Appartement lumineux",
    quartier: "Kipé",
    ville: "Conakry",
    type_bien: "appartement",
    nb_pieces: 3,
    superficie: 85,
    etage: 2,
    meuble: false,
    prix: 3_500_000,
    devise: "GNF",
    charges: 0,
    caution: 7_000_000,
    cout_entree: 10_500_000,
    status: "active",
    images: [],
    is_certified: false,
    est_vente: false,
    score_compatibilite: 87,
    views_count: 4,
    nb_candidatures: 1,
    description: "Lumineux.",
    equipements: { generateur: true },
    ma_candidature: null,
    is_owner: false,
    ...extra,
  }) as unknown as Listing;

const locataire = (niveau = 1) =>
  ({ id: "u1", role: "tenant", full_name: "Aminata Diallo", trust_level: niveau }) as User;

beforeEach(() => {
  session.user = null;
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function ouvrir(chemin: string, routes: { path: string; Component: () => React.ReactNode }[]) {
  const router = createMemoryRouter([...routes, { path: "*", element: <p>Ailleurs</p> }], {
    initialEntries: [chemin],
  });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine!.render(<RouterProvider router={router} />));
  await act(async () => new Promise((r) => setTimeout(r, 5)));
  return router;
}

const fiche = (extra: Partial<Listing> = {}) => {
  api.detail.mockResolvedValue(annonce(extra));
  return ouvrir("/listing/a1", [{ path: "/listing/:id", Component: ListingDetail }]);
};
const action = () => conteneur.querySelector(".sticky")!;

describe("ListingDetail", () => {
  it("photo unique : pas de compteur ; plusieurs : « 1 / n »", async () => {
    await fiche();
    expect(conteneur.textContent).not.toMatch(/\d \/ \d/);
    act(() => racine?.unmount());

    await fiche({ images: ["a.webp", "b.webp", "c.webp"] });
    expect(conteneur.textContent).toContain("1 / 3");
    act(() => conteneur.querySelector<HTMLButtonElement>('button[aria-label="Photo suivante"]')!.click());
    expect(conteneur.textContent).toContain("2 / 3");
  });

  it("grille des caractéristiques, équipements, retour/partage/favori", async () => {
    await fiche();
    expect(conteneur.querySelector("h1")?.textContent).toBe("Appartement lumineux");
    expect(conteneur.textContent).toContain("85 m²");
    expect(conteneur.textContent).toContain("2e");
    expect(conteneur.textContent).toContain("Groupe électrogène");
    for (const libelle of ["Retour", "Partager l'annonce", "Ajouter aux favoris"]) {
      expect(conteneur.querySelector(`button[aria-label="${libelle}"]`)).not.toBeNull();
    }
  });

  it("visiteur : prix et « Créer un compte pour candidater »", async () => {
    await fiche();
    expect(action().textContent).toMatch(/3,5\s?M\s?GNF/);
    expect(action().textContent).toContain("par mois");
    expect(action().textContent).toContain("Créer un compte pour candidater");
  });

  it("locataire vérifié : « Envoyer ma candidature » ouvre le message ; à la vente, « Contacter le vendeur »", async () => {
    session.user = locataire(1);
    await fiche();
    const bouton = [...action().querySelectorAll("button")].find((b) => b.textContent === "Envoyer ma candidature")!;
    act(() => bouton.click());
    expect(action().querySelector("textarea")).not.toBeNull();
    act(() => racine?.unmount());

    await fiche({ est_vente: true });
    expect(action().textContent).toContain("prix de vente");
    expect(action().textContent).toContain("Contacter le vendeur");
  });

  it("annonce certifiée et niveau insuffisant : la raison, pas le bouton", async () => {
    session.user = locataire(1);
    await fiche({ is_certified: true });
    expect(action().textContent).toContain("Vérifiez votre identité");
    expect(action().textContent).toContain("Les annonces certifiées demandent le niveau 2");
  });

  it("propriétaire : « Gérer mon annonce » ; déjà candidat : l'état de la candidature", async () => {
    session.user = locataire(1);
    await fiche({ is_owner: true });
    expect(action().querySelector('a[href="/owner/listings/a1"]')?.textContent).toBe("Gérer mon annonce");
    act(() => racine?.unmount());

    await fiche({ ma_candidature: { status: "accepted" } as Listing["ma_candidature"] });
    expect(action().textContent).toContain("Candidature acceptée !");
  });
});

describe("ListingsPage", () => {
  const page = { listings: [annonce()], total: 24, pages: 2, page: 1, per_page: 20 };
  const ouvrirListe = () => {
    api.rechercher.mockResolvedValue(page);
    return ouvrir("/tenant/listings", [{ path: "/tenant/listings", Component: ListingsPage }]);
  };

  it("nombre de résultats ; une pastille d'équipement compte comme filtre actif", async () => {
    await ouvrirListe();
    expect(conteneur.textContent).toContain("24 biens");
    const filtres = () => conteneur.querySelector<HTMLButtonElement>('button[aria-label^="Filtres"]')!;
    expect(filtres().getAttribute("aria-label")).toBe("Filtres");

    const pastille = [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Eau courante")!;
    await act(async () => pastille.click());
    expect(pastille.getAttribute("aria-pressed")).toBe("true");
    expect(filtres().getAttribute("aria-label")).toBe("Filtres (1 actifs)");
    expect(api.rechercher).toHaveBeenLastCalledWith(expect.objectContaining({ has_water: true }));
  });

  it("à la vente, le tri par compatibilité disparaît", async () => {
    await ouvrirListe();
    const tri = () => conteneur.querySelector<HTMLSelectElement>('select[aria-label="Trier par"]')!;
    expect([...tri().options].map((o) => o.value)).toContain("match");
    const acheter = [...conteneur.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Acheter")!;
    await act(async () => (acheter as HTMLButtonElement).click());
    expect([...tri().options].map((o) => o.value)).not.toContain("match");
    expect(api.rechercher).toHaveBeenLastCalledWith(
      expect.objectContaining({ transaction: "vente", tri: "recent" }),
    );
  });

  it("le panneau de filtres s'ouvre en feuille du bas", async () => {
    await ouvrirListe();
    act(() => conteneur.querySelector<HTMLButtonElement>('button[aria-label^="Filtres"]')!.click());
    expect(conteneur.querySelector('[role="dialog"]')?.textContent).toContain("Pièces minimum");
  });
});

describe("TenantDashboard", () => {
  it("salutation par le prénom, anneau du score, alerte du numéro, « Pour vous » en cartes compactes", async () => {
    session.user = locataire(0);
    api.passeport.mockResolvedValue({
      score: 72,
      etapes: [{ niveau: 1, titre: "vérifier votre numéro", fait: false }],
    });
    api.recommandations.mockResolvedValue({ listings: [annonce()], total: 1, passeport_complet: true });
    await ouvrir("/tenant/dashboard", [{ path: "/tenant/dashboard", Component: TenantDashboard }]);

    expect(conteneur.querySelector("h1")?.textContent).toBe("Aminata");
    expect(conteneur.querySelector('[aria-label="Score de dossier : 72 sur 100"]')).not.toBeNull();
    expect(conteneur.textContent).toContain("Prochaine étape : vérifier votre numéro");
    expect(conteneur.textContent).toContain("Vérifiez votre numéro de téléphone");
    expect(conteneur.querySelector(".w-\\[220px\\]")).not.toBeNull();
  });
});
