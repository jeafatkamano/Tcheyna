import { ArrowLeft, Search, ShieldOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { adminAPI, type Role, type User } from "../../api";
import { BadgeVerification } from "../../components/BadgeVerification";
import { Chargement, Erreur, ListeVide, MessageErreur } from "../../components/Etats";
import { useAction, useApi } from "../../hooks/useApi";
import { formatRelatif, initiales } from "../../lib/format";

const ROLES: { valeur: Role | undefined; label: string }[] = [
  { valeur: undefined, label: "Tous" },
  { valeur: "tenant", label: "Locataires" },
  { valeur: "landlord", label: "Propriétaires" },
  { valeur: "agency", label: "Agences" },
  { valeur: "admin", label: "Admins" },
];

export function AdminUsers() {
  const [role, setRole] = useState<Role | undefined>(undefined);
  const [recherche, setRecherche] = useState("");

  const utilisateurs = useApi(
    () => adminAPI.utilisateurs({ role, q: recherche.trim() || undefined }),
    [role, recherche],
  );
  const bascule = useAction(adminAPI.basculerStatut);

  async function basculerStatut(utilisateur: User) {
    const desactiver = utilisateur.is_active !== false;
    const action = desactiver ? "désactiver" : "réactiver";
    if (!window.confirm(`Voulez-vous ${action} le compte de ${utilisateur.full_name} ?`)) return;

    const ok = await bascule.executer(utilisateur.id, !desactiver);
    if (ok) void utilisateurs.recharger();
  }

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-4" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center gap-3 mb-4">
          <Link to="/admin" className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-white font-bold" style={{ fontSize: "19px" }}>
            Utilisateurs
          </h1>
        </div>

        <div className="relative">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "#94A3B8" }}
          />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom ou adresse e-mail…"
            aria-label="Rechercher un utilisateur"
            className="w-full pl-10 pr-4 py-3 rounded-xl outline-none"
            style={{ background: "white", fontSize: "14px" }}
          />
        </div>
      </div>

      <div
        className="flex gap-2 px-4 py-3 overflow-x-auto"
        style={{ background: "#1E3A5F", borderBottom: "1px solid rgba(255,255,255,0.1)" }}
      >
        {ROLES.map((r) => (
          <button
            key={r.label}
            onClick={() => setRole(r.valeur)}
            className="px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
            style={{
              background: role === r.valeur ? "#F97316" : "rgba(255,255,255,0.12)",
              color: role === r.valeur ? "white" : "rgba(255,255,255,0.6)",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-4 space-y-3">
        <MessageErreur message={bascule.erreur} />

        {utilisateurs.data && (
          <p className="text-sm text-gray-500">
            <span className="font-bold" style={{ color: "#1E3A5F" }}>
              {utilisateurs.data.total}
            </span>{" "}
            utilisateur{utilisateurs.data.total > 1 ? "s" : ""}
          </p>
        )}

        {utilisateurs.chargement ? (
          <Chargement />
        ) : utilisateurs.erreur ? (
          <Erreur message={utilisateurs.erreur} onReessayer={utilisateurs.recharger} />
        ) : !utilisateurs.data?.users.length ? (
          <ListeVide titre="Aucun utilisateur" description="Aucun résultat pour cette recherche." />
        ) : (
          utilisateurs.data.users.map((utilisateur) => {
            const actif = utilisateur.is_active !== false;
            return (
              <div
                key={utilisateur.id}
                className="flex items-center gap-3 p-4 rounded-2xl"
                style={{
                  background: "white",
                  boxShadow: "0 2px 12px rgba(30,58,95,0.07)",
                  opacity: actif ? 1 : 0.6,
                }}
              >
                <Link
                  to={`/profil/${utilisateur.id}`}
                  className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 font-bold text-white"
                  style={{ background: "#1E3A5F" }}
                >
                  {initiales(utilisateur.full_name)}
                </Link>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                    {utilisateur.full_name}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{utilisateur.email}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "#F0F4FA", color: "#64748B" }}
                    >
                      {
                        { tenant: "Locataire", landlord: "Propriétaire", agency: "Agence", admin: "Admin" }[
                          utilisateur.role
                        ]
                      }
                    </span>
                    <BadgeVerification level={utilisateur.trust_level} size="sm" />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Inscrit {formatRelatif(utilisateur.created_at)}
                  </p>
                </div>

                {utilisateur.role !== "admin" && (
                  <button
                    onClick={() => basculerStatut(utilisateur)}
                    disabled={bascule.enCours}
                    className="p-2.5 rounded-xl flex-shrink-0 disabled:opacity-50"
                    style={{
                      background: actif ? "#FEE2E2" : "#D1FAE5",
                      color: actif ? "#DC2626" : "#059669",
                    }}
                    aria-label={actif ? "Désactiver le compte" : "Réactiver le compte"}
                  >
                    {actif ? <ShieldOff size={17} /> : <ShieldCheck size={17} />}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
