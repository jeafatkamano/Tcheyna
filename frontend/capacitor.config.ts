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
};

export default config;
