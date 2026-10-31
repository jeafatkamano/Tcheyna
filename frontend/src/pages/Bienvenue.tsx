/**
 * Bienvenue.tsx — Présentation du premier lancement de l'application (lot 3.13).
 *
 * Trois écrans d'après la maquette (docs/design/maquette-app-mobile/ : Main,
 * Ecran2, Ecran3), côte à côte dans un conteneur horizontal en scroll-snap :
 * le doigt les fait glisser nativement, sans bibliothèque. La flèche avance
 * d'un écran, « Passer » va au troisième. Les écrans hors de vue sont inertes,
 * pour que le lecteur d'écran et le clavier ne lisent que l'écran courant.
 *
 * Quitter la présentation par l'un des boutons du troisième écran la marque
 * comme vue (lib/presentation.ts) : l'application ne la remontrera plus.
 *
 * Lot 3.17 : chaque écran s'anime à son arrivée (styles/presentation.css),
 * et rejoue son animation quand on y revient. Rien ne bouge si le système
 * demande moins d'animations.
 */
import { ArrowLeft, ArrowRight, CalendarDays, Check, House, ShieldCheck, Star, User } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";

import { DEGRADE_NUIT, Monogramme } from "../components/Marque";
import { marquerPresentationVue } from "../lib/presentation";
import "../styles/presentation.css";

const NB_ECRANS = 3;
const TEXTE_SECONDAIRE = "rgba(255,255,255,0.78)";

function mouvementReduit(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Bienvenue() {
  const defileur = useRef<HTMLDivElement>(null);
  const [courant, setCourant] = useState(0);
  // Navigation par bouton : le focus suivra sur le titre du nouvel écran.
  const focusEnAttente = useRef(false);

  // Animations : l'écran courant repasse par « attente » puis « joue », ce qui
  // relance ses animations CSS sans démonter ses éléments (le focus reste en
  // place). Avant le premier affichage, pour éviter un éclair de l'état final.
  // Un écran déjà joué garde « joue » quand on le quitte : il ne disparaît pas
  // pendant qu'il glisse hors de l'écran.
  useLayoutEffect(() => {
    const sections = [...(defileur.current?.children ?? [])] as HTMLElement[];
    sections.forEach((el, i) => {
      if (i === courant) {
        el.dataset.pres = "attente";
        void el.offsetWidth; // force le recalcul : les animations repartent de zéro
        el.dataset.pres = "joue";
      } else if (!el.dataset.pres) {
        el.dataset.pres = "attente";
      }
    });
  }, [courant]);

  // Seul l'écran visible est lisible et atteignable au clavier. Le focus n'est
  // donné qu'ensuite : un élément encore inerte ne peut pas le recevoir.
  useEffect(() => {
    const sections = [...(defileur.current?.children ?? [])];
    sections.forEach((el, i) => {
      el.toggleAttribute("inert", i !== courant);
      el.setAttribute("aria-hidden", String(i !== courant));
    });
    if (focusEnAttente.current) {
      focusEnAttente.current = false;
      sections[courant]?.querySelector("h1")?.focus({ preventScroll: true });
    }
  }, [courant]);

  const aller = useCallback((i: number) => {
    setCourant(i);
    const el = defileur.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: mouvementReduit() ? "auto" : "smooth" });
    // Le bouton pressé devient inerte : le focus passera au titre du nouvel écran.
    focusEnAttente.current = true;
  }, []);

  function surDefilement() {
    const el = defileur.current;
    if (!el || !el.clientWidth) return;
    const i = Math.min(NB_ECRANS - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
    setCourant(i);
  }

  return (
    <main className="h-dvh text-white" style={{ background: DEGRADE_NUIT }}>
      <p className="sr-only" aria-live="polite">
        Écran {courant + 1} sur {NB_ECRANS}
      </p>
      <div
        ref={defileur}
        onScroll={surDefilement}
        className="h-full flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <Ecran
          entete={<BoutonTexte onClick={() => aller(2)}>Passer</BoutonTexte>}
          illustration={<IllustrationAnnonce />}
          titre={
            <h1 tabIndex={-1} className={CLASSE_TITRE} style={STYLE_TITRE}>
              Des annonces <span style={{ color: "#F97316" }}>certifiées</span>.
            </h1>
          }
          texte="Les annonces certifiées sont vérifiées sur pièces : vous savez ce que vous allez visiter."
          pied={<PiedSuivant index={0} onSuivant={() => aller(1)} />}
        />
        <Ecran
          entete={<BoutonTexte onClick={() => aller(2)}>Passer</BoutonTexte>}
          illustration={<IllustrationPasseport />}
          titre={
            <h1 tabIndex={-1} className={CLASSE_TITRE} style={STYLE_TITRE}>
              Des locataires <span style={{ color: "#F97316" }}>vérifiés</span>.
            </h1>
          }
          texte="Le Passeport Locataire montre au bailleur ce qui a été vérifié : numéro, identité, revenus, avis."
          pied={<PiedSuivant index={1} onSuivant={() => aller(2)} />}
        />
        <Ecran
          dernier
          entete={
            <button
              type="button"
              onClick={() => aller(1)}
              aria-label="Écran précédent"
              className="w-11 h-11 flex items-center justify-center rounded-full"
              style={{ color: TEXTE_SECONDAIRE }}
            >
              <ArrowLeft size={22} strokeWidth={2.2} aria-hidden="true" />
            </button>
          }
          illustration={<IllustrationMessagerie />}
          titre={
            <h1 tabIndex={-1} className={CLASSE_TITRE} style={STYLE_TITRE}>
              Discutez et visitez <span style={{ color: "#F97316" }}>en confiance</span>.
            </h1>
          }
          texte="Messagerie intégrée et visites planifiées dans l'app. Vous visitez l'esprit tranquille."
          pied={<PiedChoix />}
        />
      </div>
    </main>
  );
}

