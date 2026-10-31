/**
 * statutsCandidature.ts — Libellés et couleurs des statuts de candidature,
 * partagés par la liste des candidatures et celle des discussions (lot 3.15b).
 */
import type { MatchStatus } from "../api";

export const STATUTS_CANDIDATURE: Record<MatchStatus, { label: string; couleur: string; fond: string }> = {
  pending: { label: "En attente", couleur: "#C2410C", fond: "#FFF7ED" },
  accepted: { label: "Acceptée", couleur: "#047857", fond: "#DCFCE7" },
  rejected: { label: "Non retenue", couleur: "#B91C1C", fond: "#FEE2E2" },
  completed: { label: "Location conclue", couleur: "#3730A3", fond: "#E0E7FF" },
  cancelled: { label: "Retirée", couleur: "#475569", fond: "#F1F5F9" },
};
