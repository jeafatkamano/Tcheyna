/**
 * natif.ts — Comportements propres à l'application Android (Capacitor).
 *
 * Sur le site web, rien ne s'exécute : tout est conditionné par
 * `Capacitor.isNativePlatform()`, et le module du bouton retour n'est chargé
 * que dans l'appli.
 */
import { Capacitor } from "@capacitor/core";

export async function initialiserNatif(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { App } = await import("@capacitor/app");
  // Bouton retour Android : page précédente si l'historique le permet, sinon
  // on quitte l'appli, comme le font les applications Android natives.
  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
