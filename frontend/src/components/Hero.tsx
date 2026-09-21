/**
 * Hero.tsx — Première section de la page d'accueil.
 *
 * Pensé pour un Android d'entrée de gamme sur un réseau lent :
 * - aucune animation pilotée en JS : les keyframes du thème (`apparition`,
 *   `halo`) ne touchent qu'à `transform` et `opacity` et durent moins de 600 ms ;
 * - rien n'attend l'animation : l'accroche, le texte et les boutons sont
 *   lisibles et cliquables dès le premier rendu. Seuls le titre, les cartes et
 *   le halo du fond s'animent, et uniquement via `motion-safe:` ;
 * - photos AVIF avec repli WebP, dimensions fixées : aucun décalage de mise en page.
 */
import type { CSSProperties } from "react";
import { ArrowRight, Home, MapPin, ShieldCheck, Star, Users } from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "../context/AuthContext";
import { formatMontantCourt } from "../lib/format";
import { BadgeCertifie } from "./BadgeVerification";

// `?no-inline` : sous 4 Ko, Vite inclurait l'image en base64 dans le JS.
import appartementAvif1x from "../assets/hero/appartement-256.avif?no-inline";
import appartementAvif2x from "../assets/hero/appartement-512.avif?no-inline";
import appartementWebp1x from "../assets/hero/appartement-256.webp?no-inline";
import appartementWebp2x from "../assets/hero/appartement-512.webp?no-inline";
import studioAvif1x from "../assets/hero/studio-256.avif?no-inline";
import studioAvif2x from "../assets/hero/studio-512.avif?no-inline";
import studioWebp1x from "../assets/hero/studio-256.webp?no-inline";
import studioWebp2x from "../assets/hero/studio-512.webp?no-inline";
import villaAvif1x from "../assets/hero/villa-256.avif?no-inline";
import villaAvif2x from "../assets/hero/villa-512.avif?no-inline";
import villaWebp1x from "../assets/hero/villa-256.webp?no-inline";
import villaWebp2x from "../assets/hero/villa-512.webp?no-inline";

/** Écart entre deux éléments de la cascade. */
const CASCADE_MS = 60;

/**
 * Photos en 8:5, livrées en 256 et 512 px de large. Sur mobile la carte fait
 * 256 px ; à partir de `md`, un tiers d'un conteneur de 1024 px au plus.
 */
const PHOTO = {
  largeur: 256,
  hauteur: 160,
  sizes: "(min-width: 768px) 315px, 256px",
} as const;

const LIGNES_TITRE = [
  { texte: "Votre prochain chez-vous", accent: false },
  { texte: "à Conakry,", accent: false },
  { texte: "en toute confiance.", accent: true },
];

/** Les cartes prennent le relais une fois la dernière ligne du titre lancée. */
const DEPART_CARTES_MS = LIGNES_TITRE.length * CASCADE_MS + CASCADE_MS;

interface LogementVitrine {
  titre: string;
  lieu: string;
  details: string;
  prix: number;
  note: string;
  avis: number;
  photo: { alt: string; avif: [string, string]; webp: [string, string] };
}

/**
 * Annonces d'exemple — présentées comme telles à l'écran. Elles montrent à
 * quoi ressemble une annonce certifiée sans dépendre de l'API : pas d'attente,
 * pas de squelette, pas de saut de mise en page.
 * Photos : Unsplash (licence libre).
 */
