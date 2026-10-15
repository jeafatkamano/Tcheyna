/**
 * TeleversementPhotos.tsx — Ajout des photos d'un bien.
 *
 * Chaque photo choisie est compressée dans le téléphone (≤ 300 Ko, cf.
 * lib/image.ts), puis envoyée seule, l'une après l'autre, avec sa barre de
 * progression. Une photo en échec garde son fichier compressé et propose
 * « Réessayer » : rien n'est à choisir de nouveau.
 *
 * Deux situations, un seul composant :
 *   • annonce existante — les photos partent dès qu'elles sont prêtes ;
 *   • annonce en cours de création — elles attendent, compressées, que le
 *     formulaire ait enregistré l'annonce (`file.demarrer(id)`).
 *
 * La file elle-même appartient au formulaire (useFilePhotos), qui peut ainsi
 * attendre la fin des envois avant de changer de page.
 */
import { AlertCircle, ImagePlus, Loader2, RotateCcw, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { listingsAPI, urlFichier } from "../api";
import type { FilePhotosReact } from "../hooks/useFilePhotos";
import type { PhotoFile } from "../lib/filePhotos";
import { MessageErreur } from "./Etats";

const MAX_PHOTOS = 10;
// `image/*` laisse la galerie proposer toutes les photos ; un format que le
// navigateur ne sait pas lire (HEIC hors galerie iOS) est signalé par photo.
const FORMATS = "image/*";

interface Props {
  /** Absent tant que l'annonce n'existe pas : les photos attendent alors. */
  listingId?: string;
  /** Photos déjà enregistrées côté serveur. */
  images: string[];
  onImagesChange: (images: string[]) => void;
  /** File d'envoi, portée par le formulaire. */
  photos: FilePhotosReact;
}

export function TeleversementPhotos({ listingId, images, onImagesChange, photos }: Props) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [surviole, setSurviole] = useState(false);
  const { file, etat, resume } = photos;

  const total = images.length + etat.photos.length;
  const restant = MAX_PHOTOS - total;

  function ajouter(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setErreur(null);

    const retenus = Array.from(fichiers).slice(0, Math.max(restant, 0));
    if (retenus.length < fichiers.length) {
      setErreur(`${MAX_PHOTOS} photos maximum par annonce.`);
    }
    if (!retenus.length) return;

    void file.ajouter(retenus);
    if (listingId) void file.demarrer(listingId);
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

  function reessayerTout() {
    etat.photos.filter((p) => p.etat === "erreur").forEach((p) => void file.reessayer(p.id));
  }

  // Messages d'échec distincts, lisibles sous la grille (la vignette est trop petite).
  const messagesEchec = [
    ...new Set(etat.photos.filter((p) => p.etat === "erreur").map((p) => p.erreur ?? "")),
  ].filter(Boolean);
  const nbEnFile = etat.photos.filter((p) => p.etat !== "erreur").length;

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

          {etat.photos.map((photo) => (
            <VignetteEnFile
              key={photo.id}
              photo={photo}
              differe={!listingId}
              onReessayer={() => void file.reessayer(photo.id)}
              onRetirer={() => file.retirer(photo.id)}
            />
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
            ajouter(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl cursor-pointer transition-colors"
          style={{
            background: surviole ? "#FFF7ED" : "#F8FAFC",
            border: `2px dashed ${surviole ? "#F97316" : "#CBD5E1"}`,
          }}
        >
          <input
            type="file"
            accept={FORMATS}
            multiple
            className="sr-only"
            onChange={(e) => {
              ajouter(e.target.files);
              e.target.value = "";
            }}
          />
          <ImagePlus size={22} style={{ color: "#94A3B8" }} />
          <span className="text-sm font-semibold" style={{ color: "#1E3A5F" }}>
            Ajouter des photos
          </span>
          <span className="text-xs text-gray-400">
            Glissez vos fichiers ici, ou touchez pour les choisir
          </span>
          <span className="text-xs text-gray-400 text-center px-4">
            JPG, PNG ou WEBP · allégées automatiquement avant l'envoi
          </span>
        </label>
      )}

      {/* Récapitulatif */}
      {!listingId && nbEnFile > 0 && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "#FFF7ED", color: "#9A3412" }}>
          {nbEnFile} photo{nbEnFile > 1 ? "s" : ""} prête{nbEnFile > 1 ? "s" : ""} : envoi à
          l'enregistrement de l'annonce.
        </p>
      )}
      {listingId && resume.restantes > 0 && (
        <p
          className="text-xs px-3 py-2 rounded-xl flex items-center gap-2"
          style={{ background: "#EFF6FF", color: "#1D4ED8" }}
          role="status"
        >
          <Loader2 size={13} className="animate-spin flex-shrink-0" />
          Envoi des photos : {resume.envoyees} envoyée{resume.envoyees > 1 ? "s" : ""},{" "}
          {resume.restantes} restante{resume.restantes > 1 ? "s" : ""}. Restez sur cette page.
        </p>
      )}
      {resume.nonCompressees > 0 && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "#F8FAFC", color: "#64748B" }}>
          {resume.nonCompressees} photo{resume.nonCompressees > 1 ? "s envoyées" : " envoyée"} sans
          compression : ses informations internes (date, parfois position) n'ont pas été retirées.
        </p>
      )}
      {resume.enEchec > 0 && (
        <div className="px-3 py-2.5 rounded-xl space-y-2" style={{ background: "#FEF2F2" }} role="alert">
          <p className="text-xs font-semibold" style={{ color: "#B91C1C" }}>
            {resume.enEchec} photo{resume.enEchec > 1 ? "s n'ont" : " n'a"} pas pu être
            envoyée{resume.enEchec > 1 ? "s" : ""}.
          </p>
          {messagesEchec.map((m) => (
            <p key={m} className="text-xs" style={{ color: "#B91C1C" }}>
              {m}
            </p>
          ))}
          {listingId && etat.photos.some((p) => p.etat === "erreur" && p.reessayable) && (
            <button
              type="button"
              onClick={reessayerTout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background: "#DC2626" }}
            >
              <RotateCcw size={13} />
              Tout réessayer
            </button>
          )}
        </div>
      )}

      <MessageErreur message={erreur} />
    </div>
  );
}

