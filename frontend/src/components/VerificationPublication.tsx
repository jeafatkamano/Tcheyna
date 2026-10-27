/**
 * VerificationPublication.tsx — Téléphone à vérifier avant de publier (D3).
 *
 * Le serveur refuse la publication d'une annonce (403, code
 * « telephone_non_verifie ») tant que le numéro du bailleur ou de l'agence
 * n'est pas vérifié par code SMS. Ce bandeau le dit avant la saisie, ou relaie
 * le refus, et ouvre la vérification sur place : la page n'est pas quittée,
 * le brouillon du formulaire reste intact.
 *
 * À placer HORS d'un <form> : les boutons et la touche Entrée de
 * PhoneVerification soumettraient sinon le formulaire qui l'entoure.
 */
import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";

import { PhoneVerification } from "./PhoneVerification";

/** Code stable du refus renvoyé par POST /api/listings. */
export const CODE_TELEPHONE_NON_VERIFIE = "telephone_non_verifie";

export const MESSAGE_VERIFIER_POUR_PUBLIER = "Vérifiez votre numéro pour publier une annonce.";

interface Props {
  /** Message du serveur après un refus ; sinon, l'avertissement par défaut. */
  message?: string | null;
  /**
   * « alert » pour relayer un refus du serveur (annoncé aussitôt), « status »
   * pour l'avertissement affiché avant la saisie.
   */
  role?: "status" | "alert";
  /**
   * Appelé une fois le numéro vérifié et l'utilisateur rafraîchi. Le bandeau
   * quitte alors la page : l'appelant y déplace le focus (bouton « Publier »).
   */
  onVerifie?: () => void;
}

export function BandeauTelephoneAVerifier({ message, role = "status", onVerifie }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA" }}
    >
      {/* Seul le texte est une région annoncée : pas le formulaire de code. */}
      <div role={role} className="flex items-start gap-3">
        <ShieldAlert
          size={20}
          aria-hidden="true"
          style={{ color: "#EA580C", flexShrink: 0, marginTop: 1 }}
        />
        <p className="text-sm font-semibold" style={{ color: "#9A3412" }}>
          {message || MESSAGE_VERIFIER_POUR_PUBLIER}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        aria-controls={ouvert ? idPanneau : undefined}
        className="w-full py-3 rounded-xl font-semibold text-white transition-transform active:scale-[0.98]"
        style={{ background: "#1E3A5F" }}
      >
        {ouvert ? "Masquer la vérification" : "Vérifier mon numéro"}
      </button>

      {ouvert && (
        <div
          id={idPanneau}
          className="rounded-xl p-4"
          style={{ background: "white", border: "1px solid #FED7AA" }}
        >
          <PhoneVerification onVerifie={() => onVerifie?.()} />
        </div>
      )}
    </div>
  );
}
