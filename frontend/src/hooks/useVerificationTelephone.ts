/**
 * useVerificationTelephone.ts — Envoi et vérification du code SMS du numéro.
 *
 * Partagé par PhoneVerification (onboarding, profil) et l'écran « Vérifiez
 * votre numéro » qui suit l'inscription (lot 3.14) : même envoi, même renvoi,
 * même compte à rebours.
 */
import { useEffect, useState } from "react";

import { authAPI } from "../api";
import { useAuth } from "../context/AuthContext";
import { useAction } from "./useApi";

/** Le backend impose 60 s entre deux envois : on l'affiche plutôt que de laisser découvrir l'erreur. */
export const ATTENTE_RENVOI_S = 60;

export function useVerificationTelephone() {
  const { rafraichir } = useAuth();
  const [codeDebug, setCodeDebug] = useState<string | null>(null);
  const [compteARebours, setCompteARebours] = useState(0);

  const envoi = useAction(authAPI.envoyerOTP);
  const verification = useAction(authAPI.verifierOTP);

  useEffect(() => {
    if (compteARebours <= 0) return;
    const minuterie = setTimeout(() => setCompteARebours((s) => s - 1), 1000);
    return () => clearTimeout(minuterie);
  }, [compteARebours]);

  /** Envoie un code ; vrai si le serveur l'a accepté. */
  async function envoyer(phone?: string): Promise<boolean> {
    const reponse = await envoi.executer(phone?.trim() || undefined);
    if (!reponse) return false;
    setCodeDebug(reponse.debug_code ?? null);
    setCompteARebours(ATTENTE_RENVOI_S);
    return true;
  }

  /** Vérifie le code ; renvoie le nouveau niveau de confiance, ou null. */
  async function verifier(code: string): Promise<number | null> {
    const reponse = await verification.executer(code.trim());
    if (!reponse) return null;
    await rafraichir();
    return reponse.trust_level;
  }

  return { envoyer, verifier, envoi, verification, codeDebug, compteARebours };
}
