/**
 * FeuilleBas.tsx — Feuille qui monte du bas de l'écran (filtres, actions),
 * lot 3.15a.
 *
 * Fenêtre modale : le fond l'écrase, Échap et le fond la ferment, le focus
 * entre dans la feuille à l'ouverture et revient au déclencheur à la
 * fermeture. Au-dessus de la barre de gestes (--inset-bas).
 */
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  /** Boutons du bas (Réinitialiser, Voir les résultats). */
  pied?: ReactNode;
}

export function FeuilleBas({ titre, onFermer, children, pied }: Props) {
  const idTitre = useId();
  const feuille = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const declencheur = document.activeElement as HTMLElement | null;
    feuille.current?.focus();
    const surTouche = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("keydown", surTouche);
      declencheur?.focus?.();
    };
    // Une seule fois, à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onFermer} aria-hidden="true" />
      <div
        ref={feuille}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        className="relative w-full flex flex-col rounded-t-3xl bg-white outline-none"
        style={{ maxHeight: "85dvh" }}
      >
        <div className="flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full" style={{ background: "#CBD5E1" }} />
        </div>
        <div className="flex items-center justify-between px-6 pt-2 pb-3">
          <h2 id={idTitre} className="m-0 font-extrabold" style={{ fontSize: 18, color: "#1E3A5F" }}>
            {titre}
          </h2>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="w-11 h-11 -mr-2.5 flex items-center justify-center rounded-full"
            style={{ color: "#475569" }}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-5">{children}</div>
        {pied && (
          <div
            className="px-6 pt-3 border-t"
            style={{ borderColor: "#E2E8F0", paddingBottom: "calc(16px + var(--inset-bas))" }}
          >
            {pied}
          </div>
        )}
      </div>
    </div>
  );
}
