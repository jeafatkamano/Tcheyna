/**
 * ListingCard.tsx — Carte d'annonce, réutilisée partout (recherche,
 * recommandations, favoris, tableau de bord).
 */
import { Bed, Heart, MapPin, Square, Zap } from "lucide-react";
import { Link } from "react-router";

import type { Listing } from "../api";
import { formatMontantCourt, labelTransaction, labelTypeBien } from "../lib/format";
import { BadgeCertifie, ScoreMatch } from "./BadgeVerification";

const IMAGE_PAR_DEFAUT =
  "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080&q=80";

interface Props {
  listing: Listing;
  /** Bascule le favori. Le bouton n'apparaît que si ce gestionnaire est fourni. */
  onToggleFavori?: (listing: Listing) => void;
  /** Lien de destination — le propriétaire ouvre la gestion, pas la fiche publique. */
  to?: string;
}

export function ListingCard({ listing, onToggleFavori, to }: Props) {
  const photo = listing.images?.[0] || IMAGE_PAR_DEFAUT;
  const destination = to ?? `/listing/${listing.id}`;

  return (
    <div
      className="relative rounded-2xl overflow-hidden transition-transform active:scale-[0.98]"
      style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
    >
      <Link to={destination} className="block">
        <div className="relative h-44">
          <img
            src={photo}
            alt={listing.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = IMAGE_PAR_DEFAUT;
            }}
          />

          <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
            {listing.is_certified && <BadgeCertifie size="sm" />}
            {listing.is_premium && (
              <span
                className="px-2.5 py-1 rounded-full text-xs font-semibold text-white flex items-center gap-1"
                style={{ background: "#F59E0B" }}
              >
                <Zap size={11} />
                En avant
              </span>
            )}
          </div>

          <div className="absolute top-3 right-3">
            <ScoreMatch score={listing.score_compatibilite} />
          </div>

          {/* Un prix de vente et un loyer se ressemblent trop pour qu'on
              laisse deviner lequel on regarde. */}
          {listing.est_vente && (
            <span
              className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold"
              style={{ background: "#1D4ED8", color: "white" }}
            >
              {labelTransaction(true)}
            </span>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3
              className="font-bold flex-1"
              style={{ color: "#1E293B", fontSize: "15px", lineHeight: 1.35 }}
            >
              {listing.title}
            </h3>
          </div>

          <div className="flex items-center gap-1 text-gray-500 text-xs mb-3">
            <MapPin size={12} />
            {listing.quartier ?? listing.ville} · {labelTypeBien(listing.type_bien)}
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
            {listing.superficie != null && (
              <span className="flex items-center gap-1">
                <Square size={12} />
                {listing.superficie} m²
              </span>
            )}
            {listing.nb_pieces != null && (
              <span className="flex items-center gap-1">
                <Bed size={12} />
                {listing.nb_pieces} {listing.nb_pieces > 1 ? "pièces" : "pièce"}
              </span>
            )}
            {listing.equipements.generateur && (
              <span className="flex items-center gap-1" title="Groupe électrogène">
                <Zap size={12} style={{ color: "#F59E0B" }} />
                Groupe
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-lg" style={{ color: "#1E3A5F" }}>
                {formatMontantCourt(listing.prix, listing.devise)}
              </span>
              {!listing.est_vente && <span className="text-gray-400 text-xs"> /mois</span>}
              {!listing.est_vente && listing.charges > 0 && (
                <span className="text-gray-400 text-xs">
                  {" "}
                  + {formatMontantCourt(listing.charges, listing.devise)} charges
                </span>
              )}
            </div>
            <StatutPastille statut={listing.status} />
          </div>
        </div>
      </Link>

      {onToggleFavori && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavori(listing);
          }}
          className="absolute p-2 rounded-xl backdrop-blur-sm transition-transform active:scale-90"
          style={{ background: "rgba(0,0,0,0.35)", top: "10.5rem", right: "0.75rem" }}
          aria-label={listing.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        >
          <Heart
            size={17}
            fill={listing.is_favorite ? "#F97316" : "none"}
            stroke={listing.is_favorite ? "#F97316" : "white"}
          />
        </button>
      )}
    </div>
  );
}

export function StatutPastille({ statut }: { statut: Listing["status"] }) {
  const config = {
    active: { label: "Disponible", bg: "#DCFCE7", couleur: "#15803D" },
    matched: { label: "Loué", bg: "#FEF3C7", couleur: "#92400E" },
    closed: { label: "Retiré", bg: "#F1F5F9", couleur: "#64748B" },
  }[statut] ?? { label: statut, bg: "#F1F5F9", couleur: "#64748B" };

  return (
    <span
      className="text-xs px-3 py-1.5 rounded-full font-semibold flex-shrink-0"
      style={{ background: config.bg, color: config.couleur }}
    >
      {config.label}
    </span>
  );
}