// ─── Gabarit d'un écran ──────────────────────────────────────

const CLASSE_TITRE = "m-0 font-extrabold outline-none pa pres-titre";
const STYLE_TITRE = { fontSize: 32, lineHeight: 1.12, letterSpacing: -0.6 } as const;

function Ecran({
  entete,
  illustration,
  titre,
  texte,
  pied,
  dernier = false,
}: {
  entete: ReactNode;
  illustration: ReactNode;
  titre: ReactNode;
  texte: string;
  pied: ReactNode;
  dernier?: boolean;
}) {
  return (
    <section
      className="w-full h-full shrink-0 snap-start snap-always flex flex-col px-6 overflow-y-auto"
      style={{
        paddingTop: "calc(var(--inset-haut) + 12px)",
        paddingBottom: `calc(var(--inset-bas) + ${dernier ? 16 : 24}px)`,
      }}
    >
      <div className="h-11 flex items-center justify-between shrink-0">
        <Monogramme />
        {entete}
      </div>
      <div className="flex-1 min-h-[300px] flex items-center justify-center relative" aria-hidden="true">
        {illustration}
      </div>
      <div className={`flex flex-col gap-3 shrink-0 ${dernier ? "mb-6" : "mb-8"}`}>
        {titre}
        <p className="m-0 pa pres-texte" style={{ fontSize: 16, lineHeight: 1.55, color: TEXTE_SECONDAIRE }}>
          {texte}
        </p>
      </div>
      <div className="shrink-0">{pied}</div>
    </section>
  );
}

function BoutonTexte({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 px-1 font-semibold"
      style={{ fontSize: 15, color: TEXTE_SECONDAIRE }}
    >
      {children}
    </button>
  );
}

/** Points de position : l'actif est une pilule orange. */
function Points({ index }: { index: number }) {
  return (
    <div role="img" aria-label={`Écran ${index + 1} sur ${NB_ECRANS}`} className="flex gap-2 items-center">
      {Array.from({ length: NB_ECRANS }, (_, i) => (
        <span
          key={i}
          className={`h-2 rounded-full ${i === index ? "pres-pilule" : i === index - 1 ? "pres-retrecit" : ""}`}
          style={{ width: i === index ? 28 : 8, background: i === index ? "#F97316" : "rgba(255,255,255,0.3)" }}
        />
      ))}
    </div>
  );
}

function PiedSuivant({ index, onSuivant }: { index: number; onSuivant: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <Points index={index} />
      {/* L'entrée anime l'enveloppe : le bouton garde son retour au toucher. */}
      <span className={`inline-flex ${index === 0 ? "pa pres-suivant-entree" : ""}`}>
        <button
          type="button"
          onClick={onSuivant}
          aria-label="Suivant"
          className="w-16 h-16 rounded-full flex items-center justify-center pres-suivant"
          style={{ background: "#F97316", boxShadow: "0 10px 24px rgba(249,115,22,0.4)" }}
        >
          <ArrowRight size={26} strokeWidth={2.4} color="#ffffff" aria-hidden="true" className="pres-fleche" />
        </button>
      </span>
    </div>
  );
}

