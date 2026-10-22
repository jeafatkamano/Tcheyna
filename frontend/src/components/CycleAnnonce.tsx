/**
 * CycleAnnonce.tsx — Retirer une annonce et la remettre en ligne (lot 2.2).
 *
 * Le retrait est réversible : l'annonce quitte la recherche, les candidatures
 * déjà reçues restent en l'état. La remise en ligne vaut publication : le
 * serveur exige un téléphone vérifié (D3, 403 « telephone_non_verifie ») et
 * refuse l'annonce d'un bien déjà loué ou vendu (409 « annonce_conclue »).
 * Ces refus ne se devinent pas ici : seul le code renvoyé par le serveur
 * décide de l'étape proposée.
 */
import { EyeOff, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { ApiError, listingsAPI, type Listing } from "../api";
import { MessageErreur, MessageSucces } from "./Etats";
import { PhoneVerification } from "./PhoneVerification";

/** Codes stables des refus de PUT /listings/<id>/reactiver. */
export const CODE_TELEPHONE_NON_VERIFIE = "telephone_non_verifie";
export const CODE_ANNONCE_CONCLUE = "annonce_conclue";

/** Ce que le retrait change, dit avant de le confirmer. */
export const TEXTE_CONFIRMATION_RETRAIT =
  "Votre annonce n'apparaîtra plus dans la recherche et plus personne ne pourra y "
  + "candidater. Les candidatures en cours restent en l'état. Vous pourrez la "
  + "remettre en ligne plus tard.";

/** `details[0].code` du corps d'erreur uniforme du serveur, sinon `null`. */
function codeRefus(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const corps = err.details as { details?: { code?: unknown }[] } | null | undefined;
  const code = Array.isArray(corps?.details) ? corps.details[0]?.code : undefined;
  return typeof code === "string" ? code : null;
}

/** Badge d'une annonce retirée, à la place de la pastille de statut. */
export function BadgeRetiree() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-semibold flex-shrink-0"
      style={{ background: "#F1F5F9", color: "#475569" }}
    >
      <EyeOff size={12} aria-hidden="true" />
      Retirée
    </span>
  );
}

/**
 * Confirmation du retrait, affichée sur place. Ses boutons sont de type
 * « button » : elle peut vivre dans un <form> sans le soumettre.
 */
export function ConfirmationRetrait({
  enCours,
  onConfirmer,
  onAnnuler,
}: {
  enCours: boolean;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  const annulerRef = useRef<HTMLButtonElement>(null);
  // Le panneau remplace le bouton qui l'a ouvert : le focus le suit.
  useEffect(() => {
    annulerRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-label="Confirmer le retrait de l'annonce"
      className="rounded-2xl p-4 space-y-3"
      style={{ background: "#FEF2F2", border: "1.5px solid #FECACA" }}
    >
      <p className="text-sm font-bold" style={{ color: "#991B1B" }}>
        Retirer cette annonce ?
      </p>
      <p className="text-xs leading-relaxed" style={{ color: "#B91C1C" }}>
        {TEXTE_CONFIRMATION_RETRAIT}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          ref={annulerRef}
          type="button"
          onClick={onAnnuler}
          disabled={enCours}
          className="py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
          style={{ background: "white", color: "#334155", border: "1.5px solid #E2E8F0" }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirmer}
          disabled={enCours}
          className="py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "#DC2626" }}
        >
          {enCours ? "Retrait…" : "Confirmer le retrait"}
        </button>
      </div>
    </div>
  );
}

/**
 * Remise en ligne d'une annonce retirée. Une annonce conclue (bien loué ou
 * vendu) n'a pas de bouton : on propose d'en publier une nouvelle.
 *
 * À placer HORS d'un <form> : la vérification du téléphone qu'elle peut
 * ouvrir contient des boutons qui soumettraient le formulaire.
 */
export function RemiseEnLigne({
  listing,
  onRemiseEnLigne,
}: {
  listing: Listing;
  /** Appelé avec le message du serveur ; l'appelant recharge l'annonce. */
  onRemiseEnLigne: (message: string) => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const [refus, setRefus] = useState<{ message: string; code: string | null } | null>(null);
  const [telephoneVerifie, setTelephoneVerifie] = useState(false);

  if (listing.status === "matched") return <AnnonceConclue />;
  if (refus?.code === CODE_ANNONCE_CONCLUE) return <AnnonceConclue message={refus.message} />;

  async function remettreEnLigne() {
    if (enCours) return;
    setEnCours(true);
    setRefus(null);
    setTelephoneVerifie(false);
    try {
      const reponse = await listingsAPI.reactiver(listing.id);
      onRemiseEnLigne(reponse.message);
    } catch (err) {
      setRefus({
        message: err instanceof ApiError ? err.message : "Une erreur est survenue",
        code: codeRefus(err),
      });
    } finally {
      setEnCours(false);
    }
  }

  const refusTelephone = refus?.code === CODE_TELEPHONE_NON_VERIFIE;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={remettreEnLigne}
        disabled={enCours}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "#1E3A5F" }}
      >
        <RotateCcw size={15} aria-hidden="true" />
        {enCours ? "Remise en ligne…" : "Remettre en ligne"}
      </button>

      {telephoneVerifie && (
        <MessageSucces message="Numéro vérifié : vous pouvez remettre l'annonce en ligne." />
      )}

      {refusTelephone ? (
        <div
          className="rounded-2xl p-4 space-y-3"
          style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA" }}
        >
          <p role="alert" className="text-sm font-semibold" style={{ color: "#9A3412" }}>
            {refus.message}
          </p>
          <div className="rounded-xl p-4" style={{ background: "white", border: "1px solid #FED7AA" }}>
            <PhoneVerification
              onVerifie={() => {
                setRefus(null);
                setTelephoneVerifie(true);
              }}
            />
          </div>
        </div>
      ) : (
        <MessageErreur message={refus?.message} />
      )}
    </div>
  );
}

function AnnonceConclue({ message }: { message?: string }) {
  return (
    <div
      role={message ? "alert" : undefined}
      className="rounded-xl px-3.5 py-3 space-y-1.5"
      style={{ background: "#FEF3C7" }}
    >
      <p className="text-xs leading-relaxed" style={{ color: "#92400E" }}>
        {message ?? "Ce bien a été loué ou vendu : son annonce ne peut pas être remise en ligne."}
      </p>
      <Link
        to="/owner/listings/nouveau"
        className="inline-block text-xs font-semibold underline"
        style={{ color: "#9A3412" }}
      >
        Publier une nouvelle annonce
      </Link>
    </div>
  );
}

/**
 * État de la re-soumission d'une certification refusée, tel que le serveur
 * le calcule (D4). Rien n'est affiché sans ce champ (serveur antérieur au
 * lot 2.2), ni hors refus : aucune règle n'est déduite ici.
 */
export function EtatResoumission({ listing }: { listing: Listing }) {
  const etat = listing.certification_resoumission;
  if (listing.certification_status !== "rejected" || !etat) return null;
  const gratuite = etat.resoumission_gratuite && !etat.paiement_requis;
  if (!gratuite && !etat.paiement_requis) return null;

  return (
    <span
      className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full"
      style={
        gratuite
          ? { background: "#D1FAE5", color: "#065F46" }
          : { background: "#FFEDD5", color: "#9A3412" }
      }
    >
      {gratuite ? "Re-soumission gratuite" : "Paiement requis (tarif de la certification)"}
    </span>
  );
}
