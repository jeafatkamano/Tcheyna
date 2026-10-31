/**
 * transitions.ts — Glissement latéral entre les pages, dans l'application
 * seulement (lot 3.16).
 *
 * À passer à `viewTransition` (liens et `navigate` de React Router). Faux sur
 * le site, quand le système demande moins d'animations, ou quand le
 * navigateur ne connaît pas `document.startViewTransition` : la navigation se
 * fait alors sans transition. L'animation elle-même est dans index.css.
 */
export function transitionPage(): boolean {
  if (typeof document === "undefined") return false;
  if (!document.documentElement.classList.contains("app-native")) return false;
  if (typeof (document as Document & { startViewTransition?: unknown }).startViewTransition !== "function") {
    return false;
  }
  return !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