function PiedChoix() {
  return (
    <>
      <div className="flex justify-center mb-5">
        <Points index={2} />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col pa pres-cta" style={{ "--i": 0 } as CSSProperties}>
          <Link
            to="/inscription?role=tenant"
            onClick={marquerPresentationVue}
            className="h-14 rounded-2xl flex items-center justify-center gap-2.5 font-bold text-white no-underline pres-cta-lueur"
            style={{
              fontSize: 16,
              background: "#F97316",
              boxShadow: "0 10px 24px rgba(249,115,22,0.35)",
            }}
          >
            Je cherche un logement
            <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" className="pres-cta-fleche" />
          </Link>
        </div>
        <div className="flex flex-col pa pres-cta" style={{ "--i": 1 } as CSSProperties}>
          <Link
            to="/inscription?role=landlord"
            onClick={marquerPresentationVue}
            className="h-14 rounded-2xl flex items-center justify-center font-bold text-white no-underline"
            style={{
              fontSize: 16,
              background: "rgba(255,255,255,0.08)",
              border: "1.5px solid rgba(255,255,255,0.28)",
            }}
          >
            Je mets en location
          </Link>
        </div>
        <p
          className="m-0 pt-1.5 text-center pa pres-cta"
          style={{ fontSize: 14, color: TEXTE_SECONDAIRE, "--i": 2 } as CSSProperties}
        >
          Déjà un compte ?{" "}
          <Link
            to="/login"
            onClick={marquerPresentationVue}
            className="inline-block py-3 font-bold underline"
            style={{ color: "#FDBA74" }}
          >
            Se connecter
          </Link>
        </p>
      </div>
    </>
  );
}

// ─── Illustrations (décor, masquées aux lecteurs d'écran) ─────
// Classes `pres-*` et `pa` : chorégraphie de styles/presentation.css.

const OMBRE_CARTE = "0 24px 48px rgba(5,12,30,0.45)";

function Halo({ taille = 280 }: { taille?: number }) {
  return (
    <div
      className="absolute rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pres-halo"
      style={{
        width: taille,
        height: taille,
        background: "rgba(249,115,22,0.16)",
      }}
    />
  );
}

function PastilleVerte({
  taille = 26,
  icone = 16,
  className = "",
}: {
  taille?: number;
  icone?: number;
  className?: string;
}) {
  return (
    <span
      className={`rounded-full flex items-center justify-center shrink-0 ${className}`}
      style={{ width: taille, height: taille, background: "#DCFCE7" }}
    >
      <Check size={icone} strokeWidth={2.6} color="#047857" className="pres-coche" />
    </span>
  );
}

/** Étoile à quatre branches qui scintille autour de l'illustration. */
function Etincelle({
  style,
  taille,
  couleur,
  delai,
}: {
  style: CSSProperties;
  taille: number;
  couleur: string;
  delai: string;
}) {
  return (
    <svg
      className="absolute pres-etincelle"
      style={{ ...style, opacity: 0, animationDelay: delai }}
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill={couleur}
    >
      <path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" />
    </svg>
  );
}

function IllustrationAnnonce() {
  return (
    <>
      <Halo />
      <Etincelle style={{ top: 38, left: 22 }} taille={22} couleur="#FDBA74" delai="1.9s" />
      <Etincelle style={{ top: 96, right: 18 }} taille={14} couleur="#ffffff" delai="2.5s" />
      <Etincelle style={{ bottom: 40, left: 40 }} taille={16} couleur="#F97316" delai="3.1s" />
      <div
        className="relative bg-white overflow-hidden pa pres-carte"
        style={{
          width: 272,
          borderRadius: 24,
          rotate: "-3deg",
          boxShadow: OMBRE_CARTE,
        }}
      >
        <div
          className="relative flex items-center justify-center"
          style={{
            height: 150,
            background: "linear-gradient(140deg, #F6D3B0 0%, #E9A66A 100%)",
          }}
        >
          <House size={72} strokeWidth={1.6} color="#ffffff" />
          <div
            className="absolute flex items-center gap-1.5 rounded-full text-white font-bold pa pres-tampon"
            style={{
              top: 12,
              left: 12,
              padding: "6px 10px",
              background: "#1E3A5F",
              fontSize: 12,
            }}
          >
            <ShieldCheck size={14} strokeWidth={2.2} />
            Certifiée
          </div>
        </div>
        <div style={{ padding: "16px 18px 18px", color: "#1E3A5F" }}>
          <div className="font-bold" style={{ fontSize: 17 }}>
            Appartement lumineux
          </div>
          <div className="mt-1" style={{ fontSize: 13, color: "#475569" }}>
            Kipé, Ratoma · 3 pièces · 85 m²
          </div>
          <div className="mt-3 font-extrabold" style={{ fontSize: 20 }}>
            3,5 M GNF{" "}
            <span className="font-medium" style={{ fontSize: 13, color: "#475569" }}>
              /mois
            </span>
          </div>
        </div>
      </div>
      <div
        className="absolute flex items-center gap-2 bg-white font-bold pa pres-puce"
        style={{
          right: 6,
          bottom: 58,
          padding: "10px 14px",
          borderRadius: 16,
          color: "#1E3A5F",
          fontSize: 13,
          boxShadow: "0 12px 28px rgba(5,12,30,0.35)",
          rotate: "2deg",
        }}
      >
        <PastilleVerte />
        Vérifiée sur pièces
      </div>
    </>
  );
}

