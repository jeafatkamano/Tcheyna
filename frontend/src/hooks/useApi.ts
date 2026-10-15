/**
 * useApi.ts — Chargement de données avec états de chargement et d'erreur.
 *
 * Évite de réécrire le triplet `data / chargement / erreur` dans chaque page.
 *
 * Pensé pour un réseau lent ou instable :
 *   • `chargement` ne vaut vrai qu'au premier chargement (aucune donnée) : un
 *     rechargement garde les données affichées et passe par `actualisation`,
 *     sans démonter l'écran (clavier, défilement et saisie sont préservés) ;
 *   • une erreur de rechargement va dans `erreurActualisation` (bandeau
 *     discret) au lieu de remplacer les données par un écran d'erreur ;
 *   • `intervalle` active un sondage, suspendu quand l'onglet est caché et
 *     relancé à son retour ; chaque sondage attend la fin du précédent ;
 *   • la requête reçoit un `AbortSignal`, annulé au démontage ou quand les
 *     dépendances changent : une réponse obsolète n'est jamais affichée.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, estAnnulation } from "../api";

interface EtatRequete<T> {
  data: T | null;
  /** Premier chargement en cours : aucune donnée à montrer. */
  chargement: boolean;
  /** Rechargement en arrière-plan, données conservées. */
  actualisation: boolean;
  /** Échec sans donnée à montrer. */
  erreur: string | null;
  /** Échec d'un rechargement : les données affichées datent du précédent. */
  erreurActualisation: string | null;
  recharger: () => Promise<void>;
  /** Mise à jour optimiste locale, sans requête. */
  muter: (maj: (precedent: T) => T) => void;
}

interface OptionsApi {
  actif?: boolean;
  /** Sondage périodique (ms), suspendu quand l'onglet est caché. */
  intervalle?: number;
}

interface Etat<T> {
  data: T | null;
  erreur: string | null;
  erreurActualisation: string | null;
  enCours: boolean;
}

const ETAT_INITIAL: Etat<never> = {
  data: null,
  erreur: null,
  erreurActualisation: null,
  enCours: false,
};

function memesDependances(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

function message(err: unknown) {
  return err instanceof ApiError ? err.message : "Impossible de charger les données";
}

export function useApi<T>(
  requete: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  options: OptionsApi = {},
): EtatRequete<T> {
  const { actif = true, intervalle } = options;
  const [etat, setEtat] = useState<Etat<T>>(ETAT_INITIAL);

  // Nouvelles dépendances (autre annonce, autre filtre) : les anciennes
  // données ne correspondent plus, on repart d'un état vierge. Ajustement
  // pendant le rendu, comme le recommande React, plutôt que dans un effet.
  const [depsVues, setDepsVues] = useState(deps);
  if (!memesDependances(depsVues, deps)) {
    setDepsVues(deps);
    setEtat(ETAT_INITIAL);
  }

  // Dernière requête, lue au moment d'exécuter (jamais pendant le rendu).
  const requeteRef = useRef(requete);
  useEffect(() => {
    requeteRef.current = requete;
  });
  const controleurRef = useRef<AbortController | null>(null);

  /** Lance la requête ; toute requête précédente encore en vol est annulée. */
  const charger = useCallback(async () => {
    controleurRef.current?.abort();
    const controleur = new AbortController();
    controleurRef.current = controleur;
    try {
      const data = await requeteRef.current(controleur.signal);
      if (controleur.signal.aborted) return;
      setEtat({ data, erreur: null, erreurActualisation: null, enCours: false });
    } catch (err) {
      if (controleur.signal.aborted || estAnnulation(err)) return;
      setEtat((e) =>
        e.data === null
          ? { ...e, erreur: message(err), enCours: false }
          : { ...e, erreurActualisation: message(err), enCours: false },
      );
    }
  }, []);

  /** Rechargement à la demande : garde les données, sinon réaffiche le chargement. */
  const recharger = useCallback(async () => {
    setEtat((e) => ({ ...e, enCours: true, erreur: null }));
    await charger();
  }, [charger]);

  // Premier chargement, puis à chaque changement de dépendances.
  useEffect(() => {
    if (!actif) return;
    void charger();
    return () => controleurRef.current?.abort();
  }, [actif, depsVues, charger]);

  // Sondage : minuterie en chaîne (pas setInterval), pour ne jamais empiler
  // les requêtes quand l'une dure plus que l'intervalle en 3G.
  useEffect(() => {
    if (!actif || !intervalle) return;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let arrete = false;

    const planifier = () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(sonder, intervalle);
    };
    async function sonder() {
      minuterie = undefined;
      if (document.visibilityState === "hidden") return; // repris au retour
      setEtat((e) => ({ ...e, enCours: true }));
      await charger();
      if (!arrete) planifier();
    }
    const surVisibilite = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(minuterie);
        minuterie = undefined;
      } else {
        // Retour sur l'onglet : données probablement périmées.
        void sonder();
      }
    };

    planifier();
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      arrete = true;
      clearTimeout(minuterie);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [actif, intervalle, depsVues, charger]);

  const muter = useCallback((maj: (precedent: T) => T) => {
    setEtat((e) => (e.data === null ? e : { ...e, data: maj(e.data) }));
  }, []);

  return {
    data: etat.data,
    chargement: actif && etat.data === null && etat.erreur === null,
    actualisation: etat.enCours && etat.data !== null,
    erreur: etat.erreur,
    erreurActualisation: etat.erreurActualisation,
    recharger,
    muter,
  };
}

/**
 * useAction — Pour les actions déclenchées par l'utilisateur (envoi de
 * formulaire, candidature…). Empêche les doubles soumissions.
 */
export function useAction<Args extends unknown[], R>(action: (...args: Args) => Promise<R>) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const executer = useCallback(
    async (...args: Args): Promise<R | null> => {
      if (enCours) return null;
      setEnCours(true);
      setErreur(null);
      try {
        return await action(...args);
      } catch (err) {
        setErreur(err instanceof ApiError ? err.message : "Une erreur est survenue");
        return null;
      } finally {
        setEnCours(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enCours],
  );

  return { executer, enCours, erreur, reinitialiserErreur: () => setErreur(null) };
}
