/**
 * Pastille.tsx — Pastilles de la maquette (lot 3.15a) : équipements et
 * filtres (bouton à bascule ou simple étiquette), compatibilité d'une annonce.
 */
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  actif?: boolean;
  /** Avec un gestionnaire, la pastille est un bouton à bascule (aria-pressed). */
  onClick?: () => void;
  /** Sur fond clair de la fiche : coins arrondis, fond blanc, sans bordure. */
  forme?: "pilule" | "etiquette";
}

export function Pastille({ children, actif = false, onClick, forme = "pilule" }: Props) {
  const style =
    forme === "etiquette"
      ? { padding: "8px 12px", borderRadius: 12, background: "#ffffff", color: "#1E3A5F", fontWeight: 600 }
      : actif
        ? { padding: "8px 12px", borderRadius: 999, background: "#1E3A5F", color: "#ffffff", fontWeight: 700 }
        : {
            padding: "8px 12px",
            borderRadius: 999,
            background: "#ffffff",
            color: "#1E3A5F",
            fontWeight: 600,
            border: "1px solid #CBD5E1",
          };
  const classe = "shrink-0 whitespace-nowrap inline-flex items-center gap-1.5";

  if (!onClick) {
    return (
      <span className={classe} style={{ ...style, fontSize: 13 }}>
        {children}
      </span>
    );
  }
  // Cible de 44 px : la zone de toucher déborde de 5 px en haut et en bas.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`${classe} relative after:absolute after:inset-x-0 after:-inset-y-[5px] after:content-['']`}
      style={{ ...style, fontSize: 13 }}
    >
      {children}
    </button>
  );
}

/** « 87 % compatible » : pastille blanche, texte vert. */
export function PastilleCompatibilite({
  score,
  court = false,
  surClair = false,
}: {
  score?: number | null;
  court?: boolean;
  /** Sur fond clair (fiche annonce) : fond vert pâle au lieu du blanc. */
  surClair?: boolean;
}) {
  if (score === undefined || score === null) return null;
  return (
    <span
      className="inline-flex items-center rounded-full font-extrabold whitespace-nowrap"
      style={{
        padding: court ? "4px 8px" : "5px 10px",
        background: surClair ? "#DCFCE7" : "#ffffff",
        color: "#047857",
        fontSize: court ? 11 : 12,
      }}
    >
      {court ? `${score} %` : `${score} % compatible`}
    </span>
  );
}
