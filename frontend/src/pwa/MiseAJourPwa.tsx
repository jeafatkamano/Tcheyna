/// <reference types="vite-plugin-pwa/react" />
/**
 * MiseAJourPwa.tsx — Enregistre le service worker du site et propose les
 * nouvelles versions. Monté seulement sur le site web : jamais dans
 * l'application Android, où l'interface est déjà embarquée (App.tsx).
 */
import { useRegisterSW } from "virtual:pwa-register/react";

import { BandeauMiseAJour } from "./BandeauMiseAJour";

/** L'application ne recharge jamais la page : on revérifie sw.js toutes les heures. */
const VERIFICATION_MS = 60 * 60 * 1000;

export function MiseAJourPwa() {
  const {
    needRefresh: [nouvelleVersion, setNouvelleVersion],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, enregistrement) {
      if (enregistrement) setInterval(() => void enregistrement.update(), VERIFICATION_MS);
    },
  });

  if (!nouvelleVersion) return null;
  return (
    <BandeauMiseAJour
      onRecharger={() => void updateServiceWorker(true)}
      onFermer={() => setNouvelleVersion(false)}
    />
  );
}
