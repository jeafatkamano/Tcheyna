/**
 * BandeauMiseAJour.tsx — Annonce discrète d'une nouvelle version du site.
 *
 * Ne bloque rien : l'utilisateur termine ce qu'il fait et recharge quand il
 * veut. Composant d'affichage seul, piloté par MiseAJourPwa.
 */
interface Props {
  onRecharger: () => void;
  onFermer: () => void;
}

export function BandeauMiseAJour({ onRecharger, onFermer }: Props) {
  return (
    <div
      role="status"
      // Au-dessus de la barre de navigation basse (Layout), elle-même
      // rehaussée de la barre de gestes du téléphone.
      className="fixed inset-x-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm text-white shadow-lg"
      style={{ background: "#1E3A5F", bottom: "calc(5rem + var(--inset-bas))" }}
    >
      <span className="flex-1">Nouvelle version disponible.</span>
      <button
        type="button"
        onClick={onRecharger}
        className="rounded-lg bg-white px-3 py-1.5 font-semibold"
        style={{ color: "#1E3A5F" }}
      >
        Recharger
      </button>
      <button type="button" onClick={onFermer} className="rounded-lg px-2 py-1.5 text-white/80">
        Plus tard
      </button>
    </div>
  );
}
