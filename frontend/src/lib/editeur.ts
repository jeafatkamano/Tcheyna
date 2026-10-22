/**
 * editeur.ts — Identité juridique de l'éditeur de la plateforme.
 *
 * ⚠️ CE FICHIER EST À REMPLIR AVANT TOUTE EXPLOITATION COMMERCIALE.
 *
 * L'éditeur est Kamino (décision D11). « Kamino » est le nom sous lequel
 * l'éditeur se présente ; la dénomination sociale exacte, celle qui figure au
 * RCCM, peut être différente : elle a donc son propre champ, laissé vide comme
 * toutes les valeurs que seul l'éditeur peut fournir.
 *
 * Les trois pages légales (conditions générales, confidentialité, mentions
 * légales) lisent toutes ici. Un champ laissé vide s'affiche en jaune comme
 * « à compléter » sur le site : le trou est visible plutôt que masqué par une
 * valeur plausible, parce qu'une mention légale qui a l'air complète sans
 * l'être expose davantage qu'une mention manifestement incomplète.
 *
 * Remplir une valeur ici la fait apparaître partout où elle est attendue.
 * Jamais de valeur d'exemple : toute chaîne non vide est publiée telle quelle.
 */
export interface IdentiteEditeur {
  /** Nom sous lequel l'éditeur se présente au public. */
  nomCommercial: string;

  /** Raison sociale exacte, telle qu'immatriculée, ou nom complet si personne physique. */
  denomination: string;

  /** SARL, SA, entreprise individuelle… */
  formeJuridique: string;

  /** Numéro au Registre du Commerce et du Crédit Mobilier. */
  rccm: string;

  /** Numéro d'identification fiscale. */
  nif: string;

  /** Adresse complète du siège. */
  siege: string;

  /** Personne responsable de ce qui est publié sur le site. */
  directeurPublication: string;

  /** Adresse générale de contact. */
  emailContact: string;

  /** Adresse dédiée aux demandes sur les données personnelles. */
  emailDonnees: string;

  /** Adresse pour signaler une annonce frauduleuse ou un contenu illicite. */
  emailSignalement: string;

  /** Téléphone de contact. */
  telephone: string;

  /** Juridiction compétente en cas de litige. */
  juridiction: string;

  /** Autorité de protection des données personnelles à saisir en recours. */
  autoriteDonnees: string;
}

export const EDITEUR: Readonly<IdentiteEditeur> = {
  nomCommercial: "Kamino",
  denomination: "",
  formeJuridique: "",
  rccm: "",
  nif: "",
  siege: "",
  directeurPublication: "",
  emailContact: "",
  emailDonnees: "",
  emailSignalement: "",
  telephone: "",
  juridiction: "Conakry",
  autoriteDonnees: "",
};

export type ChampEditeur = keyof IdentiteEditeur;

/** Un champ non renseigné doit rester visiblement absent, jamais deviné. */
export function renseigne(champ: ChampEditeur): boolean {
  return EDITEUR[champ].trim().length > 0;
}

/**
 * Champs encore vides. Tant que la liste n'est pas vide, les pages légales ne
 * sont pas définitives : `editeur.test.ts` l'affiche à chaque exécution.
 */
export function champsACompleter(): ChampEditeur[] {
  return (Object.keys(EDITEUR) as ChampEditeur[]).filter((c) => !renseigne(c));
}
