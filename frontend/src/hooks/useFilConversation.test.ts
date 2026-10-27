/**
 * Fusion du fil paginé (lot 2.8) : le sondage de la dernière page ne perd
 * aucune page ancienne et ne duplique aucun message.
 */
import { describe, expect, it } from "vitest";

import type { Conversation, Message } from "../api";
import {
  FIL_VIDE,
  fusionnerMessages,
  integrerDernierePage,
  integrerPageAncienne,
} from "./useFilConversation";

function msg(n: number, extra: Partial<Message> = {}): Message {
  return {
    id: `m${String(n).padStart(3, "0")}`,
    sender_id: "autre",
    contenu: `Message ${n}`,
    lu: false,
    created_at: new Date(Date.UTC(2026, 9, 20, 8) + n * 60_000).toISOString().slice(0, 19),
    ...extra,
  };
}

function plage(de: number, a: number) {
  return Array.from({ length: a - de + 1 }, (_, i) => msg(de + i));
}

function page(messages: Message[], plusAnciens: boolean): Conversation {
  return {
    id: "c1",
    match_id: "M1",
    nb_non_lus: 0,
    messages,
    pagination: {
      limite: 30,
      plus_anciens: plusAnciens,
      curseur: plusAnciens ? messages[0].id : null,
    },
  } as Conversation;
}

const ids = (messages: Message[]) => messages.map((m) => m.id);

describe("fusionnerMessages", () => {
  it("unit par identifiant, trie par date puis identifiant, garde la version récente", () => {
    const meme = "2026-10-20T08:00:00";
    const fusion = fusionnerMessages(
      [msg(2), msg(1, { created_at: meme, id: "b" })],
      [msg(2, { lu: true }), msg(1, { created_at: meme, id: "a" })],
    );
    expect(ids(fusion)).toEqual(["a", "b", "m002"]);
    expect(fusion[2].lu).toBe(true);
  });
});

describe("integrerDernierePage", () => {
  it("première page : messages et curseur de la page", () => {
    const etat = integrerDernierePage(FIL_VIDE, page(plage(21, 50), true));
    expect(ids(etat.messages)).toEqual(ids(plage(21, 50)));
    expect(etat.curseur).toBe("m021");
  });

  it("un sondage ne fait perdre ni les anciennes pages ni le curseur, sans doublon", () => {
    let etat = integrerDernierePage(FIL_VIDE, page(plage(21, 50), true));
    etat = integrerPageAncienne(etat, page(plage(1, 20), false));
    expect(etat.curseur).toBeNull();

    // Deux nouveaux messages : la dernière page glisse de deux crans.
    etat = integrerDernierePage(etat, page(plage(23, 52), true));
    expect(ids(etat.messages)).toEqual(ids(plage(1, 52)));
    expect(etat.curseur).toBeNull();
  });

  it("garde le curseur du plus ancien message chargé, pas celui du sondage", () => {
    let etat = integrerDernierePage(FIL_VIDE, page(plage(21, 50), true));
    etat = integrerDernierePage(etat, page(plage(22, 51), true));
    expect(etat.curseur).toBe("m021");
    expect(ids(etat.messages)).toEqual(ids(plage(21, 51)));
  });

  it("trou entre le chargé et la nouvelle page : repart de la nouvelle page", () => {
    let etat = integrerDernierePage(FIL_VIDE, page(plage(21, 50), true));
    etat = integrerDernierePage(etat, page(plage(61, 90), true));
    expect(ids(etat.messages)).toEqual(ids(plage(61, 90)));
    expect(etat.curseur).toBe("m061");
  });

  it("serveur sans pagination : le fil complet remplace le fil", () => {
    let etat = integrerDernierePage(FIL_VIDE, { id: "c1", match_id: "M1", nb_non_lus: 0, messages: plage(1, 3) } as Conversation);
    etat = integrerDernierePage(etat, { id: "c1", match_id: "M1", nb_non_lus: 0, messages: plage(1, 4) } as Conversation);
    expect(ids(etat.messages)).toEqual(ids(plage(1, 4)));
    expect(etat.curseur).toBeNull();
  });
});

describe("integrerPageAncienne", () => {
  it("ajoute en tête et avance le curseur tant qu'il reste des messages", () => {
    let etat = integrerDernierePage(FIL_VIDE, page(plage(41, 70), true));
    etat = integrerPageAncienne(etat, page(plage(11, 40), true));
    expect(ids(etat.messages)).toEqual(ids(plage(11, 70)));
    expect(etat.curseur).toBe("m011");
  });
});
