/**
 * useFilConversation.ts — Fil d'une conversation, chargé par pages (lot 2.8).
 *
 * Le sondage (toutes les 15 s) ne redemande que la DERNIÈRE page ; le bouton
 * « Charger les messages plus anciens » remonte le fil avec le curseur
 * `avant`. Les deux sources sont fusionnées par identifiant de message :
 *   • un sondage ne fait jamais perdre une page ancienne déjà chargée, ni ne
 *     duplique un message qu'elle contient ;
 *   • la dernière version d'un message (statut « lu ») remplace la précédente.
 *
 * Serveur antérieur au lot 2.8 : il ignore `limite` et renvoie le fil complet
 * sans bloc `pagination`. Chaque réponse remplace alors le fil, comme avant.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, estAnnulation, messagesAPI, type Conversation, type Message } from "../api";
import { useApi } from "./useApi";

/** Messages par page : assez pour remplir un écran, léger en 3G. */
export const LIMITE_FIL = 30;
const INTERVALLE_RAFRAICHISSEMENT = 15_000;

export interface EtatFil {
  /** Dernière réponse du sondage intégrée au fil. */
  source: Conversation | null;
  /** Messages chargés, du plus ancien au plus récent, sans doublon. */
  messages: Message[];
  /** Curseur de la page plus ancienne à charger (`null` : rien à charger). */
  curseur: string | null;
}

export const FIL_VIDE: EtatFil = { source: null, messages: [], curseur: null };

/** Même ordre que le serveur : date, puis identifiant (ordre total). */
function comparer(a: Message, b: Message) {
  const da = a.created_at ?? "";
  const db = b.created_at ?? "";
  if (da !== db) return da < db ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Union par identifiant ; `recents` l'emporte sur `existants`. */
export function fusionnerMessages(existants: Message[], recents: Message[]): Message[] {
  const parId = new Map<string, Message>();
  for (const m of existants) parId.set(m.id, m);
  for (const m of recents) parId.set(m.id, m);
  return [...parId.values()].sort(comparer);
}

/** Intègre une réponse du sondage (dernière page, ou fil complet). */
export function integrerDernierePage(etat: EtatFil, reponse: Conversation): EtatFil {
  const page = reponse.messages ?? [];
  const pagination = reponse.pagination;

  // Serveur sans pagination : le fil complet fait foi.
  if (!pagination) return { source: reponse, messages: page, curseur: null };

  const premier = page[0];
  const connus = new Set(etat.messages.map((m) => m.id));
  // Trou possible entre ce qui est chargé et la nouvelle dernière page (plus
  // de `LIMITE_FIL` messages arrivés pendant que l'onglet était caché) : on
  // repart de cette page, plutôt que d'afficher un fil troué.
  const trou = pagination.plus_anciens && premier !== undefined && !connus.has(premier.id);
  if (etat.messages.length === 0 || trou) {
    return { source: reponse, messages: page, curseur: pagination.curseur };
  }
  // Le curseur reste celui du plus ancien message chargé.
  return { ...etat, source: reponse, messages: fusionnerMessages(etat.messages, page) };
}

/** Intègre une page plus ancienne, chargée avec le curseur `etat.curseur`. */
export function integrerPageAncienne(etat: EtatFil, reponse: Conversation): EtatFil {
  return {
    ...etat,
    messages: fusionnerMessages(reponse.messages ?? [], etat.messages),
    curseur: reponse.pagination?.plus_anciens ? reponse.pagination.curseur : null,
  };
}

export function useFilConversation(matchId: string | undefined) {
  const conversation = useApi(
    (signal) => messagesAPI.filParMatch(matchId!, signal, { limite: LIMITE_FIL }),
    [matchId],
    { actif: Boolean(matchId), intervalle: INTERVALLE_RAFRAICHISSEMENT },
  );

  // Chaque nouvelle réponse est fusionnée au fil pendant le rendu (et non dans
  // un effet), comme `useApi` le fait pour ses dépendances.
  const [fil, setFil] = useState<EtatFil>(FIL_VIDE);
  const [anciensEnCours, setAnciensEnCours] = useState(false);
  const [erreurAnciens, setErreurAnciens] = useState<string | null>(null);
  if (conversation.data !== fil.source) {
    setFil(conversation.data ? integrerDernierePage(fil, conversation.data) : FIL_VIDE);
    if (!conversation.data) setErreurAnciens(null); // autre discussion
  }

  const controleurRef = useRef<AbortController | null>(null);
  useEffect(() => () => controleurRef.current?.abort(), []);

  const curseur = fil.curseur;
  const chargerAnciens = useCallback(async () => {
    if (!matchId || !curseur || controleurRef.current) return;
    const controleur = new AbortController();
    controleurRef.current = controleur;
    setAnciensEnCours(true);
    setErreurAnciens(null);
    try {
      const reponse = await messagesAPI.filParMatch(matchId, controleur.signal, {
        limite: LIMITE_FIL,
        avant: curseur,
      });
      // Le fil a pu repartir de zéro entre-temps (autre discussion, trou) :
      // cette page ne le prolonge plus.
      setFil((etat) => (etat.curseur === curseur ? integrerPageAncienne(etat, reponse) : etat));
    } catch (err) {
      if (controleur.signal.aborted || estAnnulation(err)) return;
      setErreurAnciens(
        err instanceof ApiError ? err.message : "Impossible de charger les messages plus anciens",
      );
    } finally {
      if (controleurRef.current === controleur) controleurRef.current = null;
      if (!controleur.signal.aborted) setAnciensEnCours(false);
    }
  }, [matchId, curseur]);

  return {
    conversation,
    messages: fil.messages,
    plusAnciens: fil.curseur !== null,
    chargerAnciens,
    anciensEnCours,
    erreurAnciens,
  };
}
