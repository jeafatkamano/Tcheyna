/**
 * Badge « Propriétaire vérifié » (D3) : affiché seulement quand le serveur
 * l'envoie à vrai. Faux ou absent (backend pas encore déployé) : rien.
 * Même libellé pour une agence, tant qu'un libellé propre n'est pas décidé.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { Listing, User } from "../api";
import { BadgeProprietaireVerifie } from "./BadgeVerification";
import { ListingCard } from "./ListingCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;

function rendre(element: React.ReactNode) {
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<MemoryRouter>{element}</MemoryRouter>));
  return conteneur;
}

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

function bailleur(champs: Partial<User> = {}): User {
  return {
    id: "B1",
    full_name: "Ibrahima Sow",
    role: "landlord",
    trust_level: 2,
    badge: "Identifié",
    phone_verified: true,
    cni_verified: true,
    income_verified: false,
    preferred_lang: "fr",
    nb_avis: 0,
    ...champs,
  };
}

function annonce(landlord?: User): Listing {
  return {
    id: "L1",
    title: "Appartement à Kipé",
    description: "",
    pays: "Guinée",
    ville: "Conakry",
    quartier: "Kipé",
    type_transaction: "location",
    est_vente: false,
    type_bien: "appartement",
    prix: 2_800_000,
    charges: 0,
    cout_entree: 2_800_000,
    devise: "GNF",
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
    views_count: 0,
    nb_candidatures: 0,
    images: [],
    landlord,
  };
}

describe("BadgeProprietaireVerifie", () => {
  it("affiche un libellé lisible, l'icône étant décorative", () => {
    const conteneur = rendre(
      <BadgeProprietaireVerifie utilisateur={bailleur({ proprietaire_verifie: true })} />,
    );
    expect(conteneur.textContent).toBe("Propriétaire vérifié");
    expect(conteneur.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("même libellé pour une agence", () => {
    const conteneur = rendre(
      <BadgeProprietaireVerifie
        utilisateur={bailleur({ role: "agency", proprietaire_verifie: true })}
      />,
    );
    expect(conteneur.textContent).toBe("Propriétaire vérifié");
  });

  it.each([
    ["faux", bailleur({ proprietaire_verifie: false })],
    ["absent", bailleur()],
    ["sans utilisateur", undefined],
    ["nul", null],
  ])("rien quand le champ est %s", (_cas, utilisateur) => {
    const conteneur = rendre(<BadgeProprietaireVerifie utilisateur={utilisateur} />);
    expect(conteneur.textContent).toBe("");
  });
});

describe("ListingCard — badge du bailleur", () => {
  it("présent quand le bailleur est vérifié", () => {
    const conteneur = rendre(<ListingCard listing={annonce(bailleur({ proprietaire_verifie: true }))} />);
    expect(conteneur.textContent).toContain("Propriétaire vérifié");
  });

  it("présent pour une agence vérifiée", () => {
    const conteneur = rendre(
      <ListingCard listing={annonce(bailleur({ role: "agency", proprietaire_verifie: true }))} />,
    );
    expect(conteneur.textContent).toContain("Propriétaire vérifié");
  });

  it.each([
    ["faux", annonce(bailleur({ proprietaire_verifie: false }))],
    ["absent (serveur antérieur)", annonce(bailleur())],
    ["sans bailleur", annonce(undefined)],
  ])("absent quand le champ est %s", (_cas, listing) => {
    const conteneur = rendre(<ListingCard listing={listing} />);
    expect(conteneur.textContent).toContain("Appartement à Kipé");
    expect(conteneur.textContent).not.toContain("Propriétaire vérifié");
  });
});
