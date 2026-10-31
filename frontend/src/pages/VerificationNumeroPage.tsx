/**
 * VerificationNumeroPage.tsx — « Vérifiez votre numéro », juste après
 * l'inscription (maquette CodeSMS, lot 3.14).
 *
 * Le code part dès l'arrivée sur l'écran, au numéro saisi à l'inscription.
 * Envoi, renvoi et compte à rebours : ceux de PhoneVerification
 * (useVerificationTelephone). « Plus tard » et la réussite mènent à la suite
 * (`state.suite`, l'onboarding du rôle), qui saute sa propre étape du numéro
 * quand il est vérifié. Sans numéro à vérifier : la suite directement.
 */
import { BadgeCheck, Clock, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { MessageErreur } from "../components/Etats";
import {
  BoutonPrincipal,
  EcranSombre,
  IconeEcran,
  TEXTE_SECONDAIRE,
  TitreEcran,
} from "../components/FormulaireSombre";
import { SaisieCode } from "../components/SaisieCode";
import { useAuth } from "../context/AuthContext";
import { useVerificationTelephone } from "../hooks/useVerificationTelephone";
import { formaterTelephone } from "../lib/format";

export function VerificationNumeroPage() {
  const { user } = useAuth();
  const location = useLocation();
  const suiteDemandee = (location.state as { suite?: string } | null)?.suite;
  const suite =
    suiteDemandee ?? (user?.role === "tenant" ? "/onboarding/tenant" : "/onboarding/owner");

  if (!user?.phone || user.phone_verified) return <Navigate to={suite} replace />;
  return <Verification telephone={user.phone} locataire={user.role === "tenant"} suite={suite} />;
}

function Verification({ telephone, locataire, suite }: { telephone: string; locataire: boolean; suite: string }) {
  const navigate = useNavigate();
  const sms = useVerificationTelephone();
  const { envoi, verification, codeDebug, compteARebours } = sms;
  const [code, setCode] = useState("");

  // Un seul envoi automatique, même si l'effet est rejoué (StrictMode).
  const envoye = useRef(false);
  useEffect(() => {
    if (envoye.current) return;
    envoye.current = true;
    void sms.envoyer(telephone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function valider(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    const niveau = await sms.verifier(code);
    if (niveau !== null) navigate(suite, { replace: true });
  }

  const erreur = verification.erreur ?? envoi.erreur;

  return (
    <EcranSombre>
      <form onSubmit={valider} className="flex-1 flex flex-col" noValidate>
        <div className="h-11" />
        <div className="mt-6">
          <IconeEcran icone={Smartphone} />
        </div>
        <div className="mt-6">
          <TitreEcran
            taille={30}
            sousTitre={
              <>
                Un code à 6 chiffres {envoi.enCours ? "est en cours d'envoi" : "a été envoyé"} au{" "}
                <strong className="text-white whitespace-nowrap">{formaterTelephone(telephone)}</strong>.
              </>
            }
          >
            Vérifiez votre numéro
          </TitreEcran>
        </div>

        {codeDebug && (
          <p className="mt-3 mb-0" style={{ fontSize: 13, color: "#FDBA74" }}>
            Mode développement — code : <strong>{codeDebug}</strong>
          </p>
        )}

        <div className="mt-8">
          <SaisieCode
            valeur={code}
            onChange={setCode}
            invalide={Boolean(verification.erreur)}
            disabled={verification.enCours}
          />
        </div>

        <div className="mt-[18px] min-h-11 flex items-center gap-2" style={{ fontSize: 14, color: TEXTE_SECONDAIRE }}>
          <Clock size={18} aria-hidden="true" />
          {compteARebours > 0 ? (
            <span>Renvoyer le code dans {compteARebours} s</span>
          ) : (
            <button
              type="button"
              onClick={() => void sms.envoyer(telephone)}
              disabled={envoi.enCours}
              className="min-h-11 font-semibold text-white underline underline-offset-2 disabled:opacity-60"
            >
              Renvoyer le code
            </button>
          )}
        </div>

        {erreur && (
          <div className="mt-3">
            <MessageErreur message={erreur} />
          </div>
        )}

        {locataire && (
          <div
            className="mt-7 flex items-center gap-3 rounded-2xl"
            style={{
              padding: "14px 16px",
              background: "rgba(37,99,235,0.18)",
              border: "1px solid rgba(147,197,253,0.35)",
            }}
          >
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#2563EB" }}
            >
              <BadgeCheck size={18} color="#ffffff" aria-hidden="true" />
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: "rgba(255,255,255,0.9)" }}>
              Ce code vous fait passer au niveau <strong className="text-white">Basique</strong> du Passeport.
            </span>
          </div>
        )}

        <div className="flex-1 min-h-8" />

        <div className="flex flex-col gap-3.5">
          <BoutonPrincipal disabled={verification.enCours || code.length !== 6}>
            {verification.enCours ? "Vérification…" : "Valider"}
          </BoutonPrincipal>
          <button
            type="button"
            onClick={() => navigate(suite, { replace: true })}
            className="h-11 font-semibold"
            style={{ fontSize: 14, color: TEXTE_SECONDAIRE }}
          >
            Plus tard
          </button>
        </div>
      </form>
    </EcranSombre>
  );
}
