/**
 * Messagerie bornée (lot 2.8) : discussion fermée, refus d'envoi 409,
 * messages plus anciens, messages types, et serveur antérieur au lot 2.8.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Conversation, Message, PageFil, User } from "../../api";

const filParMatch = vi.fn();
const envoyer = vi.fn();
const modeles = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    messagesAPI: { ...reel.messagesAPI, filParMatch, envoyer, modeles },
    // Date de visite (lot 3.15b) : pas d'appel réseau réel dans les tests.
    matchesAPI: { ...reel.matchesAPI, detail: () => Promise.resolve({ id: "M1", visite_date: null }) },
  };
});
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "moi", role: "tenant" } }),
}));

const { ConversationPage } = await import("./ConversationPage");
const { ApiError } = await import("../../api/client");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function msg(n: number): Message {
  return {
    id: `m${String(n).padStart(3, "0")}`,
    sender_id: n % 2 ? "moi" : "autre",
    contenu: `Message ${n}`,
    lu: false,
    created_at: new Date(Date.UTC(2026, 9, 20, 8) + n * 60_000).toISOString().slice(0, 19),
  };
}

function plage(de: number, a: number) {
  return Array.from({ length: a - de + 1 }, (_, i) => msg(de + i));
}

function conversation(extra: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    match_id: "M1",
    nb_non_lus: 0,
    interlocuteur: { id: "autre", full_name: "Awa Camara" } as User,
    messages: plage(1, 3),
    ...extra,
  } as Conversation;
}

function page(messages: Message[], plusAnciens: boolean): Conversation {
  return conversation({
    messages,
    ecriture_fermee: false,
    motif_fermeture: null,
    pagination: { limite: 30, plus_anciens: plusAnciens, curseur: plusAnciens ? messages[0].id : null },
  });
}

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  filParMatch.mockReset();
  envoyer.mockReset();
  modeles.mockReset();
  modeles.mockResolvedValue({ cote: "locataire", modeles: [] });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function ouvrir() {
  const router = createMemoryRouter([{ path: "/messages/:matchId", Component: ConversationPage }], {
    initialEntries: ["/messages/M1"],
  });
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await attendreUnPeu();
  return conteneur;
}

/** Sondage immédiat : `useApi` relance la requête au retour sur l'onglet. */
async function sonder() {
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await attendreUnPeu();
}

