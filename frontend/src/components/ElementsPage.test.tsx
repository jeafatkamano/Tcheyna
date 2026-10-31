/**
 * Éléments partagés des pages de l'espace connecté (lot 3.15a) : en-tête,
 * pastille, segment, feuille du bas, carte d'annonce ; et la barre haute de
 * Layout, masquée sur les pages qui dessinent leur propre en-tête.
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Listing, User } from "../api";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", role: "tenant", full_name: "Aminata Diallo", trust_level: 1 } as User,
    chargement: false,
    deconnecter: vi.fn(),
  }),
}));
vi.mock("../api", async (original) => {
  const reel = await original<typeof import("../api")>();
  return {
    ...reel,
    messagesAPI: { ...reel.messagesAPI, nonLus: () => Promise.resolve({ non_lus: 2 }) },
    notificationsAPI: { ...reel.notificationsAPI, compteur: () => Promise.resolve({ non_lues: 3 }) },
  };
});

const { CoqueContext } = await import("./coque");
const { BoutonMenuAvatar, BoutonNotifications, EnTetePage } = await import("./EnTetePage");
const { FeuilleBas } = await import("./FeuilleBas");
const { Layout } = await import("./Layout");
const { ListingCard } = await import("./ListingCard");
const { Pastille, PastilleCompatibilite } = await import("./Pastille");
const { Segment } = await import("./Segment");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

function rendre(element: ReactNode) {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/"] });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return conteneur;
}

const annonce = (extra: Partial<Listing> = {}) =>
  ({
    id: "a1",
    title: "Appartement lumineux",
    quartier: "Kipé",
    ville: "Conakry",
    type_bien: "appartement",
    nb_pieces: 3,
    superficie: 85,
    prix: 3_500_000,
    devise: "GNF",
    charges: 0,
    status: "active",
    images: [],
    is_certified: true,
    is_premium: false,
    est_vente: false,
    score_compatibilite: 87,
    equipements: {},
    ...extra,
  }) as unknown as Listing;

describe("EnTetePage", () => {
  it("titre, éléments latéraux, contenu ; le fond passe sous la barre d'état", () => {
    const c = rendre(
      <EnTetePage titre="Annonces" droite={<button type="button">Action</button>} arrondi>
        <p>Recherche</p>
      </EnTetePage>,
    );
    const entete = c.querySelector("header")!;
    expect(c.querySelector("h1")?.textContent).toBe("Annonces");
    expect(entete.textContent).toContain("Recherche");
    expect(entete.style.paddingTop).toContain("--inset-haut");
    expect(entete.style.borderRadius).toMatch(/28px 28px$/);
  });

  it("cloche et avatar : compteur annoncé, menu ouvert par l'avatar", () => {
    const ouvrirMenu = vi.fn();
    const c = rendre(
      <CoqueContext.Provider value={{ ouvrirMenu, notifsNonLues: 2, messagesNonLus: 0 }}>
        <BoutonMenuAvatar nom="Aminata Diallo" />
        <BoutonNotifications />
      </CoqueContext.Provider>,
    );
    expect(c.querySelector('a[href="/notifications"]')?.getAttribute("aria-label")).toBe(
      "Notifications (2 non lues)",
    );
    act(() => c.querySelector<HTMLButtonElement>('button[aria-label="Ouvrir le menu"]')!.click());
    expect(ouvrirMenu).toHaveBeenCalledOnce();
  });
});

describe("Pastille", () => {
  it("étiquette simple, ou bouton à bascule annoncé par aria-pressed", () => {
    const onClick = vi.fn();
    const c = rendre(
      <>
        <Pastille forme="etiquette">Parking</Pastille>
        <Pastille actif onClick={onClick}>
          Eau courante
        </Pastille>
      </>,
    );
    expect(c.querySelector("span")?.textContent).toBe("Parking");
    const bouton = c.querySelector("button")!;
    expect(bouton.getAttribute("aria-pressed")).toBe("true");
    act(() => bouton.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("compatibilité : rien sans score", () => {
    const c = rendre(
      <>
        <PastilleCompatibilite score={87} />
        <PastilleCompatibilite score={null} />
      </>,
    );
    expect(c.textContent).toBe("87 % compatible");
  });
});

describe("Segment", () => {
  it("groupe de choix : un seul coché, clic et flèches changent le choix", () => {
    const onChange = vi.fn();
    const c = rendre(
      <Segment
        libelle="Type de recherche"
        options={[
          { valeur: "location", label: "Louer" },
          { valeur: "vente", label: "Acheter" },
        ]}
        valeur="location"
        onChange={onChange}
      />,
    );
    const groupe = c.querySelector('[role="radiogroup"]')!;
    expect(groupe.getAttribute("aria-label")).toBe("Type de recherche");
    const choix = [...c.querySelectorAll('[role="radio"]')];
    expect(choix.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    act(() => (choix[1] as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith("vente");
    onChange.mockClear();
    act(() => {
      choix[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("vente");
  });
});

describe("FeuilleBas", () => {
  it("fenêtre modale titrée ; Échap, le fond et la croix la ferment", () => {
    const onFermer = vi.fn();
    const c = rendre(
      <FeuilleBas titre="Filtres" onFermer={onFermer} pied={<button type="button">Voir les résultats</button>}>
        <p>Quartier</p>
      </FeuilleBas>,
    );
    const dialogue = c.querySelector('[role="dialog"]')!;
    expect(dialogue.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialogue.getAttribute("aria-labelledby")!)?.textContent).toBe("Filtres");
    expect(document.activeElement).toBe(dialogue);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    act(() => c.querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click());
    act(() => (c.querySelector('[aria-hidden="true"].absolute') as HTMLElement).click());
    expect(onFermer).toHaveBeenCalledTimes(3);
  });
});

describe("ListingCard", () => {
  it("carte pleine : badge Certifiée, compatibilité, résumé, prix, favori", () => {
    const onToggleFavori = vi.fn();
    const c = rendre(<ListingCard listing={annonce()} onToggleFavori={onToggleFavori} />);
    expect(c.textContent).toContain("Certifiée");
    expect(c.textContent).toContain("87 % compatible");
    expect(c.textContent).toContain("Kipé · 3 pièces · 85 m²");
    expect(c.textContent).toContain("/mois");
    expect(c.textContent).toContain("Disponible");
    const favori = c.querySelector<HTMLButtonElement>('button[aria-label="Ajouter aux favoris"]')!;
    act(() => favori.click());
    expect(onToggleFavori).toHaveBeenCalledOnce();
    expect(c.querySelector("a")?.getAttribute("href")).toBe("/listing/a1");
  });

  it("carte compacte : 220 px, compatibilité courte, sans surface", () => {
    const c = rendre(<ListingCard listing={annonce()} compacte />);
    expect((c.firstElementChild as HTMLElement).className).toContain("w-[220px]");
    expect(c.textContent).toContain("87 %");
    expect(c.textContent).not.toContain("compatible");
    expect(c.textContent).toContain("Kipé · 3 pièces");
    expect(c.textContent).not.toContain("85 m²");
  });

  it("vente : « À vendre », pas de /mois", () => {
    const c = rendre(<ListingCard listing={annonce({ est_vente: true, score_compatibilite: undefined })} />);
    expect(c.textContent).toContain("À vendre");
    expect(c.textContent).not.toContain("/mois");
  });
});

describe("Layout", () => {
  async function ouvrirLayout(enTetePropre: boolean) {
    const router = createMemoryRouter(
      [
        {
          element: <Layout />,
          children: [
            {
              path: "/tenant/dashboard",
              handle: enTetePropre ? { enTetePropre: true } : undefined,
              element: <Outlet />,
            },
          ],
        },
      ],
      { initialEntries: ["/tenant/dashboard"] },
    );
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine!.render(<RouterProvider router={router} />));
  }

  it("barre haute affichée par défaut, masquée quand la page a son propre en-tête", async () => {
    await ouvrirLayout(false);
    expect(conteneur.querySelector("header")).not.toBeNull();
    act(() => racine?.unmount());

    await ouvrirLayout(true);
    expect(conteneur.querySelector("header")).toBeNull();
    // La navigation du bas reste.
    expect(conteneur.querySelector('a[href="/tenant/listings"]')).not.toBeNull();
  });
});
