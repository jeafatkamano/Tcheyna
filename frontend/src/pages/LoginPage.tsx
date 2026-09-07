import { ArrowLeft, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { MessageErreur } from "../components/Etats";
import { useAuth } from "../context/AuthContext";
import { useAction } from "../hooks/useApi";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { connecter, accueilDuRole } = useAuth();

  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [afficherMdp, setAfficherMdp] = useState(false);

  const connexion = useAction(connecter);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    const user = await connexion.executer(email, motDePasse);
    if (!user) return;
    // Retour à la page demandée avant la redirection, sinon accueil du rôle.
    const destination = (location.state as { from?: string } | null)?.from;
    navigate(destination ?? accueilDuRole(user.role), { replace: true });
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(160deg, #0F2040 0%, #1E3A5F 60%, #0F2040 100%)" }}
    >
      <header className="flex items-center justify-between px-6 pt-8 pb-4">
        <Link to="/" className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <span className="text-white font-bold tracking-tight" style={{ fontSize: "22px" }}>
          tcheyna
        </span>
        <span className="w-9" />
      </header>

      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-sm mx-auto">
          <h1 className="text-white font-bold mb-2" style={{ fontSize: "28px", lineHeight: 1.2 }}>
            Bon retour 👋
          </h1>
          <p className="text-white/60 mb-8" style={{ fontSize: "15px" }}>
            Connectez-vous pour retrouver vos annonces et vos mises en relation.
          </p>

          <form onSubmit={soumettre} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-white/80 mb-1.5">
                Adresse e-mail
              </label>
              <div className="relative">
                <Mail
                  size={17}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2"
                  style={{ color: "#94A3B8" }}
                />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl outline-none"
                  style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="mdp" className="block text-sm font-semibold text-white/80 mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <Lock
                  size={17}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2"
                  style={{ color: "#94A3B8" }}
                />
                <input
                  id="mdp"
                  type={afficherMdp ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-3.5 rounded-xl outline-none"
                  style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
                />
                <button
                  type="button"
                  onClick={() => setAfficherMdp(!afficherMdp)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2"
                  style={{ color: "#94A3B8" }}
                  aria-label={afficherMdp ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {afficherMdp ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <MessageErreur message={connexion.erreur} />

            <button
              type="submit"
              disabled={connexion.enCours}
              className="w-full py-4 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
              style={{ background: "#F97316", fontSize: "16px" }}
            >
              {connexion.enCours ? "Connexion…" : "Se connecter"}
            </button>
          </form>

          <p className="text-center text-white/50 text-sm mt-6">
            Pas encore de compte ?{" "}
            <Link to="/inscription" className="font-semibold" style={{ color: "#F97316" }}>
              Créer un compte
            </Link>
          </p>

          <p className="text-center text-white/35 text-xs mt-3 leading-relaxed">
            Votre compte reste actif après déconnexion : vos annonces, vos
            candidatures et vos échanges vous attendent.
          </p>

          <div className="mt-8 pt-6 border-t border-white/10">
            <p className="text-center text-white/40 text-xs mb-3">Vous découvrez Tcheyna ?</p>
            <div className="flex gap-3">
              <Link
                to="/onboarding/tenant"
                className="flex-1 py-3 rounded-xl text-center text-sm font-semibold"
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1.5px solid rgba(255,255,255,0.2)" }}
              >
                Je cherche
              </Link>
              <Link
                to="/onboarding/owner"
                className="flex-1 py-3 rounded-xl text-center text-sm font-semibold"
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1.5px solid rgba(255,255,255,0.2)" }}
              >
                Je loue
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
