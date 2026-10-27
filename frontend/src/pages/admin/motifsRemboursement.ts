/** Libellé de chaque motif de remboursement renvoyé par `GET /admin/paiements-a-rembourser`. */
import type { MotifRemboursement } from "../../api";

export const MOTIFS_REMBOURSEMENT: Record<MotifRemboursement, string> = {
  hors_plateforme: "Caution ou loyer : ne passe pas par Tcheyna",
  doublon: "Service déjà réglé : paiement en double",
  candidature_close: "Frais de mise en relation : candidature retirée ou refusée pendant le paiement",
  ecartee_par_le_bailleur: "Frais de mise en relation : candidature écartée par le propriétaire après paiement",
};
