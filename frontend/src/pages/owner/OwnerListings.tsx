import { Eye, Plus, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { listingsAPI, urlFichier, type Listing } from "../../api";
import { BadgeRetiree, EtatResoumission, RemiseEnLigne } from "../../components/CycleAnnonce";
import { EnTetePage } from "../../components/EnTetePage";
import { Erreur, ListeVide, MessageSucces, SqueletteCartes } from "../../components/Etats";
import { StatutPastille } from "../../components/ListingCard";
import { ModalePaiement } from "../../components/ModalePaiement";
import { useApi } from "../../hooks/useApi";
import { formatMontantCourt, labelTransaction, labelTypeBien } from "../../lib/format";
import { PhotoAnnonce } from "../../components/PhotoAnnonce";

/** Tarif de la mise en avant, aligné sur la grille du serveur. */
const PRIX_MISE_EN_AVANT = 200_000;

/** Vignette carrée de 96 px (w-24). */
const TAILLES_VIGNETTE = "96px";

const CERTIFICATION = {
  none: { label: "Non certifiée", couleur: "#64748B", fond: "#F1F5F9" },
  pending: { label: "Certification en examen", couleur: "#D97706", fond: "#FEF3C7" },
  certified: { label: "Certifiée", couleur: "#059669", fond: "#D1FAE5" },
  rejected: { label: "Certification refusée", couleur: "#DC2626", fond: "#FEE2E2" },
};

export function OwnerListings() {
  // Les annonces retirées figurent dans la liste pour pouvoir être remises
  // en ligne (lot 2.2) ; les statistiques ne comptent que celles en ligne.
  const annonces = useApi(() => listingsAPI.mesAnnonces({ inclure_retirees: true }), []);
  const [miseEnAvant, setMiseEnAvant] = useState<Listing | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const stats = annonces.data?.stats;

  return (
    <div className="pb-8">
      {/* En-tête partagé (lot 3.15a) */}
      <EnTetePage
        titre="Mes biens"
        droite={
          <Link
            to="/owner/listings/nouveau"
            className="h-11 flex items-center gap-1.5 px-4 rounded-[14px] text-sm font-bold text-white"
            style={{ background: "#F97316" }}
          >
            <Plus size={16} aria-hidden="true" />
            Publier
          </Link>
        }
      >
        {stats && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Actives", valeur: stats.actives },
              { label: "Certifiées", valeur: stats.certifiees },
              { label: "Candidatures", valeur: stats.candidatures },
            ].map((s) => (
              <div
                key={s.label}
                className="p-3 text-center"
                style={{ background: "rgba(255,255,255,0.08)", borderRadius: 18 }}
              >
                <span className="text-white font-bold text-xl block">{s.valeur}</span>
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.78)" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </EnTetePage>

      <div className="px-5 pt-5 space-y-4">
        <MessageSucces message={succes} />

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
              <div
                key={listing.id}
                className="rounded-2xl overflow-hidden"
                style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
              >
              <Link
                to={`/owner/listings/${listing.id}`}
                className="block transition-transform active:scale-[0.98]"
              >
                <div className="flex gap-3 p-3">
                  <div
                    className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0"
                    style={{ background: "#F0F4FA" }}
                  >
                    <PhotoAnnonce
                      url={urlFichier(listing.images[0])}
                      tailles={TAILLES_VIGNETTE}
                      alt=""
                      width={96}
                      height={96}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
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
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {listing.est_vente && (
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "#DBEAFE", color: "#1D4ED8" }}
                          >
                            {labelTransaction(true)}
                          </span>
                        )}
                        {listing.retiree ? (
                          <BadgeRetiree />
                        ) : (
                          <StatutPastille statut={listing.status} />
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-gray-400 mb-2">
                      {listing.quartier ?? listing.ville} · {labelTypeBien(listing.type_bien)} ·{" "}
                      {formatMontantCourt(listing.prix, listing.devise)}
                      {!listing.est_vente && "/mois"}
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

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: cert.fond, color: cert.couleur }}
                      >
                        <ShieldCheck size={11} />
                        {cert.label}
                      </span>
                      <EtatResoumission listing={listing} />
                    </div>
                  </div>
                </div>
              </Link>

              {listing.retiree && (
                <div className="px-3 pb-3">
                  <RemiseEnLigne
                    listing={listing}
                    onRemiseEnLigne={(message) => {
                      setSucces(message);
                      void annonces.recharger();
                    }}
                  />
                </div>
              )}

              {/* La mise en avant n'a de sens que sur une annonce encore à louer. */}
              {listing.status === "active" && !listing.retiree && (
                <div className="px-3 pb-3">
                  {listing.is_premium ? (
                    <div
                      className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold"
                      style={{ background: "#FEF3C7", color: "#92400E" }}
                    >
                      <Sparkles size={13} />
                      Mise en avant active
                    </div>
                  ) : (
                    <button
                      onClick={() => setMiseEnAvant(listing)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold"
                      style={{ background: "#FFF7ED", color: "#9A3412" }}
                    >
                      <Sparkles size={13} />
                      Mettre en avant 30 jours ·{" "}
                      {formatMontantCourt(PRIX_MISE_EN_AVANT, listing.devise)}
                    </button>
                  )}
                </div>
              )}
              </div>
            );
          })
        )}
      </div>

      {miseEnAvant && (
        <ModalePaiement
          type="mise_en_avant"
          titre="Mettre l'annonce en avant"
          description="Votre bien remonte en tête des résultats de recherche pendant 30 jours, devant les annonces non mises en avant de même pertinence."
          montant={PRIX_MISE_EN_AVANT}
          devise={miseEnAvant.devise}
          listingId={miseEnAvant.id}
          onFerme={() => setMiseEnAvant(null)}
          onPaye={() => void annonces.recharger()}
        />
      )}
    </div>
  );
}
