/**
 * BadgeVerification.tsx — Affichage des niveaux de confiance.
 *
 * Les libellés reprennent exactement la grille du Passeport Locataire :
 * Basique → Identifié → Solvable → Recommandé.
 */
import { CheckCircle, Clock, ShieldCheck, Star, UserCheck } from "lucide-react";

export const NIVEAUX = [
  { niveau: 0, label: "Non vérifié", icone: Clock, couleur: "#94A3B8", critere: "Compte créé" },
  { niveau: 1, label: "Basique", icone: CheckCircle, couleur: "#3B82F6", critere: "Numéro vérifié par SMS" },
  { niveau: 2, label: "Identifié", icone: UserCheck, couleur: "#8B5CF6", critere: "Pièce d'identité validée" },
  { niveau: 3, label: "Solvable", icone: ShieldCheck, couleur: "#10B981", critere: "Revenus justifiés" },
  { niveau: 4, label: "Recommandé", icone: Star, couleur: "#F97316", critere: "Avis d'anciens bailleurs" },
] as const;

const TAILLES = {
  sm: { icone: 12, texte: "10px", classes: "px-2 py-0.5 gap-1" },
  md: { icone: 14, texte: "12px", classes: "px-3 py-1 gap-1.5" },
  lg: { icone: 18, texte: "14px", classes: "px-4 py-2 gap-2" },
} as const;

interface BadgeProps {
  level: number;
  size?: keyof typeof TAILLES;
  /** Masque le badge tant qu'aucune vérification n'est acquise. */
  masquerSiZero?: boolean;
}

export function BadgeVerification({ level, size = "md", masquerSiZero = false }: BadgeProps) {
  const niveau = NIVEAUX[Math.min(Math.max(level ?? 0, 0), 4)];
  if (masquerSiZero && niveau.niveau === 0) return null;

  const t = TAILLES[size];
  const Icone = niveau.icone;

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${t.classes}`}
      style={{
        background: `${niveau.couleur}18`,
        color: niveau.couleur,
        fontSize: t.texte,
        border: `1.5px solid ${niveau.couleur}40`,
      }}
    >
      <Icone size={t.icone} />
      {niveau.label}
    </span>
  );
}

/** Badge « Annonce Certifiée » posé sur les visuels d'annonce. */
export function BadgeCertifie({ size = "md" }: { size?: keyof typeof TAILLES }) {
  const t = TAILLES[size];
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold text-white ${t.classes}`}
      style={{ background: "#1E3A5F", fontSize: t.texte }}
    >
      <ShieldCheck size={t.icone} />
      Certifiée
    </span>
  );
}

interface EtapesProps {
  etapes?: {
    niveau: number;
    titre: string;
    fait: boolean;
    en_attente?: boolean;
    detail?: string;
    action: string;
  }[];
  niveauActuel: number;
  onAction?: (action: string) => void;
}

/** Parcours de vérification : ce qui est acquis, en cours, et à venir. */
export function VerificationSteps({ etapes, niveauActuel, onAction }: EtapesProps) {
  const liste: NonNullable<EtapesProps["etapes"]> =
    etapes ??
    NIVEAUX.slice(1).map((n) => ({
      niveau: n.niveau,
      titre: n.critere,
      fait: niveauActuel >= n.niveau,
      action: "",
    }));

  return (
    <div className="space-y-3">
      {liste.map((etape) => {
        const config = NIVEAUX[etape.niveau];
        const suivante = !etape.fait && etape.niveau === niveauActuel + 1;

        return (
          <div key={etape.niveau} className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: etape.fait
                  ? config.couleur
                  : suivante
                    ? `${config.couleur}20`
                    : "#F1F5F9",
                border: suivante ? `2px dashed ${config.couleur}` : "none",
              }}
            >
              {etape.fait ? (
                <CheckCircle size={16} color="#fff" />
              ) : etape.en_attente ? (
                <Clock size={16} style={{ color: "#D97706" }} />
              ) : (
                <span style={{ color: "#CBD5E1", fontSize: "12px", fontWeight: 600 }}>
                  {etape.niveau}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p
                className="font-semibold"
                style={{
                  color: etape.fait ? "#1E293B" : suivante ? "#334155" : "#94A3B8",
                  fontSize: "14px",
                }}
              >
                {etape.titre}
              </p>
              {etape.detail && <p className="text-xs text-gray-400">{etape.detail}</p>}
            </div>

            {etape.fait ? (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "#D1FAE5", color: "#059669" }}
              >
                ✓ Validé
              </span>
            ) : etape.en_attente ? (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "#FEF3C7", color: "#D97706" }}
              >
                En examen
              </span>
            ) : suivante && onAction && etape.action ? (
              <button
                onClick={() => onAction(etape.action)}
                className="text-xs font-semibold px-3 py-1 rounded-full flex-shrink-0"
                style={{ background: "#FFF7ED", color: "#F97316" }}
              >
                Compléter
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface ScoreProps {
  score: number;
  size?: number;
  label?: string;
}

/** Jauge circulaire du score de dossier (0–100). */
export function ScoreCircle({ score, size = 80, label = "/ 100" }: ScoreProps) {
  const rayon = (size - 10) / 2;
  const circonference = 2 * Math.PI * rayon;
  const valeur = Math.max(0, Math.min(score ?? 0, 100));
  const progression = (valeur / 100) * circonference;
  const couleur = valeur >= 80 ? "#10B981" : valeur >= 50 ? "#F59E0B" : "#EF4444";

  return (
    <div
      className="relative flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score de dossier : ${valeur} sur 100`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={rayon} fill="none" stroke="#E2E8F0" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={rayon}
          fill="none"
          stroke={couleur}
          strokeWidth={6}
          strokeDasharray={circonference}
          strokeDashoffset={circonference - progression}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span className="font-bold" style={{ color: couleur, fontSize: size * 0.24 }}>
          {valeur}
        </span>
        {size >= 48 && (
          <span style={{ color: "#94A3B8", fontSize: size * 0.13, marginTop: 2 }}>{label}</span>
        )}
      </div>
    </div>
  );
}

/** Pastille de compatibilité posée sur une carte d'annonce. */
export function ScoreMatch({ score }: { score?: number | null }) {
  if (score === undefined || score === null) return null;
  const couleur = score >= 75 ? "#10B981" : score >= 55 ? "#F97316" : "#64748B";
  return (
    <span
      className="px-3 py-1.5 rounded-full text-white text-xs font-bold"
      style={{ background: couleur }}
    >
      {score}% match
    </span>
  );
}
