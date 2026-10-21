/**
 * AuthContext.tsx — Session utilisateur.
 *
 * Source de vérité unique pour `user`. Après toute action modifiant le niveau
 * de confiance (OTP, dépôt de document), appeler `rafraichir()` pour que les
 * badges et les accès de l'interface reflètent l'état du serveur.
 *
 * Au démarrage, une coupure réseau ou un serveur endormi ne vaut pas
 * déconnexion : les jetons sont gardés et `erreurSession` propose de
 * réessayer. Seul un refus du serveur (401/403/404) efface la session.
 *
 * `deconnecter()` demande au serveur de révoquer les jetons (toutes les
 * sessions du compte), puis efface la session locale sans attendre sa
 * réponse : voir `revoquerJetonsServeur`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, authAPI, MESSAGE_RESEAU, tokens, type ReponseAuth, type Role, type User } from "../api";

interface AuthContextValue {
  user: User | null;
  chargement: boolean;
  /** Session impossible à vérifier (réseau) : l'utilisateur n'est pas déconnecté. */
  erreurSession: string | null;
  reessayerSession: () => void;
  estConnecte: boolean;
  connecter: (email: string, motDePasse: string) => Promise<User>;
  inscrire: (data: DonneesInscription) => Promise<User>;
  deconnecter: () => void;
  rafraichir: () => Promise<User | null>;
  /** Route d'accueil correspondant au rôle. */
  accueilDuRole: (role?: Role) => string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type DonneesInscription = Parameters<typeof authAPI.inscrire>[0];

type VerificationSession =
  | { user: User }
  | { refusee: true }
  | { erreur: string };

/** Vérifie la session auprès du serveur, sans toucher à l'état React. */
async function verifierSession(): Promise<VerificationSession> {
  try {
    return { user: await authAPI.moi() };
  } catch (err) {
    if (err instanceof ApiError && [401, 403, 404].includes(err.statut)) return { refusee: true };
    return { erreur: err instanceof ApiError ? err.message : MESSAGE_RESEAU };
  }
}

/**
 * Délai laissé au serveur pour révoquer les jetons. Rien ne l'attend (la
 * déconnexion locale est immédiate) : il borne seulement la requête, pour
 * qu'une révocation partie en 3G ne traîne pas et ne coure pas après une
 * reconnexion.
 */
const DELAI_DECONNEXION_MS = 5_000;

/**
 * Révoque les jetons côté serveur (POST /auth/logout). Les jetons sont lus par
 * l'appelant **avant** l'effacement local, et la requête part aussitôt.
 *
 * Toute issue est ignorée, sans message pour l'utilisateur : coupure, délai
 * dépassé, 401 (jeton déjà révoqué), 404 (backend antérieur au lot 1.12), 5xx.
 * La déconnexion locale suffit à ces cas.
 *
 * Jeton d'accès expiré (2 h) : un seul nouvel essai avec le jeton de
 * rafraîchissement (30 jours), que la route accepte et qu'il importe le plus
 * de révoquer. Jamais de passage par /auth/refresh : pas de boucle possible.
 */
async function revoquerJetonsServeur(acces: string | null, refresh: string | null) {
  const jeton = acces ?? refresh;
  if (!jeton) return;
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_DECONNEXION_MS);
  try {
    await authAPI.deconnecter(jeton, controleur.signal);
  } catch (err) {
    if (err instanceof ApiError && err.statut === 401 && acces && refresh) {
      await authAPI.deconnecter(refresh, controleur.signal).catch(() => undefined);
    }
  } finally {
    clearTimeout(minuterie);
  }
}

const ACCUEILS: Record<Role, string> = {
  tenant: "/tenant/dashboard",
  landlord: "/owner/dashboard",
  agency: "/owner/dashboard",
  admin: "/admin",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Sans jeton, rien à vérifier : pas d'écran de chargement.
  const [chargement, setChargement] = useState(() => Boolean(tokens.access()));
  const [erreurSession, setErreurSession] = useState<string | null>(null);

  const appliquerVerification = useCallback((resultat: VerificationSession) => {
    if ("user" in resultat) {
      setUser(resultat.user);
      setErreurSession(null);
    } else if ("refusee" in resultat) {
      tokens.clear();
      setErreurSession(null);
    } else {
      setErreurSession(resultat.erreur);
    }
    setChargement(false);
  }, []);

  useEffect(() => {
    if (!tokens.access()) return;
    let actif = true;
    void verifierSession().then((resultat) => actif && appliquerVerification(resultat));
    return () => {
      actif = false;
    };
  }, [appliquerVerification]);

  const reessayerSession = useCallback(() => {
    setChargement(true);
    void verifierSession().then(appliquerVerification);
  }, [appliquerVerification]);

  const appliquerSession = useCallback((data: ReponseAuth) => {
    tokens.set(data.access_token, data.refresh_token);
    setUser(data.user);
    return data.user;
  }, []);

  const connecter = useCallback(
    async (email: string, motDePasse: string) =>
      appliquerSession(await authAPI.connecter(email, motDePasse)),
    [appliquerSession],
  );

  const inscrire = useCallback(
    async (data: DonneesInscription) =>
      appliquerSession(await authAPI.inscrire(data)),
    [appliquerSession],
  );

  const deconnecter = useCallback(() => {
    // Requête lancée avant l'effacement, mais pas attendue : l'utilisateur
    // est déconnecté tout de suite, quelle que soit la réponse du serveur.
    void revoquerJetonsServeur(tokens.access(), tokens.refresh());
    tokens.clear();
    setUser(null);
    setErreurSession(null);
  }, []);

  const rafraichir = useCallback(async () => {
    if (!tokens.access()) return null;
    try {
      const frais = await authAPI.moi();
      setUser(frais);
      return frais;
    } catch {
      return null;
    }
  }, []);

  const valeur = useMemo<AuthContextValue>(
    () => ({
      user,
      chargement,
      erreurSession,
      reessayerSession,
      estConnecte: Boolean(user),
      connecter,
      inscrire,
      deconnecter,
      rafraichir,
      accueilDuRole: (role) => ACCUEILS[role ?? user?.role ?? "tenant"] ?? "/tenant/dashboard",
    }),
    [user, chargement, erreurSession, reessayerSession, connecter, inscrire, deconnecter, rafraichir],
  );

  return <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'un AuthProvider");
  return ctx;
}
