import { Capacitor } from "@capacitor/core";
import { RouterProvider } from "react-router";

import { AuthProvider } from "./context/AuthContext";
import { MiseAJourPwa } from "./pwa/MiseAJourPwa";
import { router } from "./routes";

// Service worker : sur le site seulement. Dans l'application Android,
// l'interface est déjà embarquée et se met à jour par une nouvelle APK.
const surLeSite = !Capacitor.isNativePlatform();

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      {surLeSite && <MiseAJourPwa />}
    </AuthProvider>
  );
}