const VITRINE: LogementVitrine[] = [
  {
    titre: "Appartement lumineux",
    lieu: "Kipé, Ratoma",
    details: "3 pièces · 85 m²",
    prix: 3_500_000,
    note: "4,8",
    avis: 12,
    photo: {
      alt: "Salon clair avec canapé gris et plantes",
      avif: [appartementAvif1x, appartementAvif2x],
      webp: [appartementWebp1x, appartementWebp2x],
    },
  },
  {
    titre: "Studio meublé",
    lieu: "Camayenne, Dixinn",
    details: "1 pièce · 32 m²",
    prix: 1_800_000,
    note: "4,9",
    avis: 7,
    photo: {
      alt: "Studio avec cuisine ouverte et fauteuil rouge",
      avif: [studioAvif1x, studioAvif2x],
      webp: [studioWebp1x, studioWebp2x],
    },
  },
  {
    titre: "Villa avec piscine",
    lieu: "Lambanyi, Ratoma",
    details: "6 pièces · 240 m²",
    prix: 9_000_000,
    note: "4,7",
    avis: 9,
    photo: {
      alt: "Villa blanche avec piscine et palmiers",
      avif: [villaAvif1x, villaAvif2x],
      webp: [villaWebp1x, villaWebp2x],
    },
  },
];

const largeurs = ([petite, grande]: [string, string]) => `${petite} 256w, ${grande} 512w`;

