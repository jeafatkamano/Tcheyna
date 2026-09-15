/**
 * format.ts — Formatage des montants et des dates.
 *
 * Les loyers guinéens se comptent en millions de GNF : « 2 800 000 GNF » est
 * illisible sur une carte mobile, d'où les formes courtes « 2,8 M GNF ».
 */

const SYMBOLES: Record<string, string> = {
  GNF: "GNF",
  XOF: "FCFA",
  GHS: "GH₵",
  NGN: "₦",
};

/** Montant complet, séparateurs par espace insécable : « 2 800 000 GNF ». */
export function formatMontant(montant?: number | null, devise = "GNF"): string {
  if (montant === null || montant === undefined) return "—";
  const symbole = SYMBOLES[devise] ?? devise;
  return `${montant.toLocaleString("fr-FR").replace(/ |\s/g, " ")} ${symbole}`;
}

/** Forme compacte pour les cartes et les listes : « 2,8 M GNF ». */
export function formatMontantCourt(montant?: number | null, devise = "GNF"): string {
  if (montant === null || montant === undefined) return "—";
  const symbole = SYMBOLES[devise] ?? devise;
  if (montant >= 1_000_000) {
    const millions = montant / 1_000_000;
    const texte = millions >= 10 ? Math.round(millions).toString() : millions.toFixed(1).replace(".0", "").replace(".", ",");
    return `${texte} M ${symbole}`;
  }
  if (montant >= 10_000) {
    return `${Math.round(montant / 1000)} k ${symbole}`;
  }
  return formatMontant(montant, devise);
}

/** « 15 septembre 2026 » */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** « 15/09 à 14:30 » */
export function formatDateHeure(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} à ${d.toLocaleTimeString(
    "fr-FR",
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

/** « à l'instant », « il y a 5 min », « hier », « 12 août ». */
export function formatRelatif(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;

  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;

  const jours = Math.floor(heures / 24);
  if (jours === 1) return "hier";
  if (jours < 7) return `il y a ${jours} jours`;

  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Initiales pour les avatars de repli : « Aminata Diallo » → « AD ». */
export function initiales(nom?: string | null): string {
  if (!nom) return "?";
  return nom
    .trim()
    .split(/\s+/)
    .map((mot) => mot[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const TYPES_BIEN: Record<string, string> = {
  studio: "Studio",
  chambre: "Chambre",
  appartement: "Appartement",
  maison: "Maison",
  villa: "Villa",
  hangar: "Hangar",
  terrain: "Terrain",
};

export function labelTypeBien(type?: string | null): string {
  if (!type) return "Bien";
  return TYPES_BIEN[type] ?? type;
}

/** Types qui ne se décrivent ni en pièces, ni en étage, ni en ameublement. */
export const TYPES_SANS_PIECES = ["terrain", "hangar"];

export function sansPieces(type?: string | null): boolean {
  return TYPES_SANS_PIECES.includes(type ?? "");
}

/**
 * Un loyer se lit « par mois », un prix de vente non. Oublier le suffixe fait
 * passer une maison à 850 M pour un loyer mensuel.
 */
export function suffixePrix(estVente?: boolean): string {
  return estVente ? "" : "/mois";
}

export function labelTransaction(estVente?: boolean): string {
  return estVente ? "À vendre" : "À louer";
}
