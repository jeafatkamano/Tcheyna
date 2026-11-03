/**
 * Marque.tsx — Monogramme « t. » et écran neutre aux couleurs de l'application.
 *
 * Valeurs de la maquette (docs/design/maquette-app-mobile/Main.dc.html) :
 * « t » en 800, point orange de 8 px pour un corps de 28 px.
 */
import { useSyncExternalStore } from "react";

import { MESSAGE_REVEIL, reveilServeur } from "../api";

/** Dégradé des écrans sombres de l'application. */
export const DEGRADE_NUIT = "linear-gradient(170deg, #0F2040 0%, #1E3A5F 100%)";

export function Monogramme({ taille = 28 }: { taille?: number }) {
  const point = Math.round((taille * 8) / 28);
  return (
    <span
      role="img"
      aria-label="Tcheyna"
      className="inline-flex items-baseline font-extrabold leading-none"
      style={{ fontSize: taille, letterSpacing: -0.5 }}
    >
      <span aria-hidden="true">t</span>
      <span
        aria-hidden="true"
        className="inline-block rounded-full"
        style={{ width: point, height: point, marginLeft: Math.max(2, point / 4), background: "#F97316" }}
      />
    </span>
  );
}

/**
 * Écran plein, fond bleu nuit et « t. » centré : attente sans éclair d'une
 * autre page. Si le serveur se réveille (jusqu'à une minute et demie sur le
 * plan gratuit), une ligne le dit : sans elle, l'application paraît bloquée.
 */
export function EcranMarque() {
  const reveil = useSyncExternalStore(reveilServeur.subscribe, reveilServeur.enCours);
  return (
    <div
      className="sous-barre-etat min-h-dvh flex flex-col items-center justify-center gap-6 px-8 text-white"
      style={{ background: DEGRADE_NUIT }}
      role="status"
      aria-label={reveil ? MESSAGE_REVEIL : "Chargement"}
    >
      <Monogramme taille={56} />
      {reveil && (
        <p className="text-sm text-center" style={{ color: "rgba(255,255,255,0.7)" }} aria-live="polite">
          {MESSAGE_REVEIL}
        </p>
      )}
    </div>
  );
}
