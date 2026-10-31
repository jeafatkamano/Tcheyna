/**
 * presentation.ts — Mémorise que la présentation du premier lancement a été vue.
 *
 * Le stockage peut être indisponible (WebView en mode restreint, quota,
 * navigation privée) : on ne plante jamais, et dans le doute on considère la
 * présentation comme non vue, ce qui la montre une fois de plus.
 */
export const CLE_PRESENTATION = "tcheyna.presentation.vue";

export function presentationVue(): boolean {
  try {
    return localStorage.getItem(CLE_PRESENTATION) === "1";
  } catch {
    return false;
  }
}

export function marquerPresentationVue(): void {
  try {
    localStorage.setItem(CLE_PRESENTATION, "1");
  } catch {
    // Stockage indisponible : la présentation reviendra au prochain lancement.
  }
}
