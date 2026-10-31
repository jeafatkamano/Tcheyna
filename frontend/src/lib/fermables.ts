/**
 * fermables.ts — Éléments ouverts par-dessus la page (feuille du bas, menu
 * latéral) que le bouton retour d'Android ferme d'abord (lot 3.16).
 *
 * Chaque élément s'inscrit à l'ouverture et se retire à la fermeture ; le
 * bouton retour ferme le dernier ouvert au lieu de changer de page.
 */
const pile: Array<() => void> = [];

/** Inscrit `fermer` ; la fonction rendue le retire. */
export function enregistrerFermable(fermer: () => void): () => void {
  pile.push(fermer);
  return () => {
    const i = pile.lastIndexOf(fermer);
    if (i >= 0) pile.splice(i, 1);
  };
}

/** Ferme le dernier élément ouvert ; faux s'il n'y en a aucun. */
export function fermerDernier(): boolean {
  const fermer = pile.pop();
  if (!fermer) return false;
  fermer();
  return true;
}
