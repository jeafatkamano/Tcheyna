/**
 * AuthContext.tsx — Session utilisateur.
 *
 * Source de vérité unique pour `user`. Après toute action modifiant le niveau
 * de confiance (OTP, dépôt de document), appeler `rafraichir()` pour que les
 * badges et les accès de l'interface reflètent l'état du serveur.
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

import { authAPI, tokens, type ReponseAuth, type Role, type User } from "../api";

interface AuthContextValue {
  user: User | null;
  chargement: boolean;
  estConnecte: boolean;
  connecter: (email: string, motDePasse: string) => Promise<User>;
  inscrire: (data: Parameters<typeof authAPI.inscrire>[0]) => Promise<User>;
  deconnecter: () => void;
  rafraichir: () => Promise<User | null>;
  /** Route d'accueil correspondant au rôle. */
  accueilDuRole: (role?: Role) => string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCUEILS: Record<Role, string> = {
  tenant: "/tenant/dashboard",
  landlord: "/owner/dashboard",
  agency: "/owner/dashboard",
  admin: "/admin",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    if (!tokens.access()) {
      setChargement(false);
      return;
    }
    authAPI
      .moi()
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setChargement(false));
  }, []);

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
    async (data: Parameters<typeof authAPI.inscrire>[0]) =>
      appliquerSession(await authAPI.inscrire(data)),
    [appliquerSession],
  );

  const deconnecter = useCallback(() => {
    tokens.clear();
    setUser(null);
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
      estConnecte: Boolean(user),
      connecter,
      inscrire,
      deconnecter,
      rafraichir,
      accueilDuRole: (role) => ACCUEILS[role ?? user?.role ?? "tenant"] ?? "/tenant/dashboard",
    }),
    [user, chargement, connecter, inscrire, deconnecter, rafraichir],
  );

  return <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'un AuthProvider");
  return ctx;
}
