/**
 * FormulaireSombre.tsx — Éléments des écrans d'accès sur fond bleu nuit :
 * connexion, inscription, mot de passe oublié, code SMS (lot 3.14).
 *
 * Valeurs de la maquette (docs/design/maquette-app-mobile/ : Connexion,
 * Inscription1, Inscription2, MotDePasse, CodeSMS) : champs de 54 à 56 px,
 * rayon 16 px, fond blanc à 7 %, bordure blanche à 20 % (orange au focus,
 * voir theme.css) ; bouton principal de 56 px, orange, en bas de l'écran.
 *
 * Le bouton principal n'est pas fixé : il suit le formulaire dans le flux de
 * la page. Clavier ouvert, il reste atteignable en faisant défiler, au lieu
 * d'être caché derrière.
 */
import { ArrowLeft, Eye, EyeOff, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { decritPar } from "../lib/aria";
import { DEGRADE_NUIT } from "./Marque";

export const TEXTE_SECONDAIRE = "rgba(255,255,255,0.78)";
const TEXTE_LIBELLE = "rgba(255,255,255,0.85)";
const ROUGE_ERREUR = "#FCA5A5";

/** Page plein écran : contenu en haut, `pied` (bouton principal) en bas. */
export function EcranSombre({ children, pied }: { children: ReactNode; pied?: ReactNode }) {
  return (
    <div
      className="min-h-dvh flex flex-col px-6 text-white"
      style={{
        background: DEGRADE_NUIT,
        paddingTop: "calc(var(--inset-haut) + 12px)",
        paddingBottom: "calc(var(--inset-bas) + 24px)",
      }}
    >
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col">
        {children}
        {pied && (
          <>
            <div className="flex-1 min-h-6" />
            {pied}
          </>
        )}
      </div>
    </div>
  );
}

/** Flèche de retour, 44 × 44 px. */
export function BoutonRetour({ onClick, libelle = "Retour" }: { onClick: () => void; libelle?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={libelle}
      className="w-11 h-11 -ml-2.5 shrink-0 flex items-center justify-center rounded-full"
      style={{ color: TEXTE_LIBELLE }}
    >
      <ArrowLeft size={22} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

export function TitreEcran({
  children,
  taille = 32,
  sousTitre,
}: {
  children: ReactNode;
  taille?: number;
  sousTitre?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 tabIndex={-1} className="m-0 font-extrabold outline-none" style={{ fontSize: taille, lineHeight: 1.12, letterSpacing: -0.5 }}>
        {children}
      </h1>
      {sousTitre && (
        <p className="m-0" style={{ fontSize: taille >= 30 ? 16 : 15, lineHeight: 1.55, color: TEXTE_SECONDAIRE }}>
          {sousTitre}
        </p>
      )}
    </div>
  );
}

/** Pastille d'icône de 72 px (mot de passe oublié, code SMS). */
export function IconeEcran({ icone: Icone }: { icone: LucideIcon }) {
  return (
    <div
      className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
      style={{ background: "rgba(249,115,22,0.16)" }}
    >
      <Icone size={32} strokeWidth={2} color="#F97316" aria-hidden="true" />
    </div>
  );
}

/** Encadré d'information discret. */
export function Encadre({ icone: Icone, children }: { icone?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex gap-3 items-start rounded-2xl" style={{ padding: "14px 16px", background: "rgba(255,255,255,0.05)" }}>
      {Icone && <Icone size={20} className="shrink-0 mt-px" color="#FDBA74" aria-hidden="true" />}
      <span style={{ fontSize: 14, lineHeight: 1.5, color: TEXTE_LIBELLE }}>{children}</span>
    </div>
  );
}

export function Libelle({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="font-semibold" style={{ fontSize: 14, color: TEXTE_LIBELLE }}>
      {children}
    </label>
  );
}

export function ErreurChamp({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="m-0 font-medium" style={{ fontSize: 13, color: ROUGE_ERREUR }}>
      {message}
    </p>
  );
}

/** Bordure du cadre d'un champ : orange au focus (theme.css ou focus-within), rouge si invalide. */
function bordure(invalide: boolean) {
  return invalide ? "1.5px solid #F87171" : "1.5px solid rgba(255,255,255,0.2)";
}

interface ChampProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  libelle: ReactNode;
  icone?: LucideIcon;
  /** Texte fixe devant la saisie, séparé par un filet (« +224 »). */
  prefixe?: string;
  aide?: ReactNode;
  erreur?: string | null;
  /** Bouton dans le champ, à droite (afficher le mot de passe). */
  action?: ReactNode;
  /** Affiché sous la saisie, avant l'aide (barres de longueur du mot de passe). */
  sousSaisie?: ReactNode;
  hauteur?: 54 | 56;
}

export const Champ = forwardRef<HTMLInputElement, ChampProps>(function Champ(
  { id, libelle, icone: Icone, prefixe, aide, erreur, action, sousSaisie, hauteur = 56, className, style, ...saisie },
  ref,
) {
  const idAide = aide ? `${id}-aide` : null;
  const idErreur = erreur ? `${id}-erreur` : null;
  const attributs = {
    ...saisie,
    ref,
    id,
    "aria-invalid": erreur ? true : undefined,
    "aria-describedby": decritPar(idAide, idErreur),
  };

  return (
    <div className="flex flex-col gap-2">
      <Libelle htmlFor={id}>{libelle}</Libelle>
      {prefixe ? (
        <div
          className="flex overflow-hidden rounded-2xl focus-within:border-[#F97316]!"
          style={{ height: hauteur, background: "rgba(255,255,255,0.07)", border: bordure(Boolean(erreur)) }}
        >
          <span
            className="flex items-center px-3.5 font-bold shrink-0"
            style={{ fontSize: 15, borderRight: "1.5px solid rgba(255,255,255,0.2)" }}
          >
            {prefixe}
          </span>
          <input
            {...attributs}
            className={`grow min-w-0 h-full px-3.5 bg-transparent text-white outline-none border-0! placeholder:text-white/55 ${className ?? ""}`}
            style={{ fontSize: 15, ...style }}
          />
        </div>
      ) : (
        <div className="relative">
          {Icone && (
            <Icone
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              color="rgba(255,255,255,0.6)"
              aria-hidden="true"
            />
          )}
          <input
            {...attributs}
            className={`w-full rounded-2xl text-white outline-none placeholder:text-white/55 ${className ?? ""}`}
            style={{
              height: hauteur,
              paddingLeft: Icone ? 48 : 16,
              paddingRight: action ? 52 : 16,
              background: "rgba(255,255,255,0.07)",
              border: bordure(Boolean(erreur)),
              fontSize: 15,
              ...style,
            }}
          />
          {action && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{action}</div>}
        </div>
      )}
      {sousSaisie}
      {aide && (
        <p id={idAide!} className="m-0" style={{ fontSize: 13, color: TEXTE_SECONDAIRE }}>
          {aide}
        </p>
      )}
      <ErreurChamp id={`${id}-erreur`} message={erreur} />
    </div>
  );
});

/** Bouton œil : afficher ou masquer un mot de passe. */
export function BoutonVisibilite({
  visible,
  onBasculer,
  pluriel = false,
}: {
  visible: boolean;
  onBasculer: () => void;
  pluriel?: boolean;
}) {
  const quoi = pluriel ? "les mots de passe" : "le mot de passe";
  return (
    <button
      type="button"
      onClick={onBasculer}
      aria-label={visible ? `Masquer ${quoi}` : `Afficher ${quoi}`}
      aria-pressed={visible}
      className="w-11 h-11 flex items-center justify-center rounded-xl"
      style={{ color: "rgba(255,255,255,0.7)" }}
    >
      {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  );
}

/** Champ de mot de passe avec son bouton œil (état propre, ou commandé par le parent). */
export const ChampMotDePasse = forwardRef<
  HTMLInputElement,
  Omit<ChampProps, "type" | "action"> & { visible?: boolean; onBasculer?: () => void; pluriel?: boolean }
>(function ChampMotDePasse({ visible, onBasculer, pluriel, ...props }, ref) {
  const [visibleLocal, setVisibleLocal] = useState(false);
  const affiche = visible ?? visibleLocal;
  return (
    <Champ
      {...props}
      ref={ref}
      type={affiche ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      action={
        <BoutonVisibilite
          visible={affiche}
          pluriel={pluriel}
          onBasculer={onBasculer ?? (() => setVisibleLocal((v) => !v))}
        />
      }
    />
  );
});

/** Bouton principal orange, 56 px. */
export function BoutonPrincipal({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      {...props}
      className={`w-full h-14 rounded-2xl font-bold text-white flex items-center justify-center gap-2.5 disabled:opacity-60 ${className ?? ""}`}
      style={{ fontSize: 16, background: "#F97316", boxShadow: "0 10px 24px rgba(249,115,22,0.35)" }}
    >
      {children}
    </button>
  );
}

/** Ligne « Pas encore de compte ? Créer un compte » sous le bouton principal. */
export function LigneLien({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-center" style={{ fontSize: 14, color: TEXTE_SECONDAIRE }}>
      {children}
    </p>
  );
}

/** Lien dans une phrase : exempté de la taille de cible de 44 px (WCAG 2.5.8, « en ligne »). */
export const CLASSE_LIEN = "inline-block py-1 font-bold text-white underline underline-offset-2";
