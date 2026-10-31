/**
 * StatutCandidature.tsx — Statut d'une candidature, partagé par la liste des
 * candidatures du locataire et la liste des discussions (lot 3.15b).
 *
 * Libellés de TenantMatches ; couleurs de la maquette Messages (« En
 * attente », « Acceptée », « Location conclue »), toutes au-dessus de 4,5:1.
 */
import type { MatchStatus } from "../api";
import { STATUTS_CANDIDATURE } from "../lib/statutsCandidature";

export function PastilleStatut({ statut }: { statut: MatchStatus }) {
  const s = STATUTS_CANDIDATURE[statut];
  if (!s) return null;
  return (
    <span
      className="inline-block rounded-full font-bold whitespace-nowrap"
      style={{ padding: "2px 8px", background: s.fond, color: s.couleur, fontSize: 11 }}
    >
      {s.label}
    </span>
  );
}
