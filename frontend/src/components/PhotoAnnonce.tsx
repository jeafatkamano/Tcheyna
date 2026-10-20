/**
 * PhotoAnnonce.tsx — Photo d'une annonce, avec repli local si elle manque ou
 * ne se charge pas (lib/imageRepli.ts).
 *
 * L'échec est un état React lié à l'URL : si l'annonce reçoit ensuite une
 * autre photo, celle-ci s'affiche normalement (aucun attribut posé à la main
 * sur le nœud ne la masque).
 */
import { useState, type ImgHTMLAttributes } from "react";

import { attributsPhoto } from "../lib/imageRepli";

interface Props
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes" | "onError"> {
  /** URL absolue de la photo (après urlFichier), ou undefined si l'annonce n'en a pas. */
  url: string | undefined;
  /** Largeur affichée, pour choisir la taille du repli (`sizes`). */
  tailles: string;
}

export function PhotoAnnonce({ url, tailles, ...autres }: Props) {
  const [urlEnEchec, setUrlEnEchec] = useState<string>();
  const photo = attributsPhoto(url === urlEnEchec ? undefined : url, tailles);
  // Un échec du repli lui-même ne relance rien : url vaut alors déjà urlEnEchec.
  return <img {...autres} {...photo} onError={() => setUrlEnEchec(url)} />;
}
