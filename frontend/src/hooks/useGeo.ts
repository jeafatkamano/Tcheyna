/**
 * useGeo.ts — Référentiel pays / villes / quartiers.
 *
 * Chargé une seule fois par session : le référentiel est petit et statique,
 * et l'onboarding enchaîne trois sélecteurs dépendants.
 */
import { useEffect, useMemo, useState } from "react";

import { geoAPI, type Referentiel } from "../api";

let cache: Referentiel | null = null;
let chargementEnCours: Promise<Referentiel> | null = null;

function charger(): Promise<Referentiel> {
  if (cache) return Promise.resolve(cache);
  chargementEnCours ??= geoAPI
    .referentiel()
    .then((data) => {
      cache = data;
      return data;
    })
    .finally(() => {
      chargementEnCours = null;
    });
  return chargementEnCours;
}

export function useGeo(pays?: string, ville?: string) {
  const [referentiel, setReferentiel] = useState<Referentiel | null>(cache);
  const [chargement, setChargement] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let vivant = true;
    charger()
      .then((data) => vivant && setReferentiel(data))
      .catch(() => vivant && setReferentiel(null))
      .finally(() => vivant && setChargement(false));
    return () => {
      vivant = false;
    };
  }, []);

  const listePays = useMemo(
    () =>
      referentiel
        ? Object.keys(referentiel.locations).map((nom) => ({
            nom,
            ouvert: referentiel.marches_ouverts.includes(nom),
            devise: referentiel.devises[nom],
          }))
        : [],
    [referentiel],
  );

  const villes = useMemo(
    () => (referentiel && pays ? Object.keys(referentiel.locations[pays] ?? {}) : []),
    [referentiel, pays],
  );

  const quartiers = useMemo(
    () => (referentiel && pays && ville ? (referentiel.locations[pays]?.[ville] ?? []) : []),
    [referentiel, pays, ville],
  );

  return {
    chargement,
    pays: listePays,
    villes,
    quartiers,
    typesBien: referentiel?.types_bien ?? [],
    devisePour: (nomPays?: string) =>
      nomPays ? (referentiel?.devises[nomPays]?.code ?? "GNF") : "GNF",
  };
}