function VignetteEnFile({
  photo,
  differe,
  onReessayer,
  onRetirer,
}: {
  photo: PhotoFile;
  differe: boolean;
  onReessayer: () => void;
  onRetirer: () => void;
}) {
  const enErreur = photo.etat === "erreur";
  const occupee = photo.etat === "envoi" || photo.etat === "compression";
  const libelle = {
    compression: "Préparation…",
    attente: `${differe ? "À l'enregistrement" : "En attente"}${photo.nonCompressee ? " · non compressée" : ""}`,
    envoi: `Envoi ${Math.round(photo.progression * 100)} %`,
    erreur: "Échec",
  }[photo.etat];

  return (
    <figure
      className="relative aspect-square rounded-xl overflow-hidden"
      style={{
        outline: `2px dashed ${enErreur ? "#DC2626" : "#F97316"}`,
        outlineOffset: "-2px",
        background: "#F1F5F9",
      }}
    >
      {photo.apercu ? (
        <img src={photo.apercu} alt="" className="w-full h-full object-cover opacity-70" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {enErreur ? (
            <AlertCircle size={20} style={{ color: "#DC2626" }} />
          ) : (
            <Loader2 size={20} className="animate-spin" style={{ color: "#94A3B8" }} />
          )}
        </div>
      )}

      <figcaption
        className="absolute bottom-1 left-1 right-1 px-1.5 py-0.5 rounded font-semibold"
        style={{ background: enErreur ? "#DC2626" : "#F97316", color: "white", fontSize: "9px" }}
      >
        {libelle}
        {photo.etat === "envoi" && (
          <span className="block h-1 mt-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.35)" }}>
            <span
              className="block h-full bg-white transition-[width]"
              style={{ width: `${Math.round(photo.progression * 100)}%` }}
            />
          </span>
        )}
      </figcaption>

      <div className="absolute top-1 right-1 flex gap-1">
        {enErreur && photo.reessayable && !differe && (
          <button
            type="button"
            onClick={onReessayer}
            className="p-1 rounded-lg"
            style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
            title="Réessayer l'envoi"
            aria-label={`Réessayer l'envoi de ${photo.nom}`}
          >
            <RotateCcw size={12} />
          </button>
        )}
        {!occupee && (
          <button
            type="button"
            onClick={onRetirer}
            className="p-1 rounded-lg"
            style={{ background: "rgba(220,38,38,0.85)", color: "white" }}
            aria-label={`Retirer ${photo.nom}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </figure>
  );
}
