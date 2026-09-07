/**
 * TeleversementAvatar.tsx — Photo de profil.
 */
import { Camera, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { usersAPI } from "../api";
import { useAuth } from "../context/AuthContext";
import { Avatar } from "./Avatar";
import { MessageErreur } from "./Etats";

interface Props {
  taille?: number;
  /** Sur l'en-tête bleu nuit des pages de profil. */
  surFonce?: boolean;
}

export function TeleversementAvatar({ taille = 80, surFonce = false }: Props) {
  const { user, rafraichir } = useAuth();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(fichier: File | undefined) {
    if (!fichier) return;
    setErreur(null);
    setEnCours(true);
    try {
      await usersAPI.televerserAvatar(fichier);
      await rafraichir();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setEnCours(false);
    }
  }

  async function retirer() {
    setErreur(null);
    setEnCours(true);
    try {
      await usersAPI.supprimerAvatar();
      await rafraichir();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Suppression impossible");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: taille, height: taille }}>
        <Avatar
          nom={user?.full_name}
          url={user?.avatar_url}
          taille={taille}
          surFonce={surFonce}
        />

        {enCours && (
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(15,32,64,0.55)", borderRadius: taille * 0.28 }}
          >
            <Loader2 size={20} className="animate-spin" color="white" />
          </span>
        )}

        <label
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full cursor-pointer shadow-md"
          style={{ width: 30, height: 30, background: "#F97316" }}
          title="Changer la photo de profil"
        >
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="sr-only"
            disabled={enCours}
            onChange={(e) => {
              void envoyer(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Camera size={15} color="white" />
          <span className="sr-only">Changer la photo de profil</span>
        </label>
      </div>

      {user?.avatar_url && !enCours && (
        <button
          type="button"
          onClick={retirer}
          className="inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: surFonce ? "rgba(255,255,255,0.6)" : "#94A3B8" }}
        >
          <Trash2 size={11} />
          Retirer la photo
        </button>
      )}

      {erreur && (
        <div className="w-full max-w-xs">
          <MessageErreur message={erreur} />
        </div>
      )}
    </div>
  );
}
