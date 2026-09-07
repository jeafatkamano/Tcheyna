/**
 * OnboardingOwner.tsx — Parcours propriétaire : vérifier son numéro, puis
 * publier sa première annonce.
 */
import { ArrowLeft, ArrowRight, Check, Home, ShieldCheck, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { PhoneVerification } from "../components/PhoneVerification";
import { useAuth } from "../context/AuthContext";
import { RegisterPage } from "./RegisterPage";

const ETAPES = [
  { id: 1, label: "Compte", icone: UserIcon },
  { id: 2, label: "Téléphone", icone: ShieldCheck },
  { id: 3, label: "Annonce", icone: Home },
];

export function OnboardingOwner() {
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!user) return <RegisterPage roleImpose="landlord" onInscrit={() => undefined} />;

  return <ParcoursProprietaire onTermine={() => navigate("/owner/dashboard")} />;
}

function ParcoursProprietaire({ onTermine }: { onTermine: () => void }) {
  const { user } = useAuth();
  const [etape, setEtape] = useState(user?.phone_verified ? 3 : 2);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
      <div className="px-4 pt-6 pb-6" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => (etape > 2 ? setEtape(etape - 1) : onTermine())}
            className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="text-white font-bold tracking-tight" style={{ fontSize: "18px" }}>
            Espace propriétaire
          </span>
          <button onClick={onTermine} className="text-white/50 text-sm font-medium">
            Plus tard
          </button>
        </div>

        <div className="flex items-center justify-between max-w-xs mx-auto">
          {ETAPES.map((e, index) => {
            const fait = e.id < etape;
            const courante = e.id === etape;
            return (
              <div key={e.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{
                      background: fait ? "#10B981" : courante ? "#F97316" : "rgba(255,255,255,0.12)",
                      color: fait || courante ? "white" : "rgba(255,255,255,0.5)",
                    }}
                  >
                    {fait ? <Check size={16} /> : <e.icone size={16} />}
                  </div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: courante ? "#F97316" : "rgba(255,255,255,0.5)" }}
                  >
                    {e.label}
                  </span>
                </div>
                {index < ETAPES.length - 1 && (
                  <div
                    className="flex-1 h-0.5 mx-1 mb-5"
                    style={{ background: fait ? "#10B981" : "rgba(255,255,255,0.12)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 px-4 py-6">
        <div className="max-w-sm mx-auto space-y-5">
          {etape === 2 && (
            <>
              <div
                className="rounded-2xl p-5"
                style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
              >
                <PhoneVerification onVerifie={() => setEtape(3)} />
              </div>
              <p className="text-center text-xs text-gray-400 leading-relaxed">
                Un numéro vérifié rassure les locataires et vous permet de recevoir les candidatures.
              </p>
            </>
          )}

          {etape === 3 && (
            <>
              <div className="text-center">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{ background: "#FFF7ED" }}
                >
                  <Home size={30} style={{ color: "#F97316" }} />
                </div>
                <h2 className="font-bold mb-2" style={{ color: "#1E293B", fontSize: "20px" }}>
                  Publiez votre premier bien
                </h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Décrivez votre bien, ajoutez des photos, et demandez la certification pour afficher
                  le badge « Annonce Certifiée ».
                </p>
              </div>

              <div
                className="rounded-2xl p-5 space-y-3"
                style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
              >
                <h3 className="font-bold text-sm" style={{ color: "#1E293B" }}>
                  Ce que la certification vous apporte
                </h3>
                {[
                  "Badge visible dès le premier contact",
                  "Positionnement prioritaire dans les résultats",
                  "Accès aux locataires vérifiés niveau 2 et plus",
                  "Moins de visites inutiles, plus de dossiers sérieux",
                ].map((avantage) => (
                  <div key={avantage} className="flex items-start gap-2.5">
                    <Check size={16} style={{ color: "#10B981", flexShrink: 0, marginTop: 2 }} />
                    <span className="text-sm text-gray-600">{avantage}</span>
                  </div>
                ))}
              </div>

              <Link
                to="/owner/listings/nouveau"
                className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                style={{ background: "#F97316", fontSize: "16px" }}
              >
                Publier une annonce
                <ArrowRight size={18} />
              </Link>

              <button
                onClick={onTermine}
                className="w-full text-center text-sm font-medium py-2"
                style={{ color: "#64748B" }}
              >
                Aller au tableau de bord
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
