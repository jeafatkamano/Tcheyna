/**
 * EnTeteProfil.tsx — En-tête des pages de profil (maquette Profil, lot 3.15b) :
 * titre, bouton du menu, avatar (téléversable), nom, badge de niveau et barre
 * des quatre niveaux du Passeport. Partagé par le profil du locataire et
 * celui du propriétaire.
 */
import { Settings } from "lucide-react";
import type { ReactNode } from "react";

import { BadgeVerification } from "./BadgeVerification";
import { useCoque } from "./coque";
import { EnTetePage } from "./EnTetePage";
import { TeleversementAvatar } from "./TeleversementAvatar";

const NB_NIVEAUX = 4;

/** Ouvre le menu latéral (favoris, paiements, paramètres, déconnexion). */
function BoutonMenu() {
  const { ouvrirMenu } = useCoque();
  if (!ouvrirMenu) return null;
  return (
    <button
      type="button"
      onClick={ouvrirMenu}
      aria-label="Ouvrir le menu"
      className="w-11 h-11 -mr-2 shrink-0 flex items-center justify-center rounded-full text-white"
    >
      <Settings size={22} aria-hidden="true" />
    </button>
  );
}

/** Barre des quatre niveaux : un segment orange par niveau atteint. */
export function BarreNiveaux({ niveau }: { niveau: number }) {
  const atteint = Math.max(0, Math.min(NB_NIVEAUX, niveau));
  return (
    <div role="img" aria-label={`Niveau ${atteint} sur ${NB_NIVEAUX}`} className="flex gap-1.5">
      {Array.from({ length: NB_NIVEAUX }, (_, i) => (
        <span
          key={i}
          className="grow h-1.5 rounded-full"
          style={{ background: i < atteint ? "#F97316" : "rgba(255,255,255,0.2)" }}
        />
      ))}
    </div>
  );
}

interface Props {
  titre: string;
  nom?: string | null;
  /** Sous le nom : situation, rôle. */
  detail?: ReactNode;
  niveau: number;
  /** À droite de l'identité : score, note moyenne. */
  aDroite?: ReactNode;
  /** Barre des quatre niveaux (Passeport du locataire). */
  avecBarre?: boolean;
}

export function EnTeteProfil({ titre, nom, detail, niveau, aDroite, avecBarre = false }: Props) {
  return (
    <EnTetePage
      titre={
        <h1 className="m-0 font-extrabold truncate" style={{ fontSize: 20 }}>
          {titre}
        </h1>
      }
      droite={<BoutonMenu />}
    >
      <div className="flex items-center gap-3.5">
        <TeleversementAvatar taille={60} surFonce />
        <div className="grow min-w-0">
          <p className="m-0 font-extrabold truncate" style={{ fontSize: 18 }}>
            {nom}
          </p>
          {detail && (
            <p className="m-0 truncate" style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>
              {detail}
            </p>
          )}
          <div className="mt-1.5">
            <BadgeVerification level={niveau} size="sm" />
          </div>
        </div>
        {aDroite}
      </div>
      {avecBarre && <BarreNiveaux niveau={niveau} />}
    </EnTetePage>
  );
}
