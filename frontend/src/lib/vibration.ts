/**
 * vibration.ts — Vibration légère qui confirme une action, dans
 * l'application seulement (lot 3.16) : message envoyé, candidature envoyée,
 * code validé, paiement confirmé.
 *
 * Sans effet sur le site. Le module @capacitor/haptics n'est chargé que dans
 * l'application ; un appareil sans vibreur, ou un échec, ne change rien.
 */
import { Capacitor } from "@capacitor/core";

export async function vibrerLegerement(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Pas de vibreur, ou greffon absent : l'action a réussi, on n'insiste pas.
  }
}
