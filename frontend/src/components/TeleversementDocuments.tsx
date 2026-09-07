/**
 * TeleversementDocuments.tsx — Pièces administratives d'une annonce.
 *
 * Titre foncier, bail, acte notarié, quittance : plusieurs pièces sont
 * souvent nécessaires pour établir la propriété d'un bien. Contrairement aux
 * photos, elles ne sont jamais publiques — leur consultation passe par un
 * lien temporaire, réservé au propriétaire et aux vérificateurs.
 */
import { ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { listingsAPI, type DocumentPiece } from "../api";
import { useApi } from "../hooks/useApi";
import { MessageErreur } from "./Etats";

const MAX_DOCUMENTS = 6;

interface Props {
  listingId: string;
  /** Le retrait est bloqué pendant l'examen de la certification. */
  verrouille?: boolean;
  onChangement?: (nbDocuments: number) => void;
}

export function TeleversementDocuments({ listingId, verrouille, onChangement }: Props) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const pieces = useApi(() => listingsAPI.documents(listingId), [listingId]);
  const documents: DocumentPiece[] = pieces.data?.documents ?? [];
  const restant = MAX_DOCUMENTS - documents.length;

  async function ajouter(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setErreur(null);
    setEnCours(true);
    try {
      const reponse = await listingsAPI.televerserDocuments(
        listingId,
        Array.from(fichiers).slice(0, Math.max(restant, 0)),
      );
      await pieces.recharger();
      onChangement?.(reponse.nb_documents);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setEnCours(false);
    }
  }

  async function retirer(reference: string) {
    setErreur(null);
    try {
      const reponse = await listingsAPI.supprimerDocument(listingId, reference);
      await pieces.recharger();
      onChangement?.(reponse.nb_documents);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  return (
    <div className="space-y-2.5">
      {documents.map((doc) => (
        <div
          key={doc.reference}
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "white", border: "1.5px solid #A7F3D0" }}
        >
          <FileText size={18} style={{ color: "#10B981", flexShrink: 0 }} />
          <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "#1E293B" }}>
            {doc.libelle}
          </span>
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg flex-shrink-0"
            style={{ background: "#EFF6FF", color: "#1D4ED8" }}
            aria-label={`Ouvrir ${doc.libelle}`}
          >
            <ExternalLink size={14} />
          </a>
          {!verrouille && (
            <button
              type="button"
              onClick={() => retirer(doc.reference)}
              className="p-1.5 rounded-lg flex-shrink-0"
              style={{ background: "#FEE2E2", color: "#DC2626" }}
              aria-label={`Retirer ${doc.libelle}`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}

      {restant > 0 && (
        <label
          className="flex items-center gap-3 p-3 rounded-xl cursor-pointer"
          style={{ background: "white", border: "1.5px dashed #CBD5E1" }}
        >
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            multiple
            className="sr-only"
            disabled={enCours}
            onChange={(e) => {
              void ajouter(e.target.files);
              e.target.value = "";
            }}
          />
          {enCours ? (
            <Loader2 size={18} className="animate-spin" style={{ color: "#F97316", flexShrink: 0 }} />
          ) : (
            <Upload size={18} style={{ color: "#94A3B8", flexShrink: 0 }} />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
              {enCours ? "Envoi en cours…" : "Ajouter une pièce"}
            </p>
            <p className="text-xs text-gray-400">
              Titre foncier, bail, acte notarié… · photo ou PDF, 8 Mo maximum
            </p>
          </div>
        </label>
      )}

      {verrouille && documents.length > 0 && (
        <p className="text-xs" style={{ color: "#B45309" }}>
          Les pièces ne peuvent pas être retirées pendant l'examen de la certification.
        </p>
      )}

      <MessageErreur message={erreur ?? pieces.erreur} />
    </div>
  );
}