function saisir(champ: HTMLTextAreaElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(champ, texte);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const champ = (c: HTMLElement) => c.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
const boutonEnvoyer = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Envoyer"]')!;
const bulles = (c: HTMLElement) =>
  [...c.querySelectorAll("p.whitespace-pre-wrap")].map((p) => p.textContent);
const bouton = (c: HTMLElement, texte: string) =>
  [...c.querySelectorAll("button")].find((b) => b.textContent === texte);

describe("ConversationPage — discussion fermée", () => {
  it.each([
    ["candidature_refusee", "La candidature a été refusée"],
    ["candidature_retiree", "La candidature a été retirée"],
    ["candidature_close", "La discussion est fermée"],
  ] as const)("motif %s : saisie grisée, explication liée, historique lisible", async (motif, texte) => {
    filParMatch.mockResolvedValue(
      conversation({ ecriture_fermee: true, motif_fermeture: motif }),
    );
    modeles.mockResolvedValue({ cote: "locataire", modeles: [{ id: "visite", texte: "Visite ?" }] });
    const c = await ouvrir();

    const saisie = champ(c);
    expect(saisie.readOnly).toBe(true);
    expect(saisie.getAttribute("aria-disabled")).toBe("true");
    const explication = document.getElementById(saisie.getAttribute("aria-describedby")!)!;
    expect(explication.textContent).toContain(texte);
    expect(explication.textContent).toContain("L'historique reste consultable");
    expect(boutonEnvoyer(c).disabled).toBe(true);
    expect(boutonEnvoyer(c).getAttribute("aria-describedby")).toBe(explication.id);

    expect(bulles(c)).toEqual(["Message 1", "Message 2", "Message 3"]);
    expect(c.textContent).not.toContain("Mise en relation validée");
    expect(c.querySelector('[aria-label="Messages types"]')).toBeNull();
  });

  it("409 à l'envoi : motif affiché, texte conservé, saisie grisée", async () => {
    filParMatch.mockResolvedValue(page(plage(1, 3), false));
    envoyer.mockRejectedValue(
      new ApiError("Cette discussion est fermée : la candidature a été retirée.", 409, {
        error: "Cette discussion est fermée : la candidature a été retirée.",
        motif: "candidature_retiree",
        details: [],
      }),
    );
    const c = await ouvrir();
    expect(champ(c).readOnly).toBe(false);

    saisir(champ(c), "Bonjour, toujours disponible ?");
    act(() => boutonEnvoyer(c).click());
    await attendreUnPeu();

    expect(envoyer).toHaveBeenCalledWith("c1", "Bonjour, toujours disponible ?");
    expect(champ(c).value).toBe("Bonjour, toujours disponible ?");
    expect(champ(c).readOnly).toBe(true);
    expect(champ(c).getAttribute("aria-disabled")).toBe("true");
    expect(boutonEnvoyer(c).disabled).toBe(true);
    expect(document.getElementById(champ(c).getAttribute("aria-describedby")!)!.textContent).toContain(
      "La candidature a été retirée",
    );
    // Un seul message, dans le bandeau ; pas d'alerte d'erreur en double.
    expect(c.querySelector('[role="alert"]')).toBeNull();
    // Le fil est relu pour prendre l'état du serveur.
    expect(filParMatch).toHaveBeenCalledTimes(2);
    expect(bulles(c)).toEqual(["Message 1", "Message 2", "Message 3"]);
  });

  it("autre échec d'envoi : texte rendu, erreur affichée, saisie toujours ouverte", async () => {
    filParMatch.mockResolvedValue(page(plage(1, 3), false));
    envoyer.mockRejectedValue(new ApiError("Erreur 500", 500));
    const c = await ouvrir();

    saisir(champ(c), "Bonjour");
    act(() => boutonEnvoyer(c).click());
    await attendreUnPeu();

    expect(champ(c).value).toBe("Bonjour");
    expect(champ(c).readOnly).toBe(false);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain("Erreur 500");
  });
});

describe("ConversationPage — messages plus anciens", () => {
  it("charge la page précédente avec le curseur, puis le sondage n'en perd ni n'en double aucun", async () => {
    let dernierePage = page(plage(21, 50), true);
    filParMatch.mockImplementation((_id: string, _signal: AbortSignal, p: PageFil = {}) =>
      Promise.resolve(p.avant ? page(plage(1, 20), false) : dernierePage),
    );
    const c = await ouvrir();

    expect(filParMatch).toHaveBeenLastCalledWith("M1", expect.any(AbortSignal), { limite: 30 });
    expect(bulles(c)).toHaveLength(30);

    const charger = bouton(c, "Charger les messages plus anciens")!;
    expect(charger.type).toBe("button"); // activable au clavier, hors formulaire
    act(() => charger.click());
    await attendreUnPeu();

    expect(filParMatch).toHaveBeenLastCalledWith("M1", expect.any(AbortSignal), {
      limite: 30,
      avant: "m021",
    });
    expect(bulles(c)).toEqual(plage(1, 50).map((m) => m.contenu));
    expect(bouton(c, "Charger les messages plus anciens")).toBeUndefined();

    // Un nouveau message arrive : le sondage ne renvoie que la dernière page.
    dernierePage = page(plage(22, 51), true);
    await sonder();

    expect(filParMatch).toHaveBeenLastCalledWith("M1", expect.any(AbortSignal), { limite: 30 });
    const textes = bulles(c);
    expect(textes).toEqual(plage(1, 51).map((m) => m.contenu));
    expect(new Set(textes).size).toBe(textes.length);
  });
});

describe("ConversationPage — position de lecture", () => {
  // happy-dom ne calcule pas de mise en page : la hauteur du fil est simulée.
  let hauteur = 1000;
  const descripteur = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
  beforeEach(() => {
    hauteur = 1000;
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get: () => hauteur,
    });
  });
  afterEach(() => {
    if (descripteur) Object.defineProperty(Element.prototype, "scrollHeight", descripteur);
    else delete (Element.prototype as { scrollHeight?: number }).scrollHeight;
  });

  const zone = (c: HTMLElement) => c.querySelector<HTMLDivElement>(".overflow-y-auto")!;

  it("page ancienne ajoutée en tête : le défilement compense la hauteur ajoutée", async () => {
    filParMatch.mockImplementation((_id: string, _signal: AbortSignal, p: PageFil = {}) =>
      Promise.resolve(p.avant ? page(plage(1, 20), false) : page(plage(21, 50), true)),
    );
    const c = await ouvrir();
    zone(c).scrollTop = 0;

    act(() => bouton(c, "Charger les messages plus anciens")!.click());
    hauteur = 1600; // la page ancienne ajoute 600 px en tête
    await attendreUnPeu();

    expect(bulles(c)).toHaveLength(50);
    expect(zone(c).scrollTop).toBe(600);
  });

  it("échec du chargement : aucune hauteur périmée n'est réappliquée ensuite", async () => {
    let dernierePage = page(plage(21, 50), true);
    filParMatch.mockImplementation((_id: string, _signal: AbortSignal, p: PageFil = {}) =>
      p.avant ? Promise.reject(new ApiError("Erreur 500", 500)) : Promise.resolve(dernierePage),
    );
    const c = await ouvrir();
    zone(c).scrollTop = 0;

    act(() => bouton(c, "Charger les messages plus anciens")!.click());
    await attendreUnPeu();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain("Erreur 500");

    // Trou (onglet caché) : le fil repart d'une nouvelle page, le premier
    // message change, et la hauteur a grandi entre-temps.
    hauteur = 3000;
    dernierePage = page(plage(81, 110), true);
    await sonder();

    expect(bulles(c)[0]).toBe("Message 81");
    expect(zone(c).scrollTop).toBe(0);
  });
});

