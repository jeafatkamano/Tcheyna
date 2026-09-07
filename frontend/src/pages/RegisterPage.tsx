import { ArrowLeft, Eye, EyeOff, Home, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import type { Role } from "../api";
import { MessageErreur } from "../components/Etats";
import { useAuth } from "../context/AuthContext";
import { useAction } from "../hooks/useApi";
import { useGeo } from "../hooks/useGeo";

type RoleInscription = Exclude<Role, "admin">;

interface Props {
  /** Rôle imposé par le parcours d'onboarding (masque alors le sélecteur). */
  roleImpose?: RoleInscription;
  /** Appelé après une inscription réussie. Sans lui, on redirige vers l'espace. */
  onInscrit?: () => void;
}

export function RegisterPage({ roleImpose, onInscrit }: Props = {}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { inscrire, accueilDuRole } = useAuth();

  const roleInitial = roleImpose ?? (params.get("role") as RoleInscription) ?? "tenant";
  const [role, setRole] = useState<RoleInscription>(
    ["tenant", "landlord", "agency"].includes(roleInitial) ? roleInitial : "tenant",
  );
  const [afficherMdp, setAfficherMdp] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    pays: "Guinée",
    ville: "Conakry",
    quartier: "",
  });

  const geo = useGeo(form.pays, form.ville);
  const inscription = useAction(inscrire);

  const maj = (champ: keyof typeof form) => (valeur: string) =>
    setForm((f) => ({ ...f, [champ]: valeur }));

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    const user = await inscription.executer({
      ...form,
      role,
      phone: form.phone.trim() || undefined,
      quartier: form.quartier || undefined,
    });
    if (!user) return;
    // Depuis l'onboarding, on enchaîne sur l'étape suivante plutôt que de
    // basculer directement dans l'espace connecté.
    if (onInscrit) onInscrit();
    else navigate(accueilDuRole(user.role), { replace: true });
  }

  const champ = "w-full px-4 py-3.5 rounded-xl outline-none";
  const styleChamp = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };

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

      <div className="flex-1 px-6 pb-10">
        <div className="w-full max-w-sm mx-auto">
          <h1 className="text-white font-bold mb-2" style={{ fontSize: "26px", lineHeight: 1.2 }}>
            Créer votre compte
          </h1>
          <p className="text-white/60 mb-6" style={{ fontSize: "15px" }}>
            Gratuit. Vous construirez votre niveau de confiance étape par étape.
          </p>

          {/* Choix du rôle — masqué quand le parcours l'impose déjà */}
          <div className="grid grid-cols-2 gap-3 mb-6" hidden={Boolean(roleImpose)}>
            {(
              [
                { valeur: "tenant" as const, icone: Users, label: "Je cherche", sous: "Locataire" },
                { valeur: "landlord" as const, icone: Home, label: "Je loue", sous: "Propriétaire" },
              ]
            ).map((option) => {
              const actif = role === option.valeur;
              return (
                <button
                  key={option.valeur}
                  type="button"
                  onClick={() => setRole(option.valeur)}
                  className="flex flex-col items-center gap-1.5 py-4 rounded-2xl transition-all"
                  style={{
                    background: actif ? "rgba(249,115,22,0.18)" : "rgba(255,255,255,0.06)",
                    border: `1.5px solid ${actif ? "#F97316" : "rgba(255,255,255,0.15)"}`,
                  }}
                >
                  <option.icone size={22} style={{ color: actif ? "#F97316" : "rgba(255,255,255,0.6)" }} />
                  <span
                    className="font-semibold text-sm"
                    style={{ color: actif ? "#F97316" : "white" }}
                  >
                    {option.label}
                  </span>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {option.sous}
                  </span>
                </button>
              );
            })}
          </div>

          <form onSubmit={soumettre} className="space-y-4">
            <div>
              <label htmlFor="nom" className="block text-sm font-semibold text-white/80 mb-1.5">
                Nom complet
              </label>
              <input
                id="nom"
                required
                value={form.full_name}
                onChange={(e) => maj("full_name")(e.target.value)}
                placeholder="Aminata Diallo"
                className={champ}
                style={styleChamp}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-white/80 mb-1.5">
                Adresse e-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => maj("email")(e.target.value)}
                placeholder="vous@exemple.com"
                className={champ}
                style={styleChamp}
              />
            </div>

            <div>
              <label htmlFor="tel" className="block text-sm font-semibold text-white/80 mb-1.5">
                Téléphone <span className="font-normal text-white/40">(recommandé)</span>
              </label>
              <input
                id="tel"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => maj("phone")(e.target.value)}
                placeholder="622 52 92 52"
                className={champ}
                style={styleChamp}
              />
              <p className="text-xs text-white/40 mt-1.5">
                Vérifié par SMS pour atteindre le niveau 1 et pouvoir candidater.
              </p>
            </div>

            <div>
              <label htmlFor="mdp" className="block text-sm font-semibold text-white/80 mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="mdp"
                  type={afficherMdp ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => maj("password")(e.target.value)}
                  placeholder="8 caractères minimum"
                  className={`${champ} pr-11`}
                  style={styleChamp}
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ville" className="block text-sm font-semibold text-white/80 mb-1.5">
                  Ville
                </label>
                <select
                  id="ville"
                  value={form.ville}
                  onChange={(e) => setForm((f) => ({ ...f, ville: e.target.value, quartier: "" }))}
                  className={champ}
                  style={styleChamp}
                >
                  {geo.villes.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="quartier" className="block text-sm font-semibold text-white/80 mb-1.5">
                  Quartier
                </label>
                <select
                  id="quartier"
                  value={form.quartier}
                  onChange={(e) => maj("quartier")(e.target.value)}
                  className={champ}
                  style={styleChamp}
                >
                  <option value="">À préciser</option>
                  {geo.quartiers.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <MessageErreur message={inscription.erreur} />

            <button
              type="submit"
              disabled={inscription.enCours}
              className="w-full py-4 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
              style={{ background: "#F97316", fontSize: "16px" }}
            >
              {inscription.enCours ? "Création du compte…" : "Créer mon compte"}
            </button>
          </form>

          <p className="text-center text-white/50 text-sm mt-6">
            Déjà inscrit ?{" "}
            <Link to="/login" className="font-semibold" style={{ color: "#F97316" }}>
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
