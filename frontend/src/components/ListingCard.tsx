/**
 * ListingCard.tsx — Carte d'annonce, réutilisée partout (recherche,
 * recommandations, favoris, tableau de bord).
 *
 * D'après les maquettes Annonces (carte pleine) et Accueil (`compacte`, pour
 * le défilement horizontal de « Pour vous »), lot 3.15a : photo avec le badge
 * Certifiée, le favori en bouton rond blanc et la compatibilité ; titre,
 * quartier, pièces et surface ; prix à droite. Ce que la maquette ne dessine
 * pas garde sa place : mise en avant, « À vendre », propriétaire vérifié,
 * statut, charges.
 */
import { Heart, Zap } from "lucide-react";
import { Link } from "react-router";

import { urlFichier, type Listing } from "../api";
import { formatMontantCourt, labelTransaction, labelTypeBien } from "../lib/format";
import { HAUTEUR_REPLI, LARGEUR_REPLI, TAILLES_CARTE } from "../lib/imageRepli";
import { transitionPage } from "../lib/transitions";
import { BadgeCertifie, BadgeProprietaireVerifie } from "./BadgeVerification";
import { PastilleCompatibilite } from "./Pastille";
import { PhotoAnnonce } from "./PhotoAnnonce";

interface Props {
  listing: Listing;
  /** Bascule le favori. Le bouton n'apparaît que si ce gestionnaire est fourni. */
  onToggleFavori?: (listing: Listing) => void;
  /** Lien de destination — le propriétaire ouvre la gestion, pas la fiche publique. */
  to?: string;
  /** Carte étroite (220 px) du défilement horizontal de l'accueil. */
  compacte?: boolean;
}

/** « Kipé, Ratoma · 3 pièces · 85 m² » : ce qui est connu, dans cet ordre. */
function resume(listing: Listing, avecSurface: boolean) {
  const lieu = listing.quartier ?? listing.ville;
  const pieces =
    listing.nb_pieces != null
      ? `${listing.nb_pieces} ${listing.nb_pieces > 1 ? "pièces" : "pièce"}`
      : labelTypeBien(listing.type_bien);
  const surface = avecSurface && listing.superficie != null ? `${listing.superficie} m²` : null;
  return [lieu, pieces, surface].filter(Boolean).join(" · ");
}

export function ListingCard({ listing, onToggleFavori, to, compacte = false }: Props) {
  // urlFichier : en développement sans Supabase, les photos sont des chemins
  // relatifs (/uploads/…) servis par l'API, pas par le serveur du frontend.
  const photo = urlFichier(listing.images?.[0]);
  const destination = to ?? `/listing/${listing.id}`;
  const hauteurPhoto = compacte ? 112 : 168;

  return (
    <div
      className={`relative overflow-hidden bg-white ${compacte ? "w-[220px] shrink-0 snap-start" : ""}`}
      style={{ borderRadius: compacte ? 20 : 22, boxShadow: "0 6px 18px rgba(15,32,64,0.08)" }}
    >
      <Link
        to={destination}
        viewTransition={transitionPage()}
        className="block no-underline"
        style={{ color: "#1E293B" }}
      >
        <div className="relative" style={{ height: hauteurPhoto }}>
          {/* width/height : réservent la place (ratio 8:5) avant le chargement. */}
          <PhotoAnnonce
            url={photo}
            tailles={compacte ? "220px" : TAILLES_CARTE}
            alt={listing.title}
            width={LARGEUR_REPLI}
            height={HAUTEUR_REPLI}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />

          <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
            {listing.is_certified && <BadgeCertifie size="sm" />}
            {listing.is_premium && (
              <span
                className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1"
                style={{ background: "#FEF3C7", color: "#92400E" }}
              >
                <Zap size={11} aria-hidden="true" />
                En avant
              </span>
            )}
          </div>

          {/* Compatibilité en bas à gauche ; en version compacte, en haut à droite. */}
          <div
            className={`absolute flex flex-col gap-1.5 items-start ${compacte ? "top-2.5 right-2.5" : "bottom-3 left-3"}`}
          >
            <PastilleCompatibilite score={listing.score_compatibilite} court={compacte} />
            {/* Un prix de vente et un loyer se ressemblent trop pour qu'on
                laisse deviner lequel on regarde. */}
            {listing.est_vente && (
              <span
                className="px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ background: "#1D4ED8", color: "white" }}
              >
                {labelTransaction(true)}
              </span>
            )}
          </div>
        </div>

        {compacte ? (
          <div style={{ padding: "12px 14px" }}>
            <h3 className="m-0 font-bold truncate" style={{ fontSize: 14 }}>
              {listing.title}
            </h3>
            <p className="m-0 mt-0.5 truncate" style={{ fontSize: 12, color: "#475569" }}>
              {resume(listing, false)}
            </p>
            <p className="m-0 mt-2 font-extrabold" style={{ fontSize: 15, color: "#1E3A5F" }}>
              {formatMontantCourt(listing.prix, listing.devise)}{" "}
              {!listing.est_vente && (
                <span className="font-medium" style={{ fontSize: 12, color: "#475569" }}>
                  /mois
                </span>
              )}
            </p>
          </div>
        ) : (
          <div className="flex justify-between gap-3" style={{ padding: "14px 16px" }}>
            <div className="min-w-0">
              <h3 className="m-0 font-bold" style={{ fontSize: 16, lineHeight: 1.35 }}>
                {listing.title}
              </h3>
              <p className="m-0 mt-[3px]" style={{ fontSize: 13, color: "#475569" }}>
                {resume(listing, true)}
              </p>
              {listing.equipements.generateur && (
                <p className="m-0 mt-1.5 flex items-center gap-1" style={{ fontSize: 12, color: "#475569" }}>
                  <Zap size={12} style={{ color: "#B45309" }} aria-hidden="true" />
                  Groupe électrogène
                </p>
              )}
              {listing.landlord?.proprietaire_verifie && (
                <div className="mt-2">
                  <BadgeProprietaireVerifie utilisateur={listing.landlord} />
                </div>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
              <div>
                <div className="font-extrabold" style={{ fontSize: 16, color: "#1E3A5F" }}>
                  {formatMontantCourt(listing.prix, listing.devise)}
                </div>
                {!listing.est_vente && (
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    /mois
                    {listing.charges > 0 && ` + ${formatMontantCourt(listing.charges, listing.devise)} charges`}
                  </div>
                )}
              </div>
              <StatutPastille statut={listing.status} />
            </div>
          </div>
        )}
      </Link>

      {onToggleFavori && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavori(listing);
          }}
          className="absolute w-11 h-11 rounded-full bg-white flex items-center justify-center shadow-sm"
          style={compacte ? { top: hauteurPhoto - 50, right: 6 } : { top: 6, right: 6 }}
          aria-label={listing.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          aria-pressed={Boolean(listing.is_favorite)}
        >
          <Heart
            size={20}
            fill={listing.is_favorite ? "#F97316" : "none"}
            stroke={listing.is_favorite ? "#F97316" : "#1E3A5F"}
            aria-hidden="true"
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
    closed: { label: "Retiré", bg: "#F1F5F9", couleur: "#475569" },
  }[statut] ?? { label: statut, bg: "#F1F5F9", couleur: "#475569" };

  return (
    <span
      className="text-xs px-3 py-1.5 rounded-full font-semibold flex-shrink-0"
      style={{ background: config.bg, color: config.couleur }}
    >
      {config.label}
    </span>
  );
}
