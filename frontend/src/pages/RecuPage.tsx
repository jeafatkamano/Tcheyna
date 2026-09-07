/**
 * RecuPage.tsx — Reçu numérique d'un paiement.
 *
 * La traçabilité promise dans le business plan : les deux parties d'une mise en
 * relation peuvent consulter le même reçu.
 */
import { ArrowLeft, CheckCircle, Clock, RefreshCw, XCircle } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { paiementsAPI, type Payment } from "../api";
import { Chargement, Erreur, MessageErreur } from "../components/Etats";
import { useAction, useApi } from "../hooks/useApi";
import { formatDateHeure, formatMontant } from "../lib/format";

const STATUTS: Record<
  Payment["statut"],
  { label: string; couleur: string; fond: string; icone: typeof CheckCircle }
> = {
  pending: { label: "Paiement en attente", couleur: "#D97706", fond: "#FEF3C7", icone: Clock },
  success: { label: "Paiement confirmé", couleur: "#059669", fond: "#ECFDF5", icone: CheckCircle },
  failed: { label: "Paiement échoué", couleur: "#DC2626", fond: "#FEE2E2", icone: XCircle },
};

const METHODES: Record<string, string> = {
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  wave: "Wave",
  moov: "Moov Money",
  carte: "Carte bancaire",
};

export function RecuPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const recu = useApi(() => paiementsAPI.recu(id!), [id], { actif: Boolean(id) });
  const verification = useAction(paiementsAPI.verifier);

  if (recu.chargement) return <Chargement texte="Chargement du reçu…" />;

  if (recu.erreur || !recu.data) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
        <div className="px-4 pt-6">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2" style={{ color: "#1E3A5F" }}>
            <ArrowLeft size={20} />
          </button>
        </div>
        <Erreur message={recu.erreur ?? "Reçu introuvable"} onReessayer={recu.recharger} />
      </div>
    );
  }

  const paiement = recu.data;
  const statut = STATUTS[paiement.statut];
  const Icone = statut.icone;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center gap-3">
          <Link to="/paiements" className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-white font-bold" style={{ fontSize: "19px" }}>
            Reçu de paiement
          </h1>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-5 max-w-lg mx-auto">
        {/* Statut */}
        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: statut.fond, border: `1.5px solid ${statut.couleur}30` }}
        >
          <Icone size={34} style={{ color: statut.couleur, flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="font-bold" style={{ color: statut.couleur }}>
              {statut.label}
            </p>
            {paiement.paid_at && (
              <p className="text-xs mt-0.5" style={{ color: statut.couleur, opacity: 0.85 }}>
                Le {formatDateHeure(paiement.paid_at)}
              </p>
            )}
          </div>
        </div>

        {/* Détail */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <div className="text-center pb-5 border-b border-dashed border-gray-200">
            <p className="text-xs text-gray-400 mb-1">Montant</p>
            <p className="font-bold" style={{ color: "#1E3A5F", fontSize: "30px" }}>
              {formatMontant(paiement.montant, paiement.devise)}
            </p>
            <p className="text-sm text-gray-500 mt-1">{paiement.type_label}</p>
          </div>

          <div className="pt-5 space-y-3">
            <Ligne label="Référence" valeur={paiement.reference} monospace />
            {paiement.description && <Ligne label="Objet" valeur={paiement.description} />}
            {paiement.methode && (
              <Ligne label="Moyen de paiement" valeur={METHODES[paiement.methode] ?? paiement.methode} />
            )}
            {paiement.payeur && <Ligne label="Payeur" valeur={paiement.payeur.full_name} />}
            <Ligne label="Émis le" valeur={formatDateHeure(paiement.created_at)} />
            {paiement.commission > 0 && (
              <Ligne
                label="Dont commission Tcheyna"
                valeur={formatMontant(paiement.commission, paiement.devise)}
              />
            )}
          </div>

          {paiement.listing && (
            <Link
              to={`/listing/${paiement.listing.id}`}
              className="mt-5 flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "#F8FAFC" }}
            >
              <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ background: "#E2E8F0" }}>
                {paiement.listing.images[0] && (
                  <img src={paiement.listing.images[0]} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: "#1E293B" }}>
                  {paiement.listing.title}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {paiement.listing.quartier ?? paiement.listing.ville}
                </p>
              </div>
            </Link>
          )}
        </div>

        {/* Vérification manuelle si le paiement traîne */}
        {paiement.statut === "pending" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 text-center leading-relaxed">
              Si vous venez de régler par Mobile Money, la confirmation peut prendre quelques minutes.
            </p>
            <MessageErreur message={verification.erreur} />
            <button
              onClick={async () => {
                const ok = await verification.executer(paiement.id);
                if (ok) void recu.recharger();
              }}
              disabled={verification.enCours}
              className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#1E3A5F" }}
            >
              <RefreshCw size={17} />
              {verification.enCours ? "Vérification…" : "Vérifier le paiement"}
            </button>
          </div>
        )}

        <p className="text-xs text-center text-gray-400 leading-relaxed px-4">
          Ce reçu est conservé par Tcheyna et consultable par les deux parties de la transaction.
        </p>
      </div>
    </div>
  );
}

function Ligne({
  label,
  valeur,
  monospace,
}: {
  label: string;
  valeur: string;
  monospace?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
      <span
        className="text-sm font-semibold text-right"
        style={{
          color: "#1E293B",
          fontFamily: monospace ? "ui-monospace, monospace" : undefined,
        }}
      >
        {valeur}
      </span>
    </div>
  );
}
