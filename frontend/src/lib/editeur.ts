/**
 * editeur.ts — Identité juridique de l'éditeur de la plateforme.
 *
 * ⚠️ CE FICHIER EST À REMPLIR AVANT TOUTE EXPLOITATION COMMERCIALE.
 *
 * Les trois pages légales (conditions générales, confidentialité, mentions
 * légales) lisent toutes ici. Un champ laissé vide s'affiche en jaune comme
 * « à compléter » sur le site : le trou est visible plutôt que masqué par une
 * valeur plausible, parce qu'une mention légale qui a l'air complète sans
 * l'être expose davantage qu'une mention manifestement incomplète.
 *
 * Remplir une valeur ici la fait apparaître partout où elle est attendue.
 */
export const EDITEUR = {
  /** Raison sociale, ou nom complet si vous exercez en personne physique. */
  denomination: "",

  /** SARL, SA, entreprise individuelle… Laisser vide si non constituée. */
  formeJuridique: "",

  /** Numéro au Registre du Commerce et du Crédit Mobilier. */
  rccm: "",

  /** Numéro d'identification fiscale. */
  nif: "",

  /** Adresse complète du siège. */
  siege: "",

  /** Personne responsable de ce qui est publié sur le site. */
  directeurPublication: "",

  /** Adresse générale de contact. */
  emailContact: "",

  /** Adresse dédiée aux demandes sur les données personnelles. */
  emailDonnees: "",

  /** Adresse pour signaler une annonce frauduleuse ou un contenu illicite. */
  emailSignalement: "",

  /** Téléphone de contact. */
  telephone: "",

  /** Juridiction compétente en cas de litige. */
  juridiction: "Conakry",

  /** Autorité de protection des données personnelles à saisir en recours. */
  autoriteDonnees: "",
} as const;

export type ChampEditeur = keyof typeof EDITEUR;

/** Un champ non renseigné doit rester visiblement absent, jamais deviné. */
export function renseigne(champ: ChampEditeur): boolean {
  return EDITEUR[champ].trim().length > 0;
}
