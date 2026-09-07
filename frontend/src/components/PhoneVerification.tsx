/**
 * PhoneVerification.tsx — Vérification du numéro par code SMS.
 *
 * C'est le premier palier du Passeport Locataire (niveau 1 « Basique ») : sans
 * lui, impossible de candidater.
 */
import { CheckCircle, Phone } from "lucide-react";
import { useEffect, useState } from "react";

import { authAPI } from "../api";
import { useAuth } from "../context/AuthContext";
import { useAction } from "../hooks/useApi";
import { MessageErreur } from "./Etats";

interface Props {
  onVerifie?: (trustLevel: number) => void;
}

export function PhoneVerification({ onVerifie }: Props) {
  const { user, rafraichir } = useAuth();
  const [etape, setEtape] = useState<"numero" | "code">("numero");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [code, setCode] = useState("");
  const [codeDebug, setCodeDebug] = useState<string | null>(null);
  const [succes, setSucces] = useState(user?.phone_verified ?? false);
  const [compteARebours, setCompteARebours] = useState(0);

  const envoi = useAction(authAPI.envoyerOTP);
  const verification = useAction(authAPI.verifierOTP);

  // Le backend impose 60 s entre deux envois : on l'affiche plutôt que de
  // laisser l'utilisateur découvrir l'erreur.
  useEffect(() => {
    if (compteARebours <= 0) return;
    const timer = setTimeout(() => setCompteARebours((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [compteARebours]);

  async function envoyer() {
    const reponse = await envoi.executer(phone.trim() || undefined);
    if (!reponse) return;
    setCodeDebug(reponse.debug_code ?? null);
    setCompteARebours(60);
    setEtape("code");
  }

  async function verifier() {
    const reponse = await verification.executer(code.trim());
    if (!reponse) return;
    setSucces(true);
    await rafraichir();
    onVerifie?.(reponse.trust_level);
  }

  if (succes) {
    return (
      <div
        className="flex flex-col items-center text-center p-6 rounded-2xl gap-2"
        style={{ background: "#ECFDF5", border: "1.5px solid #A7F3D0" }}
      >
        <CheckCircle size={40} style={{ color: "#059669" }} />
        <h3 className="font-bold" style={{ color: "#065F46" }}>
          Téléphone vérifié
        </h3>
        <p className="text-sm" style={{ color: "#047857" }}>
          Vous pouvez désormais candidater aux annonces et échanger par messagerie.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "#EFF6FF" }}
        >
          <Phone size={19} style={{ color: "#1E3A5F" }} />
        </div>
        <div>
          <h3 className="font-bold" style={{ color: "#1E293B" }}>
            Vérification du téléphone
          </h3>
          <p className="text-xs text-gray-500">Niveau 1 — Basique</p>
        </div>
      </div>

      {etape === "numero" ? (
        <>
          <div>
            <label
              htmlFor="phone-otp"
              className="block text-sm font-semibold mb-1.5"
              style={{ color: "#334155" }}
            >
              Numéro de téléphone
            </label>
            <input
              id="phone-otp"
              type="tel"
              inputMode="tel"
              placeholder="622 52 92 52"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={envoi.enCours}
              className="w-full px-4 py-3 rounded-xl outline-none transition-colors"
              style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Indicatif +224 ajouté automatiquement pour la Guinée.
            </p>
          </div>

          <button
            onClick={envoyer}
            disabled={envoi.enCours || !phone.trim()}
            className="w-full py-3.5 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
            style={{ background: "#1E3A5F" }}
          >
            {envoi.enCours ? "Envoi en cours…" : "Recevoir le code par SMS"}
          </button>
          <MessageErreur message={envoi.erreur} />
        </>
      ) : (
        <>
          <div className="px-3.5 py-3 rounded-xl" style={{ background: "#EFF6FF" }}>
            <p className="text-sm" style={{ color: "#1E3A5F" }}>
              Un code à 6 chiffres a été envoyé au <strong>{phone}</strong>.
            </p>
            {codeDebug && (
              <p className="text-xs mt-1.5" style={{ color: "#1D4ED8" }}>
                Mode développement — code : <strong>{codeDebug}</strong>
              </p>
            )}
          </div>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={verification.enCours}
            maxLength={6}
            aria-label="Code de vérification"
            className="w-full px-4 py-3.5 rounded-xl outline-none text-center font-bold"
            style={{
              background: "white",
              border: "1.5px solid #E2E8F0",
              fontSize: "26px",
              letterSpacing: "0.5em",
              textIndent: "0.5em",
            }}
          />

          <button
            onClick={verifier}
            disabled={verification.enCours || code.length !== 6}
            className="w-full py-3.5 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
            style={{ background: "#F97316" }}
          >
            {verification.enCours ? "Vérification…" : "Valider le code"}
          </button>

          <button
            onClick={envoyer}
            disabled={envoi.enCours || compteARebours > 0}
            className="w-full py-2 text-sm font-medium disabled:opacity-50"
            style={{ color: "#64748B" }}
          >
            {compteARebours > 0 ? `Renvoyer le code dans ${compteARebours} s` : "Renvoyer le code"}
          </button>

          <button
            onClick={() => {
              setEtape("numero");
              setCode("");
            }}
            className="w-full text-sm underline"
            style={{ color: "#94A3B8" }}
          >
            Modifier le numéro
          </button>

          <MessageErreur message={verification.erreur ?? envoi.erreur} />
        </>
      )}
    </div>
  );
}
