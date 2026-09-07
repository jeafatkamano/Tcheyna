/**
 * useApi.ts — Chargement de données avec états de chargement et d'erreur.
 *
 * Évite de réécrire le triplet `data / chargement / erreur` dans chaque page.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../api";

interface EtatRequete<T> {
  data: T | null;
  chargement: boolean;
  erreur: string | null;
  recharger: () => Promise<void>;
  /** Mise à jour optimiste locale, sans requête. */
  muter: (maj: (precedent: T) => T) => void;
}

export function useApi<T>(
  requete: () => Promise<T>,
  deps: unknown[] = [],
  options: { actif?: boolean } = {},
): EtatRequete<T> {
  const { actif = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [chargement, setChargement] = useState(actif);
  const [erreur, setErreur] = useState<string | null>(null);

  // Garde la dernière requête pour ignorer les réponses obsolètes.
  const requeteRef = useRef(requete);
  requeteRef.current = requete;
  const compteur = useRef(0);

  const executer = useCallback(async () => {
    const appel = ++compteur.current;
    setChargement(true);
    setErreur(null);
    try {
      const resultat = await requeteRef.current();
      if (appel === compteur.current) setData(resultat);
    } catch (err) {
      if (appel !== compteur.current) return;
      setErreur(err instanceof ApiError ? err.message : "Impossible de charger les données");
    } finally {
      if (appel === compteur.current) setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (!actif) {
      setChargement(false);
      return;
    }
    void executer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, ...deps]);

  const muter = useCallback((maj: (precedent: T) => T) => {
    setData((precedent) => (precedent === null ? precedent : maj(precedent)));
  }, []);

  return { data, chargement, erreur, recharger: executer, muter };
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
