/**
 * rechargement.ts — Fichier JS d'un espace introuvable après un déploiement.
 *
 * Les espaces sont chargés à la demande (pages/espaces.tsx). Si le site a été
 * redéployé depuis l'ouverture de la page, l'ancien fichier n'existe plus :
 * Vite émet alors `vite:preloadError`. On recharge la page UNE fois pour
 * prendre la nouvelle version ; si cela échoue encore, l'erreur remonte à
 * l'écran d'erreur des routes (routes.tsx), sans boucle de rechargements.
 */
const CLE = "tcheyna_rechargement_apres_deploiement";

export function siModuleIntrouvable(
  evenement: Event,
  stockage: Pick<Storage, "getItem" | "setItem">,
  recharger: () => void,
): void {
  try {
    if (stockage.getItem(CLE)) return;
    stockage.setItem(CLE, String(Date.now()));
  } catch {
    // Stockage indisponible : pas de rechargement automatique, pas de boucle.
    return;
  }
  evenement.preventDefault();
  recharger();
}

/** À appeler une fois au démarrage, sur le site comme dans l'appli. */
export function surveillerModulesIntrouvables(): void {
  window.addEventListener("vite:preloadError", (evenement) =>
    siModuleIntrouvable(evenement, sessionStorage, () => window.location.reload()),
  );
  // Un chargement réussi depuis plus de 10 s autorise un nouveau rechargement
  // au prochain déploiement.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(CLE);
    } catch {
      // Rien à effacer.
    }
  }, 10_000);
}
