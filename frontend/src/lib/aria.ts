/** Identifiants des textes qui décrivent un champ (aide, erreur), pour `aria-describedby`. */
export function decritPar(...ids: (string | false | null | undefined)[]) {
  return ids.filter(Boolean).join(" ") || undefined;
}
