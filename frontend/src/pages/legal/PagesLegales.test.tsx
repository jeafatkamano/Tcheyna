import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { EDITEUR, type ChampEditeur, type IdentiteEditeur } from "../../lib/editeur";
import { CGU } from "./CGU";
import { Confidentialite } from "./Confidentialite";
import { MentionsLegales } from "./MentionsLegales";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Les valeurs factices ne vivent qu'ici : `editeur.ts` reste sans valeur
// inventée. L'objet est modifié en place puis restauré après chaque test.
const editeurModifiable = EDITEUR as IdentiteEditeur;
const ORIGINAL: IdentiteEditeur = { ...EDITEUR };
const CHAMPS = Object.keys(EDITEUR) as ChampEditeur[];

function remplir(valeur: (champ: ChampEditeur) => string) {
  for (const champ of CHAMPS) editeurModifiable[champ] = valeur(champ);
}

let racine: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  Object.assign(editeurModifiable, ORIGINAL);
});

function afficher(page: ReactElement) {
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<MemoryRouter>{page}</MemoryRouter>));
  return conteneur;
}

/** Champs signalés « à compléter » dans la page. */
function reperes(conteneur: HTMLElement): string[] {
  return [...conteneur.querySelectorAll("[data-a-completer]")].map((n) => n.getAttribute("data-champ")!);
}

/** Champs de l'éditeur que la page affiche, renseignés ou non. */
function champsAffiches(conteneur: HTMLElement): Set<string> {
  return new Set([...conteneur.querySelectorAll("[data-champ]")].map((n) => n.getAttribute("data-champ")!));
}

const PAGES: [string, () => ReactElement, ChampEditeur[]][] = [
  [
    "Mentions légales",
    () => <MentionsLegales />,
    [
      "nomCommercial",
      "denomination",
      "formeJuridique",
      "rccm",
      "nif",
      "siege",
      "directeurPublication",
      "emailContact",
      "telephone",
      "emailSignalement",
    ],
  ],
  ["Conditions générales", () => <CGU />, ["denomination", "juridiction", "emailContact"]],
  ["Confidentialité", () => <Confidentialite />, ["denomination", "emailDonnees", "autoriteDonnees"]],
];

describe.each(PAGES)("%s", (_nom, page, champsAttendus) => {
  it("s'affiche avec l'identité entièrement vide et signale chaque champ manquant", () => {
    remplir(() => "");
    const conteneur = afficher(page());

    expect(conteneur.querySelector("h1")).not.toBeNull();
    expect(new Set(reperes(conteneur))).toEqual(champsAffiches(conteneur));
    for (const champ of champsAttendus) expect(reperes(conteneur)).toContain(champ);
    for (const n of conteneur.querySelectorAll("[data-a-completer]")) {
      expect(n.textContent).toMatch(/^\[à compléter : .+\]$/);
    }
  });

  it("signale exactement les champs vides de editeur.ts tel qu'il est livré", () => {
    const conteneur = afficher(page());
    const vides = CHAMPS.filter((c) => EDITEUR[c].trim() === "");

    for (const champ of champsAffiches(conteneur)) {
      expect(reperes(conteneur).includes(champ)).toBe(vides.includes(champ as ChampEditeur));
    }
  });

  it("affiche les valeurs renseignées et plus aucun repère", () => {
    remplir((champ) => `valeur-test-${champ}`);
    const conteneur = afficher(page());

    expect(reperes(conteneur)).toEqual([]);
    for (const champ of champsAttendus) expect(conteneur.textContent).toContain(`valeur-test-${champ}`);
    expect(conteneur.textContent).not.toContain("à compléter");
  });
});

describe("désignation de l'éditeur", () => {
  it("nomme Kamino dans les conditions générales et la politique de confidentialité", () => {
    for (const page of [<CGU key="cgu" />, <Confidentialite key="conf" />]) {
      const conteneur = afficher(page);
      expect(conteneur.textContent).toMatch(/(éditée par|traitement est) Kamino/);
      act(() => racine?.unmount());
      racine = null;
    }
  });

  it("ne répète pas la dénomination quand elle se confond avec le nom commercial", () => {
    editeurModifiable.denomination = "Kamino";
    const conteneur = afficher(<CGU />);
    expect(conteneur.textContent).toContain("éditée par Kamino, dont");
  });

  it("retire l'avertissement des mentions légales quand plus rien ne manque", () => {
    const incomplet = afficher(<MentionsLegales />);
    expect(incomplet.textContent).toContain("doivent être renseignés par l'éditeur");
    act(() => racine?.unmount());

    remplir((champ) => `valeur-test-${champ}`);
    const complet = afficher(<MentionsLegales />);
    expect(complet.textContent).not.toContain("doivent être renseignés par l'éditeur");
  });
});
