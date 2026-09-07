import { Eye, Plus, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router";

import { listingsAPI } from "../../api";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { StatutPastille } from "../../components/ListingCard";
import { useApi } from "../../hooks/useApi";
import { formatMontantCourt, labelTypeBien } from "../../lib/format";

const IMAGE_PAR_DEFAUT = "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080&q=80";

const CERTIFICATION = {
  none: { label: "Non certifiée", couleur: "#64748B", fond: "#F1F5F9" },
  pending: { label: "Certification en examen", couleur: "#D97706", fond: "#FEF3C7" },
  certified: { label: "Certifiée", couleur: "#059669", fond: "#D1FAE5" },
  rejected: { label: "Certification refusée", couleur: "#DC2626", fond: "#FEE2E2" },
};

export function OwnerListings() {
  const annonces = useApi(() => listingsAPI.mesAnnonces(), []);
  const stats = annonces.data?.stats;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-white font-bold" style={{ fontSize: "20px" }}>
            Mes biens
          </h1>
          <Link
            to="/owner/listings/nouveau"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#F97316" }}
          >
            <Plus size={16} />
            Publier
          </Link>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Actives", valeur: stats.actives },
              { label: "Certifiées", valeur: stats.certifiees },
              { label: "Candidatures", valeur: stats.candidatures },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-3 text-center"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                <span className="text-white font-bold text-xl block">{s.valeur}</span>
                <span className="text-white/50 text-xs">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-5 space-y-4">
        {annonces.chargement ? (
          <SqueletteCartes nombre={3} />
        ) : annonces.erreur ? (
          <Erreur message={annonces.erreur} onReessayer={annonces.recharger} />
        ) : !annonces.data?.listings.length ? (
          <ListeVide
            titre="Aucune annonce"
            description="Publiez votre premier bien pour recevoir des candidatures de locataires vérifiés."
            action={{ label: "Publier une annonce", to: "/owner/listings/nouveau" }}
          />
        ) : (
          annonces.data.listings.map((listing) => {
            const cert = CERTIFICATION[listing.certification_status];
            return (
              <Link
                key={listing.id}
                to={`/owner/listings/${listing.id}`}
                className="block rounded-2xl overflow-hidden transition-transform active:scale-[0.98]"
                style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
              >
                <div className="flex gap-3 p-3">
                  <div
                    className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0"
                    style={{ background: "#F0F4FA" }}
                  >
                    <img
                      src={listing.images[0] || IMAGE_PAR_DEFAUT}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3
                        className="font-bold flex-1"
                        style={{ color: "#1E293B", fontSize: "14px", lineHeight: 1.35 }}
                      >
                        {listing.title}
                      </h3>
                      <StatutPastille statut={listing.status} />
                    </div>

                    <p className="text-xs text-gray-400 mb-2">
                      {listing.quartier ?? listing.ville} · {labelTypeBien(listing.type_bien)} ·{" "}
                      {formatMontantCourt(listing.prix, listing.devise)}/mois
                    </p>

                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                      <span className="flex items-center gap-1">
                        <Eye size={12} />
                        {listing.views_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {listing.nb_candidatures} candidat{listing.nb_candidatures > 1 ? "s" : ""}
                      </span>
                    </div>

                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: cert.fond, color: cert.couleur }}
                    >
                      <ShieldCheck size={11} />
                      {cert.label}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
