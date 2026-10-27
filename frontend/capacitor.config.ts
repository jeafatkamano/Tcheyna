// capacitor.config.ts — Application Android (Capacitor) autour du frontend.
//
// L'interface est embarquée dans l'APK (`webDir`), pas chargée depuis le
// site : pas de `server.url`. L'appli s'ouvre donc sans réseau et pendant le
// réveil de l'API Render gratuite. Voir ANDROID.md.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Provisoire : l'identifiant ne pourra plus changer une fois l'appli publiée
  // sur le Play Store (question ouverte dans la PR).
  appId: "com.tcheyna.app",
  appName: "Tcheyna",
  webDir: "dist",
  android: {
    // L'API est en HTTPS : aucune ressource HTTP ne doit se charger.
    allowMixedContent: false,
  },
  plugins: {
    // Android 15+ (cible 36) impose l'affichage bord à bord : la page passe
    // sous la barre d'état. Capacitor 8 injecte les vraies marges dans
    // --safe-area-inset-* (WebView < 140 donne de fausses valeurs à env()) ;
    // index.css s'en sert pour poser une bande bleu nuit sous la barre, comme
    // Telegram. DARK = icônes et heure en clair, pour un fond sombre.
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
    },
  },
};

export default config;
