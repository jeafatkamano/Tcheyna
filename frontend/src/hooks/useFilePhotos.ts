/**
 * useFilePhotos.ts — Branche la file d'envoi des photos sur React.
 *
 * La file vit dans le composant qui porte le formulaire (et non dans la
 * grille de photos) : celui-ci peut ainsi attendre la fin des envois avant de
 * quitter la page, et afficher le récapitulatif.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { listingsAPI } from "../api";
import { FilePhotos, resumer } from "../lib/filePhotos";
import { originalEnvoyable, preparerPhoto } from "../lib/image";

export function useFilePhotos(onImages: (images: string[]) => void) {
  const [file] = useState(
    () =>
      new FilePhotos({
        compresser: preparerPhoto,
        originalEnvoyable,
        envoyer: (listingId, fichier, options) =>
          listingsAPI.televerserPhoto(listingId, fichier, options),
        creerApercu: (blob) => URL.createObjectURL(blob),
        revoquerApercu: (url) => URL.revokeObjectURL(url),
      }),
  );
  const etat = useSyncExternalStore(file.subscribe, file.getSnapshot);

  // Toujours le dernier rappel, sans recréer la file.
  useEffect(() => {
    file.definirRappel(onImages);
  });

  // Au démontage : envoi en cours interrompu, aperçus libérés.
  useEffect(() => {
    file.reprendre();
    return () => file.vider();
  }, [file]);

  const resume = resumer(etat);

  // Fermer l'onglet ou recharger pendant un envoi : le navigateur demande
  // confirmation (les photos en mémoire seraient perdues). La navigation
  // interne, elle, n'est pas bloquée.
  const envoiActif = resume.envoiActif;
  useEffect(() => {
    if (!envoiActif) return;
    const retenir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // anciens navigateurs
    };
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [envoiActif]);

  return { file, etat, resume };
}

export type FilePhotosReact = ReturnType<typeof useFilePhotos>;
