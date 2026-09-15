/**
 * ModalePaiement.tsx — Déclenchement d'un paiement Mobile Money.
 *
 * Le montant n'est jamais décidé ici : il est affiché à titre indicatif, mais
 * c'est le serveur qui le calcule et l'impose. Un client qui enverrait un
 * autre montant serait ignoré.
 *
 * Sans passerelle configurée, le paiement est enregistré « en attente » au
 * lieu d'échouer — le parcours reste parcourable de bout en bout.
 */
import { CheckCircle, ExternalLink, Smartphone, X } from "lucide-react";
import { useState } from "react";

import { paiementsAPI, type TypePaiement } from "../api";
import { useAction } from "../hooks/useApi";
import { formatMontant } from "../lib/format";
import { MessageErreur } from "./Etats";

/** Opérateurs réellement utilisés à Conakry, dans l'ordre de leur part de marché. */
const METHODES = [
  { valeur: "orange_money", label: "Orange Money", couleur: "#FF6600" },
  { valeur: "mtn_momo", label: "MTN MoMo", couleur: "#FFCC00" },
  { valeur: "wave", label: "Wave", couleur: "#1DC3F0" },
  { valeur: "moov", label: "Moov Money", couleur: "#0066B3" },
] as const;

interface Props {
  type: TypePaiement;
  titre: string;
  /** Ce que le paiement débloque, dit simplement. */
  description: string;
  montant: number;
  devise?: string;
  matchId?: string;
  listingId?: string;
  onFerme: () => void;
  onPaye?: () => void;
}

export function ModalePaiement({
  type,
  titre,
  description,
  montant,
  devise = "GNF",
  matchId,
  listingId,
  onFerme,
  onPaye,
}: Props) {
  const [methode, setMethode] = useState<string>("orange_money");
  const [enAttente, setEnAttente] = useState<string | null>(null);

  const paiement = useAction(paiementsAPI.initier);

  async function payer() {
    const reponse = await paiement.executer({
      type_paiement: type,
      match_id: matchId,
      listing_id: listingId,
      methode,
    });
    if (!reponse) return;

    if (reponse.payment_url) {
      // La saisie du code Mobile Money se fait chez l'opérateur, jamais ici.
      window.location.href = reponse.payment_url;
      return;
    }

    // Passerelle non configurée : le paiement existe, il reste à confirmer.
    setEnAttente(reponse.paiement.reference);
    onPaye?.();
  }

  if (enAttente) {
    return (
      <Coquille onFerme={onFerme}>
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle size={44} style={{ color: "#F59E0B" }} />
          <h3 className="font-bold text-lg" style={{ color: "#1E293B" }}>
            Paiement enregistré
          </h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            Référence <strong>{enAttente}</strong>. Le règlement Mobile Money n'est
            pas encore activé sur la plateforme : votre demande reste au statut
            « en attente » et sera confirmée dès l'activation.
          </p>
          <button
            onClick={onFerme}
            className="w-full mt-2 py-3.5 rounded-2xl font-semibold text-white"
            style={{ background: "#1E3A5F" }}
          >
            Compris
          </button>
        </div>
      </Coquille>
    );
  }

  return (
    <Coquille onFerme={onFerme}>
      <h3 className="font-bold text-lg mb-1" style={{ color: "#1E3A5F" }}>
        {titre}
      </h3>
      <p className="text-sm text-gray-500 mb-5 leading-relaxed">{description}</p>

      <div
        className="rounded-2xl p-4 mb-5 text-center"
        style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA" }}
      >
        <p className="text-xs mb-1" style={{ color: "#9A3412" }}>
          Montant à régler
        </p>
        <p className="font-bold" style={{ color: "#7C2D12", fontSize: "26px" }}>
          {formatMontant(montant, devise)}
        </p>
      </div>

      <p className="text-sm font-semibold mb-2.5" style={{ color: "#334155" }}>
        Moyen de paiement
      </p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {METHODES.map((m) => {
          const actif = methode === m.valeur;
          return (
            <button
              key={m.valeur}
              type="button"
              onClick={() => setMethode(m.valeur)}
              className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold transition-colors"
              style={{
                background: actif ? "#FFF7ED" : "#F8FAFC",
                border: `1.5px solid ${actif ? "#F97316" : "#E2E8F0"}`,
                color: actif ? "#9A3412" : "#64748B",
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: m.couleur }}
              />
              {m.label}
            </button>
          );
        })}
      </div>

      <MessageErreur message={paiement.erreur} />

      <button
        onClick={payer}
        disabled={paiement.enCours}
        className="w-full mt-3 py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
        style={{ background: "#F97316", fontSize: "16px" }}
      >
        {paiement.enCours ? (
          "Ouverture du paiement…"
        ) : (
          <>
            <Smartphone size={18} />
            Payer {formatMontant(montant, devise)}
            <ExternalLink size={15} />
          </>
        )}
      </button>

      <p className="text-xs text-center text-gray-400 mt-3 leading-relaxed">
        Vous serez redirigé vers votre opérateur pour valider. Un reçu numérique
        sera disponible pour vous et pour l'autre partie.
      </p>
    </Coquille>
  );
}

function Coquille({ children, onFerme }: { children: React.ReactNode; onFerme: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onFerme} />
      <div
        className="relative w-full rounded-t-3xl p-6"
        style={{ background: "white", maxHeight: "90vh", overflowY: "auto" }}
      >
        <button
          onClick={onFerme}
          className="absolute top-4 right-4 p-1.5 rounded-lg"
          style={{ color: "#94A3B8" }}
          aria-label="Fermer"
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Bouton standard ouvrant un paiement, pour uniformiser les appels. */
export function BoutonPaiement({
  label,
  montant,
  devise = "GNF",
  onClick,
  variante = "principal",
}: {
  label: string;
  montant?: number;
  devise?: string;
  onClick: () => void;
  variante?: "principal" | "secondaire";
}) {
  const principal = variante === "principal";
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
      style={{
        background: principal ? "#F97316" : "#FFF7ED",
        color: principal ? "white" : "#9A3412",
      }}
    >
      <Smartphone size={15} />
      {label}
      {montant != null && ` · ${formatMontant(montant, devise)}`}
    </button>
  );
}
