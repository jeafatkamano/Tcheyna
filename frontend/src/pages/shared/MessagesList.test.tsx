/**
 * Liste des discussions (lot 2.8) : pages « Afficher plus » quand le serveur
 * pagine, comportement actuel sinon, mention « Fermée ».
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Conversation, User } from "../../api";

const conversations = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return {
    ...reel,
    messagesAPI: { ...reel.messagesAPI, conversations },
    // Statuts des candidatures (lot 3.15b) : pas d'appel réseau réel.
    matchesAPI: { ...reel.matchesAPI, mesCandidatures: () => Promise.resolve({ matches: [], stats: {} }) },
  };
});
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "moi", role: "tenant" } }),
}));

const { MessagesList } = await import("./MessagesList");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function conv(n: number, extra: Partial<Conversation> = {}): Conversation {
  return {
    id: `c${n}`,
    match_id: `M${n}`,
    nb_non_lus: 0,
    interlocuteur: { id: `u${n}`, full_name: `Interlocuteur ${n}` } as User,
    dernier_message: null,
    ...extra,
  } as Conversation;
}

function attendreUnPeu() {
  return act(() => new Promise((r) => setTimeout(r, 5)));
}

let racine: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  conversations.mockReset();
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function ouvrir() {
  const router = createMemoryRouter([{ path: "/messages", Component: MessagesList }], {
    initialEntries: ["/messages"],
  });
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  await attendreUnPeu();
  return conteneur;
}

// Liens des discussions seulement (l'en-tête porte aussi la cloche, lot 3.15b).
const discussions = (c: HTMLElement) => [...c.querySelectorAll<HTMLAnchorElement>('a[href^="/messages/"]')];
const liens = (c: HTMLElement) => discussions(c).map((a) => a.getAttribute("href"));
const afficherPlus = (c: HTMLElement) =>
  [...c.querySelectorAll("button")].find((b) => b.textContent === "Afficher plus");

describe("MessagesList", () => {
  it("serveur paginé : « Afficher plus » ajoute la page suivante, sans doublon", async () => {
    conversations.mockImplementation((p?: { page: number }) => {
      return Promise.resolve(
        p?.page === 2
          ? // c2 est remontée entre-temps : elle revient en page 2.
            { conversations: [conv(2), conv(3)], total: 3, non_lus: 0, page: 2, per_page: 20, pages: 2 }
          : { conversations: [conv(1), conv(2)], total: 3, non_lus: 0, page: 1, per_page: 20, pages: 2 },
      );
    });
    const c = await ouvrir();

    expect(conversations).toHaveBeenCalledWith({ page: 1, per_page: 20 }, expect.any(AbortSignal));
    expect(liens(c)).toEqual(["/messages/M1", "/messages/M2"]);

    const bouton = afficherPlus(c)!;
    expect(bouton.type).toBe("button");
    act(() => bouton.click());
    await attendreUnPeu();

    expect(conversations).toHaveBeenLastCalledWith({ page: 2, per_page: 20 });
    expect(liens(c)).toEqual(["/messages/M1", "/messages/M2", "/messages/M3"]);
    expect(afficherPlus(c)).toBeUndefined();
  });

  it("serveur antérieur au lot 2.8 (sans `pages`) : toute la liste, sans bouton", async () => {
    conversations.mockResolvedValue({ conversations: [conv(1), conv(2)], total: 2, non_lus: 0 });
    const c = await ouvrir();

    expect(liens(c)).toEqual(["/messages/M1", "/messages/M2"]);
    expect(afficherPlus(c)).toBeUndefined();
    expect(c.textContent).not.toContain("Fermée");
  });

  it("mention « Fermée » sur une discussion fermée à l'écriture, seulement", async () => {
    conversations.mockResolvedValue({
      conversations: [
        conv(1, { ecriture_fermee: true, motif_fermeture: "candidature_refusee" }),
        conv(2, { ecriture_fermee: false, motif_fermeture: null }),
      ],
      total: 2,
      non_lus: 0,
      page: 1,
      per_page: 20,
      pages: 1,
    });
    const c = await ouvrir();

    const [premier, second] = discussions(c);
    expect(premier.textContent).toContain("Fermée");
    expect(second.textContent).not.toContain("Fermée");
    expect(afficherPlus(c)).toBeUndefined();
  });
});
