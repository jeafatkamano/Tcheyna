/**
 * natif.ts — Comportements propres à l'application Android (Capacitor).
 *
 * Sur le site web, rien ne s'exécute : tout est conditionné par
 * `Capacitor.isNativePlatform()`, et le module du bouton retour n'est chargé
 * que dans l'appli.
 *
 * Lot 3.16 : la classe `app-native` sur <html> active les règles propres à
 * l'application (index.css : pas de surlignage au toucher, pas de zoom par
 * double toucher, retour visuel, glissement entre les pages).
 */
import { Capacitor } from "@capacitor/core";

import { fermerDernier } from "./fermables";

/**
 * Écrans de départ : le bouton retour y ferme l'application au lieu de
 * revenir en arrière (vers la présentation ou un écran déjà quitté).
 */
const ECRANS_DE_DEPART = ["/tenant/dashboard", "/owner/dashboard", "/admin", "/bienvenue", "/login"];

export type Retour = "ferme" | "quitte" | "recule";

/**
 * Décide de l'effet du bouton retour d'Android :
 *   1. une feuille du bas ou le menu latéral est ouvert : il se ferme ;
 *   2. écran de départ (accueil du rôle, présentation, connexion) : l'appli se ferme ;
 *   3. sinon, page précédente s'il y en a une, ou fermeture de l'appli.
 */
export function retourAndroid(
  chemin: string,
  peutReculer: boolean,
  actions: { reculer: () => void; quitter: () => void },
): Retour {
  if (fermerDernier()) return "ferme";
  const ecran = chemin.replace(/\/+$/, "") || "/";
  if (ECRANS_DE_DEPART.includes(ecran) || !peutReculer) {
    actions.quitter();
    return "quitte";
  }
  actions.reculer();
  return "recule";
}

export async function initialiserNatif(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("app-native");

  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", ({ canGoBack }) => {
    retourAndroid(window.location.pathname, canGoBack, {
      reculer: () => window.history.back(),
      quitter: () => void App.exitApp(),
    });
  });
}