const delai = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export function Hero() {
  const { user, accueilDuRole } = useAuth();

  return (
    <section
      className="relative overflow-hidden"
      // Dégradé vertical : le bas du hero a exactement la couleur du fond de
      // page à toute largeur, sans ligne de raccord avec la section suivante.
      style={{ background: "linear-gradient(180deg, #0F2040 0%, #1E3A5F 55%, #0F2040 100%)" }}
    >
      {/* Halos du fond : des dégradés radiaux, sans `filter: blur` qui coûte
          cher au GPU. Ils se posent à l'entrée puis restent immobiles. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 -right-32 h-[30rem] w-[30rem] motion-safe:animate-halo"
          style={{ background: "radial-gradient(closest-side, rgba(249,115,22,0.30), transparent)" }}
        />
        <div
          className="absolute top-[42%] -left-40 h-[28rem] w-[28rem] motion-safe:animate-halo"
          style={{
            ...delai(CASCADE_MS),
            background: "radial-gradient(closest-side, rgba(96,165,250,0.18), transparent)",
          }}
        />
      </div>

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-6 pb-2">
        <span className="text-[26px] font-bold tracking-[-0.5px] text-white">tcheyna</span>
        {user ? (
          <Link
            to={accueilDuRole()}
            className="rounded-xl bg-[#F97316]/20 px-4 py-2 text-sm font-semibold text-[#FDBA74]"
          >
            Mon espace
          </Link>
        ) : (
          <Link
            to="/login"
            className="rounded-xl border-[1.5px] border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white"
          >
            Se connecter
          </Link>
        )}
      </header>

      <div className="relative mx-auto w-full max-w-5xl px-5 pt-10 pb-12 md:pt-16 md:pb-20">
        <div className="mx-auto max-w-xl text-center md:max-w-3xl">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#F97316]/30 bg-[#F97316]/15 px-3.5 py-1.5 text-[13px] font-semibold text-[#FDBA74]">
            <ShieldCheck size={14} aria-hidden="true" />
            Vérifié des deux côtés
          </p>

          <h1 className="mb-5 text-[clamp(1.875rem,8.2vw,3.5rem)] leading-[1.12] font-extrabold tracking-tight text-balance text-white">
            {LIGNES_TITRE.map((ligne, i) => (
              <span key={ligne.texte}>
                {/* Espace hors du bloc : il sépare les lignes pour les lecteurs
                    d'écran et les moteurs de recherche, sans effet visuel. */}
                {i > 0 && " "}
                <span
                  className={`block motion-safe:animate-apparition ${ligne.accent ? "text-[#F97316]" : ""}`}
                  style={delai(i * CASCADE_MS)}
                >
                  {ligne.texte}
                </span>
              </span>
            ))}
          </h1>

          <p className="mx-auto mb-8 max-w-md text-base leading-relaxed text-pretty text-white/70">
            Annonces certifiées sur pièces, locataires vérifiés, paiement Mobile Money avec
            reçu. Vous visitez l'esprit tranquille.
          </p>

          <div className="mx-auto flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
            <Link
              to="/onboarding/tenant"
              className="flex min-h-[52px] items-center justify-center gap-3 rounded-2xl bg-[#F97316] px-6 py-4 text-base font-semibold text-white transition-transform active:scale-95"
            >
              <Users size={20} aria-hidden="true" />
              Je cherche un logement
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link
              to="/onboarding/owner"
              className="flex min-h-[52px] items-center justify-center gap-3 rounded-2xl border-[1.5px] border-white/20 bg-white/[0.08] px-6 py-4 text-base font-semibold text-white transition-transform active:scale-95"
            >
              <Home size={20} aria-hidden="true" />
              Je mets en location
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>

          {/* Un utilisateur qui revient ne doit pas passer par l'inscription */}
          {!user && (
            <p className="mt-6 text-[15px] text-white/60">
              Vous avez déjà un compte ?{" "}
              <Link to="/login" className="font-semibold text-[#FDBA74] underline underline-offset-4">
                Connectez-vous
              </Link>
            </p>
          )}
        </div>

        <div className="mt-12 md:mt-16">
          <p
            id="hero-vitrine"
            className="mb-3 text-xs font-semibold tracking-wider text-white/55 uppercase md:text-center"
          >
            Exemples d'annonces certifiées
          </p>

          {/* Sur mobile, les cartes défilent à l'horizontale : la zone doit
              pouvoir prendre le focus pour rester utilisable au clavier. */}
          <div
            role="region"
            aria-labelledby="hero-vitrine"
            tabIndex={0}
            className="-mx-5 snap-x snap-mandatory scroll-px-5 overflow-x-auto px-5 pb-3 focus-visible:outline-offset-[-2px] md:mx-0 md:overflow-visible md:px-0"
          >
            <ul className="flex gap-3 md:grid md:grid-cols-3 md:gap-5">
              {VITRINE.map((logement, i) => (
                <li
                  key={logement.titre}
                  className="w-64 shrink-0 snap-start motion-safe:animate-apparition md:w-auto"
                  style={delai(DEPART_CARTES_MS + i * CASCADE_MS)}
                >
                  <CarteVitrine logement={logement} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function CarteVitrine({ logement }: { logement: LogementVitrine }) {
  const { photo } = logement;

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgba(8,20,40,0.30)]">
      <div className="relative">
        <picture>
          <source type="image/avif" srcSet={largeurs(photo.avif)} sizes={PHOTO.sizes} />
          <img
            src={photo.webp[0]}
            srcSet={largeurs(photo.webp)}
            sizes={PHOTO.sizes}
            alt={photo.alt}
            width={PHOTO.largeur}
            height={PHOTO.hauteur}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full bg-slate-200"
          />
        </picture>
        <span className="absolute top-3 left-3">
          <BadgeCertifie size="sm" />
        </span>
      </div>

      <div className="p-4">
        <h3 className="text-[15px] leading-snug font-bold text-[#1E293B]">{logement.titre}</h3>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
          <MapPin size={12} aria-hidden="true" className="shrink-0" />
          {logement.lieu}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{logement.details}</p>

        <div className="mt-3 flex items-end justify-between gap-2">
          <p>
            <span className="text-lg font-bold text-[#1E3A5F]">{formatMontantCourt(logement.prix)}</span>
            <span className="text-xs text-slate-500"> /mois</span>
          </p>
          <p className="flex items-center gap-1 text-xs font-semibold text-slate-600">
            <Star size={12} aria-hidden="true" fill="#F97316" stroke="#F97316" />
            <span className="sr-only">Propriétaire noté</span>
            {logement.note}
            <span className="sr-only"> sur 5,</span>
            <span className="font-normal text-slate-500">· {logement.avis} avis</span>
          </p>
        </div>
      </div>
    </article>
  );
}
