/**
 * Segment.tsx — Sélecteur en segments (maquette Annonces : Louer / Acheter ;
 * maquette Profil : onglets), lot 3.15a.
 *
 * `sombre` : sur l'en-tête bleu nuit (fond blanc à 10 %, segment actif blanc).
 * Clair : sur fond clair (fond blanc, segment actif bleu nuit, ou orange).
 * Sémantique : groupe de boutons radio (un choix parmi plusieurs) ; les
 * flèches gauche et droite changent de choix, comme un groupe radio natif.
 */
import type { KeyboardEvent } from "react";

interface Option<V extends string> {
  valeur: V;
  label: string;
}

interface Props<V extends string> {
  options: readonly Option<V>[];
  valeur: V;
  onChange: (valeur: V) => void;
  /** Nom du groupe, lu par les lecteurs d'écran. */
  libelle: string;
  sombre?: boolean;
  /** Segment actif orange, texte blanc (maquette Profil). */
  orange?: boolean;
}

export function Segment<V extends string>({
  options,
  valeur,
  onChange,
  libelle,
  sombre = false,
  orange = false,
}: Props<V>) {
  const fondActif = orange ? "#F97316" : sombre ? "#ffffff" : "#1E3A5F";
  const texteActif = orange || !sombre ? "#ffffff" : "#1E3A5F";
  function surTouche(e: KeyboardEvent<HTMLDivElement>) {
    const sens = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!sens) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.valeur === valeur);
    const suivante = options[(i + sens + options.length) % options.length];
    onChange(suivante.valeur);
    const boutons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    boutons[options.indexOf(suivante)]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={libelle}
      onKeyDown={surTouche}
      className="grid p-1 rounded-[14px]"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        background: sombre ? "rgba(255,255,255,0.1)" : "#ffffff",
      }}
    >
      {options.map((o) => {
        const actif = o.valeur === valeur;
        return (
          <button
            key={o.valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            tabIndex={actif ? 0 : -1}
            onClick={() => onChange(o.valeur)}
            className="h-11 rounded-[11px] truncate px-2"
            style={{
              fontSize: 14,
              fontWeight: actif ? 800 : 700,
              background: actif ? fondActif : "transparent",
              color: actif ? texteActif : sombre ? "rgba(255,255,255,0.85)" : "#475569",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
