import {
  ArrowRight,
  CheckCircle,
  Home,
  ShieldCheck,
  Smartphone,
  Star,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "../context/AuthContext";

const ETAPES = [
  {
    numero: "01",
    icone: ShieldCheck,
    titre: "Vérification des deux côtés",
    description:
      "Le locataire construit son Passeport vérifié, le propriétaire fait certifier son annonce. La confiance est établie avant la première visite.",
    couleur: "#1E3A5F",
  },
  {
    numero: "02",
    icone: Zap,
    titre: "Mise en relation ciblée",
    description:
      "Budget, quartier, type de bien, niveau de confiance : seuls les profils réellement compatibles se rencontrent.",
    couleur: "#F97316",
  },
  {
    numero: "03",
    icone: Smartphone,
    titre: "Visite, accord et paiement tracé",
    description:
      "Messagerie intégrée, puis caution et premier loyer réglés par Mobile Money, avec reçu numérique pour les deux parties.",
    couleur: "#10B981",
  },
];

const NIVEAUX = [
  { niveau: "1", titre: "Basique", critere: "Numéro vérifié par SMS" },
  { niveau: "2", titre: "Identifié", critere: "Pièce d'identité validée" },
  { niveau: "3", titre: "Solvable", critere: "Revenus justifiés" },
  { niveau: "4", titre: "Recommandé", critere: "Avis d'anciens bailleurs" },
];

const GARANTIES = [
  "Annonces certifiées sur pièces de propriété",
  "Passeport Locataire vérifié à quatre niveaux",
  "Paiement Mobile Money tracé, avec reçu",
  "Avis croisés après chaque location",
];

export function Landing() {
  const { user, accueilDuRole } = useAuth();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0F2040" }}>
      {/* ─── Hero ──────────────────────────────────────────── */}
      <div
        className="relative min-h-screen flex flex-col"
        style={{ background: "linear-gradient(160deg, #0F2040 0%, #1E3A5F 60%, #0F2040 100%)" }}
      >
        <div
          className="absolute top-[-80px] right-[-80px] w-64 h-64 rounded-full opacity-10 pointer-events-none"
          style={{ background: "#F97316" }}
        />
        <div
          className="absolute bottom-[20%] left-[-60px] w-48 h-48 rounded-full opacity-10 pointer-events-none"
          style={{ background: "#F97316" }}
        />

        <header className="relative z-10 flex items-center justify-between px-6 pt-10 pb-4">
          <span
            className="text-white font-bold tracking-tight"
            style={{ fontSize: "26px", letterSpacing: "-0.5px" }}
          >
            tcheyna
          </span>
          {user ? (
            <Link
              to={accueilDuRole()}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: "rgba(249,115,22,0.2)", color: "#F97316" }}
            >
              Mon espace
            </Link>
          ) : (
            <Link
              to="/login"
              className="text-white/70 hover:text-white font-medium text-sm transition-colors"
            >
              Se connecter
            </Link>
          )}
        </header>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center py-16">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8"
            style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)" }}
          >
            <Zap size={14} style={{ color: "#F97316" }} />
            <span className="text-sm font-semibold" style={{ color: "#F97316" }}>
              La location en confiance à Conakry
            </span>
          </div>

          <h1
            className="text-white mb-6"
            style={{ fontSize: "clamp(32px, 8vw, 52px)", fontWeight: 800, lineHeight: 1.15 }}
          >
            Pas une meilleure <span style={{ color: "#F97316" }}>annonce</span>.
            <br />
            Une meilleure <span style={{ color: "#F97316" }}>mise en relation</span>.
          </h1>

          <p className="text-white/60 mb-12 max-w-sm" style={{ fontSize: "17px", lineHeight: 1.7 }}>
            Tcheyna vérifie les deux côtés de la location : les locataires et les annonces. Fini les
            faux propriétaires et les dossiers invérifiables.
          </p>

          <div className="flex flex-col gap-4 w-full max-w-xs">
            <Link
              to="/onboarding/tenant"
              className="flex items-center justify-center gap-3 py-4 px-6 rounded-2xl font-semibold text-white transition-transform active:scale-95"
              style={{ background: "#F97316", fontSize: "16px" }}
            >
              <Users size={20} />
              Je cherche un logement
              <ArrowRight size={18} />
            </Link>
            <Link
              to="/onboarding/owner"
              className="flex items-center justify-center gap-3 py-4 px-6 rounded-2xl font-semibold transition-transform active:scale-95"
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "white",
                border: "1.5px solid rgba(255,255,255,0.2)",
                fontSize: "16px",
              }}
            >
              <Home size={20} />
              Je mets en location
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>

        {/* Repères du marché — chiffres du recensement RGPH-4 2025 */}
        <div
          className="relative z-10 mx-4 mb-8 rounded-2xl px-6 py-5 grid grid-cols-3 gap-4"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {[
            { valeur: "3,4 M", label: "Habitants à Conakry" },
            { valeur: "89 %", label: "Pénétration mobile" },
            { valeur: "2 faces", label: "Vérifiées, pas une" },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center text-center">
              <span className="text-white font-bold text-xl">{stat.valeur}</span>
              <span className="text-white/50 text-xs mt-0.5 leading-tight">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Comment ça marche ─────────────────────────────── */}
      <section className="px-6 py-16" style={{ background: "#F0F4FA" }}>
        <h2 className="text-center mb-3" style={{ color: "#1E3A5F", fontWeight: 800, fontSize: "26px" }}>
          Comment ça marche ?
        </h2>
        <p className="text-center text-gray-500 mb-10 text-sm max-w-sm mx-auto">
          Un système de confiance progressive, des deux côtés du marché.
        </p>

        <div className="space-y-5 max-w-md mx-auto">
          {ETAPES.map((etape) => (
            <div
              key={etape.numero}
              className="flex gap-4 p-5 rounded-2xl"
              style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${etape.couleur}12` }}
              >
                <etape.icone size={22} style={{ color: etape.couleur }} />
              </div>
              <div>
                <p className="text-xs font-bold mb-1" style={{ color: etape.couleur }}>
                  ÉTAPE {etape.numero}
                </p>
                <h3 className="font-bold mb-1" style={{ color: "#1E293B", fontSize: "15px", lineHeight: 1.4 }}>
                  {etape.titre}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">{etape.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Les quatre niveaux du Passeport ───────────────── */}
      <section className="px-6 py-14" style={{ background: "white" }}>
        <h2 className="text-center mb-2" style={{ color: "#1E3A5F", fontWeight: 800, fontSize: "24px" }}>
          Le Passeport Locataire
        </h2>
        <p className="text-center text-gray-500 mb-8 text-sm max-w-sm mx-auto">
          Plus votre profil est vérifié, plus les propriétaires vous font confiance — et plus vous
          êtes prioritaire.
        </p>

        <div className="max-w-md mx-auto space-y-2.5">
          {NIVEAUX.map((n, i) => (
            <div
              key={n.niveau}
              className="flex items-center gap-4 p-4 rounded-2xl"
              style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white"
                style={{
                  background: ["#3B82F6", "#8B5CF6", "#10B981", "#F97316"][i],
                  fontSize: "14px",
                }}
              >
                {n.niveau}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm" style={{ color: "#1E293B" }}>
                  {n.titre}
                </p>
                <p className="text-xs text-gray-500">{n.critere}</p>
              </div>
              {i === 3 && <Star size={16} style={{ color: "#F97316", flexShrink: 0 }} />}
            </div>
          ))}
        </div>
      </section>

      {/* ─── Garanties ─────────────────────────────────────── */}
      <section className="px-6 py-12" style={{ background: "#1E3A5F" }}>
        <h2 className="text-white text-center mb-8" style={{ fontWeight: 800, fontSize: "22px" }}>
          La confiance, au cœur du produit
        </h2>
        <div className="space-y-3 max-w-md mx-auto">
          {GARANTIES.map((garantie) => (
            <div key={garantie} className="flex items-center gap-3">
              <CheckCircle size={18} style={{ color: "#F97316", flexShrink: 0 }} />
              <span className="text-white/80 text-sm">{garantie}</span>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            to="/inscription"
            className="inline-flex items-center gap-2 py-4 px-8 rounded-2xl font-semibold text-white transition-transform active:scale-95"
            style={{ background: "#F97316", fontSize: "16px" }}
          >
            Commencer gratuitement
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <footer className="px-6 py-8 text-center border-t border-white/10" style={{ background: "#0F2040" }}>
        <span className="text-white font-bold text-xl tracking-tight">tcheyna</span>
        <p className="text-white/40 text-xs mt-2">Conakry, République de Guinée</p>
        <p className="text-white/30 text-xs mt-1">
          © {new Date().getFullYear()} Tcheyna — La location immobilière, en toute confiance
        </p>
      </footer>
    </div>
  );
}