describe("ConversationPage — serveur antérieur au lot 2.8", () => {
  it("fil complet sans pagination ni modèles : comportement actuel", async () => {
    let fil = conversation();
    filParMatch.mockImplementation(() => Promise.resolve(fil));
    modeles.mockRejectedValue(new ApiError("Erreur 404", 404));
    const c = await ouvrir();

    expect(bulles(c)).toEqual(["Message 1", "Message 2", "Message 3"]);
    expect(bouton(c, "Charger les messages plus anciens")).toBeUndefined();
    expect(c.querySelector('[aria-label="Messages types"]')).toBeNull();
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.textContent).toContain("Mise en relation validée");
    expect(champ(c).readOnly).toBe(false);
    expect(champ(c).hasAttribute("aria-disabled")).toBe(false);

    fil = conversation({ messages: plage(1, 4) });
    await sonder();
    expect(bulles(c)).toEqual(["Message 1", "Message 2", "Message 3", "Message 4"]);

    envoyer.mockResolvedValue({ message: "Message envoyé", data: msg(5) });
    saisir(champ(c), "Bonjour");
    act(() => boutonEnvoyer(c).click());
    await attendreUnPeu();
    expect(envoyer).toHaveBeenCalledWith("c1", "Bonjour");
    expect(champ(c).value).toBe("");
  });
});

describe("ConversationPage — messages types", () => {
  it("une puce insère son texte dans la saisie sans l'envoyer", async () => {
    filParMatch.mockResolvedValue(page(plage(1, 3), false));
    modeles.mockResolvedValue({
      cote: "locataire",
      modeles: [
        { id: "visite", texte: "Quand puis-je visiter le logement ?" },
        { id: "documents", texte: "Quels documents dois-je préparer ?" },
      ],
    });
    const c = await ouvrir();

    const groupe = c.querySelector('[role="group"][aria-label="Messages types"]')!;
    const puces = [...groupe.querySelectorAll("button")];
    expect(puces.map((b) => b.textContent)).toEqual([
      "Quand puis-je visiter le logement ?",
      "Quels documents dois-je préparer ?",
    ]);
    expect(puces.every((b) => b.type === "button")).toBe(true);

    act(() => puces[1].click());
    await attendreUnPeu();

    expect(champ(c).value).toBe("Quels documents dois-je préparer ?");
    expect(document.activeElement).toBe(champ(c));
    expect(envoyer).not.toHaveBeenCalled();
    // Saisie remplie : les puces s'effacent pour ne pas écraser le texte.
    expect(c.querySelector('[aria-label="Messages types"]')).toBeNull();
    expect(modeles).toHaveBeenCalledTimes(1);
  });
});