const NIVEAUX = [
  { nom: "Basique", detail: "Numéro vérifié par SMS", couleur: "#2563EB" },
  { nom: "Identifié", detail: "Pièce d'identité validée", couleur: "#7C3AED" },
  { nom: "Solvable", detail: "Revenus justifiés", couleur: "#047857" },
];

function IllustrationPasseport() {
  return (
    <>
      <Halo />
      <div className="relative pa pres-passeport">
        <div
          className="bg-white flex flex-col pres-flotte"
          style={{
            width: 296,
            borderRadius: 24,
            padding: 20,
            gap: 14,
            color: "#1E3A5F",
            boxShadow: OMBRE_CARTE,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#E2E8F0" }}
            >
              <User size={22} strokeWidth={2} color="#1E3A5F" />
            </div>
            <div className="grow min-w-0">
              <div className="font-semibold uppercase" style={{ fontSize: 12, color: "#475569", letterSpacing: 0.6 }}>
                Passeport Locataire
              </div>
              {/* Le niveau monte sous les yeux : Basique, Identifié, Solvable. */}
              <div className="overflow-hidden font-extrabold" style={{ height: 22, fontSize: 17, lineHeight: "22px" }}>
                <span className="pres-defile">
                  {NIVEAUX.map((n) => (
                    <span key={n.nom} className="block">
                      Niveau {n.nom}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: 6, background: "#E2E8F0" }}>
            <div
              className="h-full w-full rounded-full pres-jauge"
              style={{
                background: "linear-gradient(90deg, #2563EB 0%, #7C3AED 50%, #047857 100%)",
              }}
            />
          </div>
          <div className="flex flex-col gap-3">
            {NIVEAUX.map((n, i) => (
              <div key={n.nom} className="flex items-center gap-3 pa pres-ligne" style={{ "--i": i } as CSSProperties}>
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 pa pres-valide"
                  style={{ background: n.couleur, "--i": i } as CSSProperties}
                >
                  <Check size={15} strokeWidth={2.8} color="#ffffff" className="pres-coche" />
                </span>
                <div className="grow">
                  <div className="font-bold" style={{ fontSize: 14 }}>
                    {n.nom}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{n.detail}</div>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 pa pres-ligne" style={{ "--i": 3 } as CSSProperties}>
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 box-border"
                style={{ border: "2px dashed #C2410C" }}
              >
                <Star size={14} strokeWidth={2.2} color="#C2410C" className="pres-etoile" />
              </span>
              <div className="grow">
                <div className="font-bold" style={{ fontSize: 14 }}>
                  Recommandé
                </div>
                <div style={{ fontSize: 12, color: "#475569" }}>Avis d'anciens bailleurs</div>
              </div>
              <span
                className="font-bold rounded-full pa pres-prochain"
                style={{
                  fontSize: 11,
                  color: "#C2410C",
                  background: "#FFF7ED",
                  padding: "4px 8px",
                }}
              >
                Prochain
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** « … » : quelqu'un est en train d'écrire. */
function EnTrainDecrire({ cote, numero }: { cote: "g" | "d"; numero: 1 | 2 }) {
  const gauche = cote === "g";
  return (
    <div
      className={`absolute bottom-0 flex gap-[5px] pres-tape pres-tape-${numero}`}
      style={{
        [gauche ? "left" : "right"]: 0,
        padding: "14px 16px",
        borderRadius: gauche ? "18px 18px 18px 6px" : "18px 18px 6px 18px",
        background: gauche ? "#ffffff" : "#F97316",
      }}
    >
      {[0, 0.15, 0.3].map((delai) => (
        <span
          key={delai}
          className="inline-block rounded-full pres-point"
          style={{
            width: 7,
            height: 7,
            background: gauche ? "#94A3B8" : "#ffffff",
            animationDelay: `${delai}s`,
          }}
        />
      ))}
    </div>
  );
}

const CONFETTIS = [
  { left: "8%", couleur: "#F97316", dx: -20, rot: 340, delai: 3.7 },
  { left: "18%", couleur: "#ffffff", dx: 14, rot: -280, delai: 3.8, h: 8 },
  { left: "28%", couleur: "#FDBA74", dx: -10, rot: 420, delai: 3.75 },
  { left: "38%", couleur: "#93C5FD", dx: 18, rot: -360, delai: 3.9, w: 6 },
  { left: "48%", couleur: "#F97316", dx: -16, rot: 300, delai: 3.72, h: 8 },
  { left: "52%", couleur: "#93C5FD", dx: 24, rot: 260, delai: 4.0, h: 8 },
  { left: "58%", couleur: "#ffffff", dx: 12, rot: -420, delai: 3.85 },
  { left: "68%", couleur: "#86EFAC", dx: -8, rot: 380, delai: 3.78, w: 6 },
  { left: "78%", couleur: "#FDBA74", dx: 20, rot: -300, delai: 3.95, h: 8 },
  { left: "88%", couleur: "#F97316", dx: -14, rot: 360, delai: 3.82 },
];

function IllustrationMessagerie() {
  return (
    <>
      <Halo taille={260} />
      <div className="absolute inset-0 pointer-events-none">
        {CONFETTIS.map((c) => (
          <span
            key={c.left}
            className="absolute top-0 pres-confetti"
            style={
              {
                left: c.left,
                width: c.w ?? 8,
                height: c.h ?? 12,
                borderRadius: 2,
                background: c.couleur,
                animationDelay: `${c.delai}s`,
                "--dx": `${c.dx}px`,
                "--rot": `${c.rot}deg`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="relative flex flex-col gap-2.5" style={{ width: 300 }}>
        <div className="relative self-start">
          <EnTrainDecrire cote="g" numero={1} />
          <div
            className="bg-white pa pres-bulle-g"
            style={{
              maxWidth: 258, // 230 px de texte + 28 px de marge intérieure (maquette en content-box)
              color: "#1E3A5F",
              padding: "12px 14px",
              borderRadius: "18px 18px 18px 6px",
              fontSize: 14,
              lineHeight: 1.4,
              boxShadow: "0 10px 24px rgba(5,12,30,0.35)",
            }}
          >
            Bonjour, l'appartement de Kipé est-il toujours disponible ?
          </div>
        </div>
        <div className="relative self-end">
          <EnTrainDecrire cote="d" numero={2} />
          <div
            className="text-white font-semibold pa pres-bulle-d"
            style={{
              maxWidth: 258, // 230 px de texte + 28 px de marge intérieure (maquette en content-box)
              background: "#F97316",
              padding: "12px 14px",
              borderRadius: "18px 18px 6px 18px",
              fontSize: 14,
              lineHeight: 1.4,
              boxShadow: "0 10px 24px rgba(249,115,22,0.3)",
            }}
          >
            Oui ! Visite possible samedi à 10 h.
          </div>
        </div>
        <div
          className="mt-1.5 bg-white flex items-center gap-3 pa pres-visite"
          style={{
            color: "#1E3A5F",
            borderRadius: 20,
            padding: "14px 16px",
            boxShadow: "0 16px 32px rgba(5,12,30,0.4)",
            rotate: "-2deg",
          }}
        >
          <span
            className="w-11 h-11 flex items-center justify-center shrink-0 pres-calendrier"
            style={{ borderRadius: 14, background: "#FFF7ED" }}
          >
            <CalendarDays size={22} strokeWidth={2} color="#C2410C" />
          </span>
          <div className="grow">
            <div className="font-semibold" style={{ fontSize: 12, color: "#475569" }}>
              Visite planifiée
            </div>
            <div className="font-extrabold" style={{ fontSize: 15 }}>
              Samedi · 10:00
            </div>
          </div>
          <PastilleVerte icone={15} className="pa pres-ok" />
        </div>
      </div>
    </>
  );
}
