/**
 * Marque.tsx — Monogramme « t. » et écran neutre aux couleurs de l'application.
 *
 * Valeurs de la maquette (docs/design/maquette-app-mobile/Main.dc.html) :
 * « t » en 800, point orange de 8 px pour un corps de 28 px.
 */

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

/** Écran plein, fond bleu nuit et « t. » centré : attente sans éclair d'une autre page. */
export function EcranMarque() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center text-white"
      style={{ background: DEGRADE_NUIT }}
      role="status"
      aria-label="Chargement"
    >
      <Monogramme taille={56} />
    </div>
  );
}
