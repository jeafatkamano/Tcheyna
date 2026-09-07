/**
 * PaiementsPage.tsx — Historique des paiements et grille tarifaire.
 *
 * Le paiement lui-même est initié depuis la mise en relation concernée ; cette
 * page sert de journal et de point d'accès aux reçus.
 */
import { ChevronRight, Receipt, Wallet } from "lucide-react";
import { Link } from "react-router";

import { paiementsAPI, type Payment } from "../api";
import { Erreur, ListeVide, SqueletteCartes } from "../components/Etats";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../hooks/useApi";
import { formatDate, formatMontant, formatMontantCourt } from "../lib/format";

const STATUTS: Record<Payment["statut"], { label: string; couleur: string; fond: string }> = {
  pending: { label: "En attente", couleur: "#D97706", fond: "#FEF3C7" },
  success: { label: "Payé", couleur: "#059669", fond: "#D1FAE5" },
  failed: { label: "Échoué", couleur: "#DC2626", fond: "#FEE2E2" },
};

export function PaiementsPage() {
  const { user } = useAuth();
  const paiements = useApi(() => paiementsAPI.mesPaiements(), []);
  const tarifs = useApi(() => paiementsAPI.tarifs(), []);

  const estLocataire = user?.role === "tenant";
  const servicesPertinents = (tarifs.data?.services ?? []).filter((s) =>
    estLocataire ? s.payeur === "Locataire" : s.payeur === "Propriétaire",
  );

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-6" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
          Mes paiements
        </h1>
        <p className="text-white/60 text-sm">Historique et reçus numériques</p>

        {paiements.data && paiements.data.total > 0 && (
          <div className="mt-5 rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(249,115,22,0.2)" }}
              >
                <Wallet size={21} style={{ color: "#F97316" }} />
              </div>
              <div>
                <p className="text-white/60 text-xs">Total réglé via Tcheyna</p>
                <p className="text-white font-bold text-xl">
                  {formatMontant(paiements.data.total_paye, paiements.data.devise)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-5 space-y-5">
        {/* Historique */}
        <div>
          <h2 className="font-bold mb-3" style={{ color: "#1E293B", fontSize: "17px" }}>
            Historique
          </h2>

          {paiements.chargement ? (
            <SqueletteCartes nombre={2} />
          ) : paiements.erreur ? (
            <Erreur message={paiements.erreur} onReessayer={paiements.recharger} />
          ) : !paiements.data?.paiements.length ? (
            <ListeVide
              titre="Aucun paiement"
              description="Vos cautions, loyers et services Tcheyna réglés par Mobile Money apparaîtront ici avec leur reçu."
              icone={<Receipt size={26} style={{ color: "#94A3B8" }} />}
            />
          ) : (
            <div className="space-y-3">
              {paiements.data.paiements.map((paiement) => {
                const statut = STATUTS[paiement.statut];
                return (
                  <Link
                    key={paiement.id}
                    to={`/paiements/${paiement.id}`}
                    className="flex items-center gap-3 p-4 rounded-2xl transition-transform active:scale-[0.98]"
                    style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "#F0F4FA" }}
                    >
                      <Receipt size={19} style={{ color: "#1E3A5F" }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                          {paiement.type_label}
                        </span>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: statut.fond, color: statut.couleur }}
                        >
                          {statut.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {paiement.reference} · {formatDate(paiement.created_at)}
                      </p>
                      <p className="font-bold text-sm mt-1" style={{ color: "#1E3A5F" }}>
                        {formatMontant(paiement.montant, paiement.devise)}
                      </p>
                    </div>

                    <ChevronRight size={18} style={{ color: "#CBD5E1", flexShrink: 0 }} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Grille tarifaire */}
        {servicesPertinents.length > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-1" style={{ color: "#1E293B" }}>
              Services Tcheyna
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Payables par Mobile Money — Orange Money, MTN MoMo.
            </p>

            <div className="space-y-3">
              {servicesPertinents.map((service) => (
                <div key={service.type} className="p-3.5 rounded-xl" style={{ background: "#F8FAFC" }}>
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <span className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                      {service.libelle}
                    </span>
                    <span className="font-bold text-sm flex-shrink-0" style={{ color: "#F97316" }}>
                      {formatMontantCourt(service.montant, tarifs.data?.devise)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{service.description}</p>
                </div>
              ))}
            </div>

            {!estLocataire && tarifs.data?.commission && (
              <div
                className="mt-3 p-3.5 rounded-xl"
                style={{ background: "#FFF7ED", border: "1px solid #FED7AA" }}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <span className="font-semibold text-sm" style={{ color: "#9A3412" }}>
                    {tarifs.data.commission.libelle}
                  </span>
                  <span className="font-bold text-sm flex-shrink-0" style={{ color: "#EA580C" }}>
                    {Math.round(tarifs.data.commission.taux * 100)} %
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#C2410C" }}>
                  {tarifs.data.commission.description}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
