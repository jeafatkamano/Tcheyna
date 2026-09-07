import {
  ArrowRight,
  CheckCircle,
  ChevronRight,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

import { favorisAPI, listingsAPI, passportAPI, type Listing } from "../../api";
import { Avatar } from "../../components/Avatar";
import { BadgeVerification, ScoreCircle } from "../../components/BadgeVerification";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { ListingCard } from "../../components/ListingCard";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";


export function TenantDashboard() {
  const { user } = useAuth();

  const passeport = useApi(() => passportAPI.recuperer(), []);
  const recommandations = useApi(() => listingsAPI.recommandations(6), []);

  async function basculerFavori(listing: Listing) {
    // Optimiste : le cœur réagit immédiatement, on corrige si l'API refuse.
    recommandations.muter((precedent) => ({
      ...precedent,
      listings: precedent.listings.map((l) =>
        l.id === listing.id ? { ...l, is_favorite: !l.is_favorite } : l,
      ),
    }));
    try {
      await (listing.is_favorite ? favorisAPI.retirer(listing.id) : favorisAPI.ajouter(listing.id));
    } catch {
      recommandations.muter((precedent) => ({
        ...precedent,
        listings: precedent.listings.map((l) =>
          l.id === listing.id ? { ...l, is_favorite: listing.is_favorite } : l,
        ),
      }));
    }
  }

  const niveau = user?.trust_level ?? 0;
  const score = passeport.data?.score ?? 0;
  const etapes = passeport.data?.etapes ?? [];
  const prochaineEtape = etapes.find((e) => !e.fait);

  return (
    <div className="pb-8">
      {/* En-tête */}
      <div className="px-4 py-6" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center gap-4 mb-6">
          <Avatar nom={user?.full_name} url={user?.avatar_url} taille={56} surFonce />
          <div className="min-w-0">
            <p className="text-white/60 text-sm">Bonjour 👋</p>
            <h1 className="text-white font-bold text-xl truncate">{user?.full_name}</h1>
            <div className="mt-1">
              <BadgeVerification level={niveau} size="sm" />
            </div>
          </div>
        </div>

        {/* Score de dossier et prochaine étape */}
        <Link
          to="/tenant/profile"
          className="rounded-2xl p-4 flex items-center gap-5 transition-transform active:scale-[0.99]"
          style={{ background: "rgba(255,255,255,0.08)", display: "flex" }}
        >
          <ScoreCircle score={score} size={76} />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold mb-1">Score de dossier</p>
            {prochaineEtape ? (
              <>
                <p className="text-white/60 text-xs mb-2 leading-relaxed">
                  Prochaine étape : {prochaineEtape.titre}
                </p>
                <span className="text-xs font-semibold" style={{ color: "#F97316" }}>
                  Compléter mon dossier →
                </span>
              </>
            ) : (
              <p className="text-white/60 text-xs">
                Dossier complet. Vous êtes prioritaire auprès des propriétaires.
              </p>
            )}
          </div>
        </Link>
      </div>

      {/* Alerte si le téléphone n'est pas vérifié */}
      {niveau === 0 && (
        <div className="px-4 mt-5">
          <Link
            to="/tenant/profile"
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", display: "flex" }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#FFEDD5" }}
            >
              <ShieldAlert size={20} style={{ color: "#EA580C" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: "#9A3412" }}>
                Vérifiez votre numéro de téléphone
              </p>
              <p className="text-xs" style={{ color: "#C2410C" }}>
                Indispensable pour candidater aux annonces.
              </p>
            </div>
            <ChevronRight size={18} style={{ color: "#EA580C", flexShrink: 0 }} />
          </Link>
        </div>
      )}

      {/* Raccourcis */}
      <div className="px-4 mt-5 grid grid-cols-2 gap-3">
        <Link
          to="/tenant/listings"
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "#EFF6FF" }}
          >
            <Search size={19} style={{ color: "#1E3A5F" }} />
          </div>
          <span className="font-semibold text-sm" style={{ color: "#1E293B" }}>
            Rechercher
          </span>
          <span className="text-xs text-gray-400">Toutes les annonces</span>
        </Link>
        <Link
          to="/tenant/matches"
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "#FFF7ED" }}
          >
            <CheckCircle size={19} style={{ color: "#F97316" }} />
          </div>
          <span className="font-semibold text-sm" style={{ color: "#1E293B" }}>
            Mes candidatures
          </span>
          <span className="text-xs text-gray-400">Suivi des dossiers</span>
        </Link>
      </div>

      {/* Recommandations */}
      <div className="px-4 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={17} style={{ color: "#F97316" }} />
            <h2 className="font-bold" style={{ color: "#1E293B", fontSize: "18px" }}>
              Pour vous
            </h2>
          </div>
          <Link
            to="/tenant/listings"
            className="text-sm font-semibold flex items-center gap-1"
            style={{ color: "#F97316" }}
          >
            Tout voir <ArrowRight size={14} />
          </Link>
        </div>

        {recommandations.chargement ? (
          <SqueletteCartes nombre={2} />
        ) : recommandations.erreur ? (
          <Erreur message={recommandations.erreur} onReessayer={recommandations.recharger} />
        ) : !recommandations.data?.listings.length ? (
          <ListeVide
            titre="Aucune annonce compatible pour l'instant"
            description={
              recommandations.data?.passeport_complet
                ? "De nouvelles annonces arrivent chaque semaine à Conakry. Revenez bientôt."
                : "Précisez vos critères de recherche pour obtenir des propositions ciblées."
            }
            action={
              recommandations.data?.passeport_complet
                ? { label: "Parcourir les annonces", to: "/tenant/listings" }
                : { label: "Définir mes critères", to: "/tenant/profile" }
            }
          />
        ) : (
          <div className="space-y-4">
            {recommandations.data.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} onToggleFavori={basculerFavori} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
