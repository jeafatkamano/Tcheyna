/**
 * TeleversementPhotos.tsx — Ajout des photos d'un bien.
 *
 * Deux situations, un seul composant :
 *   • annonce existante — chaque photo part immédiatement au serveur ;
 *   • annonce en cours de création — les photos sont retenues localement,
 *     puis envoyées par le formulaire dès que l'annonce a un identifiant.
 *
 * Sans ce second mode, il faudrait publier une annonce sans photo, puis y
 * revenir pour les ajouter.
 */
import { ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { listingsAPI, urlFichier } from "../api";
import { MessageErreur } from "./Etats";

const MAX_PHOTOS = 10;
const FORMATS = ".jpg,.jpeg,.png,.webp";

export interface PhotoEnAttente {
  fichier: File;
  apercu: string;
}

interface Props {
  /** Absent tant que l'annonce n'existe pas : on bascule alors en mode différé. */
  listingId?: string;
  /** Photos déjà enregistrées côté serveur. */
  images: string[];
  onImagesChange: (images: string[]) => void;
  /** Photos retenues localement, en mode différé. */
  enAttente?: PhotoEnAttente[];
  onEnAttenteChange?: (photos: PhotoEnAttente[]) => void;
}

export function TeleversementPhotos({
  listingId,
  images,
  onImagesChange,
  enAttente = [],
  onEnAttenteChange,
}: Props) {
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [surviole, setSurviole] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);

  const differe = !listingId;
  const total = images.length + enAttente.length;
  const restant = MAX_PHOTOS - total;

  // Les aperçus locaux occupent de la mémoire tant qu'ils ne sont pas révoqués.
  useEffect(() => {
    return () => enAttente.forEach((p) => URL.revokeObjectURL(p.apercu));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setErreur(null);

    const retenus = Array.from(fichiers).slice(0, Math.max(restant, 0));
    if (!retenus.length) {
      setErreur(`${MAX_PHOTOS} photos maximum par annonce.`);
      return;
    }

    if (differe) {
      onEnAttenteChange?.([
        ...enAttente,
        ...retenus.map((fichier) => ({ fichier, apercu: URL.createObjectURL(fichier) })),
      ]);
      return;
    }

    setEnvoiEnCours(true);
    try {
      const reponse = await listingsAPI.televerserPhotos(listingId!, retenus);
      onImagesChange(reponse.images);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function retirer(url: string) {
    setErreur(null);
    if (!listingId) return;
    try {
      const reponse = await listingsAPI.supprimerPhoto(listingId, url);
      onImagesChange(reponse.images);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  function retirerEnAttente(index: number) {
    URL.revokeObjectURL(enAttente[index].apercu);
    onEnAttenteChange?.(enAttente.filter((_, i) => i !== index));
  }

  async function mettreEnPremier(url: string) {
    if (!listingId) return;
    const reordonnees = [url, ...images.filter((u) => u !== url)];
    onImagesChange(reordonnees);
    try {
      await listingsAPI.reordonnerPhotos(listingId, reordonnees);
    } catch {
      onImagesChange(images); // l'ordre serveur fait foi
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          La première photo sert de vignette dans les résultats.
        </span>
        <span className="text-xs text-gray-400">
          {total}/{MAX_PHOTOS}
        </span>
      </div>

      {/* Grille des photos */}
      {total > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((url, i) => (
            <figure key={url} className="relative aspect-square rounded-xl overflow-hidden group">
              <img
                src={urlFichier(url)}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {i === 0 && (
                <figcaption
                  className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-white font-semibold"
                  style={{ background: "rgba(30,58,95,0.85)", fontSize: "9px" }}
                >
                  Vignette
                </figcaption>
              )}
              <div className="absolute top-1 right-1 flex gap-1">
                {i !== 0 && (
                  <button
                    type="button"
                    onClick={() => mettreEnPremier(url)}
                    className="p-1 rounded-lg"
                    style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
                    title="Utiliser comme vignette"
                    aria-label={`Utiliser la photo ${i + 1} comme vignette`}
                  >
                    <Star size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => retirer(url)}
                  className="p-1 rounded-lg"
                  style={{ background: "rgba(220,38,38,0.85)", color: "white" }}
                  aria-label={`Retirer la photo ${i + 1}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </figure>
          ))}

          {enAttente.map((photo, i) => (
            <figure
              key={photo.apercu}
              className="relative aspect-square rounded-xl overflow-hidden"
              style={{ outline: "2px dashed #F97316", outlineOffset: "-2px" }}
            >
              <img src={photo.apercu} alt="" className="w-full h-full object-cover opacity-80" />
              <figcaption
                className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded font-semibold"
                style={{ background: "#F97316", color: "white", fontSize: "9px" }}
              >
                À l'enregistrement
              </figcaption>
              <button
                type="button"
                onClick={() => retirerEnAttente(i)}
                className="absolute top-1 right-1 p-1 rounded-lg"
                style={{ background: "rgba(220,38,38,0.85)", color: "white" }}
                aria-label="Retirer cette photo"
              >
                <Trash2 size={12} />
              </button>
            </figure>
          ))}
        </div>
      )}

      {/* Zone de dépôt */}
      {restant > 0 && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setSurviole(true);
          }}
          onDragLeave={() => setSurviole(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSurviole(false);
            void ajouter(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl cursor-pointer transition-colors"
          style={{
            background: surviole ? "#FFF7ED" : "#F8FAFC",
            border: `2px dashed ${surviole ? "#F97316" : "#CBD5E1"}`,
          }}
        >
          <input
            ref={champFichier}
            type="file"
            accept={FORMATS}
            multiple
            className="sr-only"
            disabled={envoiEnCours}
            onChange={(e) => {
              void ajouter(e.target.files);
              e.target.value = "";
            }}
          />
          {envoiEnCours ? (
            <>
              <Loader2 size={22} className="animate-spin" style={{ color: "#F97316" }} />
              <span className="text-sm font-medium" style={{ color: "#F97316" }}>
                Envoi en cours…
              </span>
            </>
          ) : (
            <>
              <ImagePlus size={22} style={{ color: "#94A3B8" }} />
              <span className="text-sm font-semibold" style={{ color: "#1E3A5F" }}>
                Ajouter des photos
              </span>
              <span className="text-xs text-gray-400">
                Glissez vos fichiers ici, ou touchez pour les choisir
              </span>
              <span className="text-xs text-gray-400">
                JPG, PNG ou WEBP · 8 Mo maximum par photo
              </span>
            </>
          )}
        </label>
      )}

      {differe && enAttente.length > 0 && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "#FFF7ED", color: "#9A3412" }}>
          Ces {enAttente.length} photo{enAttente.length > 1 ? "s" : ""} seront envoyées à
          l'enregistrement de l'annonce.
        </p>
      )}

      <MessageErreur message={erreur} />
    </div>
  );
}

/** Envoie les photos retenues localement, une fois l'annonce créée. */
export async function envoyerPhotosEnAttente(
  listingId: string,
  photos: PhotoEnAttente[],
): Promise<string[]> {
  if (!photos.length) return [];
  const reponse = await listingsAPI.televerserPhotos(
    listingId,
    photos.map((p) => p.fichier),
  );
  photos.forEach((p) => URL.revokeObjectURL(p.apercu));
  return reponse.images;
}

/** Bouton compact, pour les emplacements où la grille serait de trop. */
export function BoutonAjoutPhoto({
  onFichiers,
  enCours,
}: {
  onFichiers: (fichiers: FileList | null) => void;
  enCours?: boolean;
}) {
  return (
    <label
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
      style={{ background: "#F0F4FA", color: "#1E3A5F" }}
    >
      <input
        type="file"
        accept={FORMATS}
        multiple
        className="sr-only"
        disabled={enCours}
        onChange={(e) => {
          onFichiers(e.target.files);
          e.target.value = "";
        }}
      />
      {enCours ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
      {enCours ? "Envoi…" : "Ajouter des photos"}
    </label>
  );
}
