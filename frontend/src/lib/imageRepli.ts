/**
 * imageRepli.ts — Photo affichée quand une annonce n'en a pas, ou quand la
 * sienne ne se charge pas (components/PhotoAnnonce.tsx).
 *
 * Image locale, embarquée dans le site et l'APK : 7 Ko (256 px) ou 20 Ko
 * (512 px) en WebP, au lieu d'une photo Unsplash de 1080 px chargée depuis un
 * serveur étranger. Le navigateur choisit la taille via `srcset`.
 */
// `?no-inline` : sous 4 Ko, Vite inclurait l'image en base64 dans le JS.
import repli256 from "../assets/hero/appartement-256.webp?no-inline";
import repli512 from "../assets/hero/appartement-512.webp?no-inline";

/** Dimensions intrinsèques de l'image de repli (ratio 8:5). */
export const LARGEUR_REPLI = 512;
export const HAUTEUR_REPLI = 320;

export const IMAGE_REPLI = {
  src: repli512,
  srcSet: `${repli256} 256w, ${repli512} 512w`,
};

/** Largeur affichée d'une carte d'annonce : une colonne, marges de 16 px. */
export const TAILLES_CARTE = "calc(100vw - 32px)";

/**
 * Attributs `src`/`srcSet`/`sizes` d'une photo d'annonce. Une vraie photo
 * n'existe qu'en une taille (pas de variantes côté stockage) : seul le repli
 * propose plusieurs largeurs.
 */
export function attributsPhoto(url: string | undefined, tailles: string) {
  if (url) return { src: url };
  return { src: IMAGE_REPLI.src, srcSet: IMAGE_REPLI.srcSet, sizes: tailles };
}
