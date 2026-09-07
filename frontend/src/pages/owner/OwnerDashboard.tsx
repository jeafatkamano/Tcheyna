import {
  ChevronRight,
  Eye,
  MessageSquare,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router";

import { listingsAPI, matchesAPI } from "../../api";
import { BadgeVerification, ScoreCircle } from "../../components/BadgeVerification";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { ListingCard } from "../../components/ListingCard";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { formatRelatif, initiales } from "../../lib/format";

export function OwnerDashboard() {
  const { user } = useAuth();

  const annonces = useApi(() => listingsAPI.mesAnnonces(), []);
  const demandes = useApi(() => matchesAPI.mesDemandes(), []);

  const stats = annonces.data?.stats;
  const candidaturesEnAttente = (demandes.data?.matches ?? []).filter((m) => m.status === "pending");
  const nonCertifiees = (annonces.data?.listings ?? []).filter(
    (l) => l.certification_status === "none" && l.status === "active",
  );

  return (
    <div className="pb-8">
      {/* En-tête */}
      <div className="px-4 pt-6 pb-8" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {initiales(user?.full_name)}
          </div>
          <div className="min-w-0">
            <p className="text-white/60 text-sm">Bonjour 👋</p>
            <h1 className="text-white font-bold text-xl truncate">{user?.full_name}</h1>
            <div className="mt-1">
              <BadgeVerification level={user?.trust_level ?? 0} size="sm" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Annonces", valeur: stats?.actives ?? 0, icone: Users, couleur: "#F97316" },
            { label: "Certifiées", valeur: stats?.certifiees ?? 0, icone: ShieldCheck, couleur: "#10B981" },
            { label: "Vues", valeur: stats?.vues ?? 0, icone: Eye, couleur: "#3B82F6" },
            { label: "Candidats", valeur: stats?.candidatures ?? 0, icone: MessageSquare, couleur: "#8B5CF6" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl p-3 flex flex-col items-center text-center"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <s.icone size={17} style={{ color: s.couleur }} />
              <span className="text-white font-bold text-lg mt-1">{s.valeur}</span>
              <span className="text-white/50 text-xs leading-tight">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-5 -mt-3 relative z-10">
        {/* Nouvelles candidatures */}
        {candidaturesEnAttente.length > 0 && (
          <Link
            to="/owner/matches"
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", display: "flex" }}
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#FFEDD5" }}
            >
              <Users size={21} style={{ color: "#EA580C" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: "#9A3412" }}>
                {candidaturesEnAttente.length} candidature
                {candidaturesEnAttente.length > 1 ? "s" : ""} à examiner
              </p>
              <p className="text-xs" style={{ color: "#C2410C" }}>
                Dernière {formatRelatif(candidaturesEnAttente[0].created_at)}
              </p>
            </div>
            <ChevronRight size={18} style={{ color: "#EA580C", flexShrink: 0 }} />
          </Link>
        )}

        {/* Incitation à la certification */}
        {nonCertifiees.length > 0 && (
          <Link
            to={`/owner/listings/${nonCertifiees[0].id}`}
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", display: "flex" }}
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#DBEAFE" }}
            >
              <ShieldAlert size={21} style={{ color: "#1D4ED8" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: "#1E3070" }}>
                {nonCertifiees.length} annonce{nonCertifiees.length > 1 ? "s" : ""} non certifiée
                {nonCertifiees.length > 1 ? "s" : ""}
              </p>
              <p className="text-xs" style={{ color: "#1D4ED8" }}>
                Les annonces certifiées remontent dans les résultats de recherche.
              </p>
            </div>
            <ChevronRight size={18} style={{ color: "#1D4ED8", flexShrink: 0 }} />
          </Link>
        )}

        {/* Candidats récents */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold" style={{ color: "#1E293B", fontSize: "18px" }}>
              Candidats récents
            </h2>
            <Link
              to="/owner/matches"
              className="text-sm font-semibold flex items-center gap-1"
              style={{ color: "#F97316" }}
            >
              Tous voir <ChevronRight size={14} />
            </Link>
          </div>

          {demandes.chargement ? (
            <SqueletteCartes nombre={1} />
          ) : demandes.erreur ? (
            <Erreur message={demandes.erreur} onReessayer={demandes.recharger} />
          ) : !demandes.data?.matches.length ? (
            <div
              className="rounded-2xl p-5 text-center"
              style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
            >
              <p className="text-sm text-gray-500">
                Aucune candidature pour l'instant. Certifiez vos annonces pour attirer les locataires
                vérifiés.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {demandes.data.matches.slice(0, 3).map((match) => (
                <Link
                  key={match.id}
                  to="/owner/matches"
                  className="flex items-center gap-4 p-4 rounded-2xl transition-transform active:scale-[0.98]"
                  style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
                >
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 font-bold text-white"
                    style={{ background: "#1E3A5F" }}
                  >
                    {initiales(match.tenant?.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                      {match.tenant?.full_name}
                    </p>
                    <p className="text-xs text-gray-400 truncate mb-1.5">{match.listing?.title}</p>
                    <BadgeVerification level={match.tenant?.trust_level ?? 0} size="sm" />
                  </div>
                  {match.passeport && <ScoreCircle score={match.passeport.score} size={40} label="" />}
                  <ChevronRight size={18} style={{ color: "#CBD5E1", flexShrink: 0 }} />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Mes annonces */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold" style={{ color: "#1E293B", fontSize: "18px" }}>
              Mes biens
            </h2>
            <Link
              to="/owner/listings/nouveau"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white"
              style={{ background: "#F97316" }}
            >
              <Plus size={14} />
              Publier
            </Link>
          </div>

          {annonces.chargement ? (
            <SqueletteCartes nombre={2} />
          ) : annonces.erreur ? (
            <Erreur message={annonces.erreur} onReessayer={annonces.recharger} />
          ) : !annonces.data?.listings.length ? (
            <ListeVide
              titre="Aucune annonce publiée"
              description="Publiez votre premier bien pour commencer à recevoir des candidatures vérifiées."
              action={{ label: "Publier une annonce", to: "/owner/listings/nouveau" }}
            />
          ) : (
            <div className="space-y-4">
              {annonces.data.listings.slice(0, 3).map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  to={`/owner/listings/${listing.id}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
