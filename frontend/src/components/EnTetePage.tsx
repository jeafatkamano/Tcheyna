/**
 * EnTetePage.tsx — En-tête bleu nuit des pages de l'espace connecté
 * (maquettes Accueil et Annonces, lot 3.15a).
 *
 * Le fond passe sous la barre d'état ; le contenu commence en dessous
 * (--inset-haut). `chevauchement` agrandit le bas pour qu'une carte remonte
 * dessus (marge négative côté page), `arrondi` arrondit les coins du bas.
 */
import { Bell } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Avatar } from "./Avatar";
import { useCoque } from "./coque";

interface Props {
  titre?: ReactNode;
  /** Élément à gauche du titre (avatar, retour). */
  gauche?: ReactNode;
  /** Élément à droite (cloche, action). */
  droite?: ReactNode;
  /** Contenu sous la ligne du titre (sélecteur, recherche). */
  children?: ReactNode;
  arrondi?: boolean;
  chevauchement?: number;
}

export function EnTetePage({ titre, gauche, droite, children, arrondi = false, chevauchement = 0 }: Props) {
  const ligne = titre !== undefined || gauche || droite;
  return (
    <header
      className="px-5 text-white"
      style={{
        background: "#1E3A5F",
        paddingTop: "calc(var(--inset-haut) + 16px)",
        paddingBottom: 18 + chevauchement,
        borderRadius: arrondi ? "0 0 28px 28px" : undefined,
      }}
    >
      {ligne && (
        <div className="min-h-11 flex items-center gap-3">
          {gauche}
          <div className="grow min-w-0">
            {typeof titre === "string" ? (
              <h1 className="m-0 font-extrabold truncate" style={{ fontSize: 24 }}>
                {titre}
              </h1>
            ) : (
              titre
            )}
          </div>
          {droite}
        </div>
      )}
      {children && <div className={`flex flex-col gap-3.5 ${ligne ? "mt-3.5" : ""}`}>{children}</div>}
    </header>
  );
}

/** Cloche des notifications, avec un point quand il y en a de non lues. */
export function BoutonNotifications() {
  const { notifsNonLues } = useCoque();
  return (
    <Link
      to="/notifications"
      aria-label={`Notifications${notifsNonLues ? ` (${notifsNonLues} non lues)` : ""}`}
      className="relative w-11 h-11 shrink-0 rounded-[14px] flex items-center justify-center text-white"
      style={{ background: "rgba(255,255,255,0.1)" }}
    >
      <Bell size={20} aria-hidden="true" />
      {notifsNonLues > 0 && (
        <span
          className="absolute rounded-full"
          style={{ top: 8, right: 9, width: 9, height: 9, background: "#F97316", border: "2px solid #1E3A5F" }}
          aria-hidden="true"
        />
      )}
    </Link>
  );
}

/** Avatar de l'utilisateur : ouvre le menu latéral (favoris, paiements, déconnexion). */
export function BoutonMenuAvatar({ nom, url }: { nom?: string | null; url?: string | null }) {
  const { ouvrirMenu } = useCoque();
  const avatar = <Avatar nom={nom} url={url} taille={48} forme="rond" fond="#F97316" />;
  if (!ouvrirMenu) return avatar;
  return (
    <button type="button" onClick={ouvrirMenu} aria-label="Ouvrir le menu" className="shrink-0 rounded-full">
      {avatar}
    </button>
  );
}
