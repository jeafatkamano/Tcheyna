/**
 * ListingDetail.tsx — Fiche annonce (maquette Annonce, lot 3.15a).
 *
 * Consultable sans compte (acquisition), mais candidater exige un numéro
 * vérifié — et une identité vérifiée si l'annonce est certifiée.
 *
 * La photo passe sous la barre d'état, avec retour, partage et favori en
 * boutons ronds blancs ; une fiche arrondie remonte dessus ; la barre du bas
 * porte le prix et l'action (candidater, contacter le vendeur, ou la raison
 * pour laquelle ce n'est pas possible).
 */
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  MapPin,
  Share2,
  Star,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { favorisAPI, listingsAPI, matchesAPI, urlFichier } from "../api";
import { Avatar } from "../components/Avatar";
import { BadgeCertifie, BadgeProprietaireVerifie, BadgeVerification } from "../components/BadgeVerification";
import { Chargement, Erreur, MessageErreur } from "../components/Etats";
import { Pastille } from "../components/Pastille";
import { PhotoAnnonce } from "../components/PhotoAnnonce";
import { useAuth } from "../context/AuthContext";
import { useAction, useApi } from "../hooks/useApi";
import { formatDate, formatMontant, formatMontantCourt, labelTransaction } from "../lib/format";
import { HAUTEUR_REPLI, LARGEUR_REPLI } from "../lib/imageRepli";

/** Photo du carrousel : pleine largeur de l'écran. */
const TAILLES_CARROUSEL = "100vw";
const TEXTE_SECONDAIRE = "#475569";

const EQUIPEMENTS = [
  { cle: "generateur", label: "Groupe électrogène" },
  { cle: "eau", label: "Eau courante" },
  { cle: "wifi", label: "WiFi" },
  { cle: "securite", label: "Gardien / clôture" },
  { cle: "parking", label: "Parking" },
  { cle: "climatisation", label: "Climatisation" },
] as const;

const LIBELLES_CANDIDATURE = {
  pending: "Candidature envoyée — en attente de réponse",
  accepted: "Candidature acceptée !",
  rejected: "Candidature non retenue",
  completed: "Location conclue",
  cancelled: "Candidature retirée",
} as const;

/** Bouton rond blanc posé sur la photo (maquette : 44 px, blanc à 95 %). */
function BoutonPhoto({ libelle, onClick, children }: { libelle: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={libelle}
      className="w-11 h-11 rounded-full flex items-center justify-center shadow-sm"
      style={{ background: "rgba(255,255,255,0.95)", color: "#1E3A5F" }}
    >
      {children}
    </button>
  );
}

/** Carte blanche d'une section de la fiche. */
function Section({ titre, children, droite }: { titre: string; children: ReactNode; droite?: ReactNode }) {
  return (
    <section className="bg-white" style={{ padding: 18, borderRadius: 20 }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="m-0 font-extrabold" style={{ fontSize: 16, color: "#1E293B" }}>
          {titre}
        </h2>
        {droite}
      </div>
      {children}
    </section>
  );
}

function etage(valeur: number | null | undefined) {
  if (valeur == null) return "—";
  return valeur === 0 ? "RDC" : `${valeur}e`;
}

export function ListingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [indexPhoto, setIndexPhoto] = useState(0);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [messageCandidature, setMessageCandidature] = useState("");
  const [partage, setPartage] = useState<string | null>(null);

  const annonce = useApi(() => listingsAPI.detail(id!), [id], { actif: Boolean(id) });
  const candidature = useAction(matchesAPI.candidater);

  const listing = annonce.data;

  async function basculerFavori() {
    if (!listing) return;
    if (!user) return navigate("/login", { state: { from: `/listing/${listing.id}` } });

    annonce.muter((p) => ({ ...p, is_favorite: !p.is_favorite }));
    try {
      await (listing.is_favorite ? favorisAPI.retirer(listing.id) : favorisAPI.ajouter(listing.id));
    } catch {
      annonce.muter((p) => ({ ...p, is_favorite: listing.is_favorite }));
    }
  }

  async function partager() {
    const url = window.location.href;
    // `navigator.share` n'existe pas partout : on retombe sur le presse-papiers.
    if (navigator.share) {
      try {
        await navigator.share({ title: listing?.title, url });
        return;
      } catch {
        /* partage annulé par l'utilisateur */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setPartage("Lien copié");
      setTimeout(() => setPartage(null), 2500);
    } catch {
      setPartage("Copie impossible sur ce navigateur");
      setTimeout(() => setPartage(null), 2500);
    }
  }

  async function envoyerCandidature() {
    if (!listing) return;
    const reponse = await candidature.executer(listing.id, messageCandidature.trim() || undefined);
    if (reponse) {
      setFormulaireOuvert(false);
      await annonce.recharger();
    }
  }

  if (annonce.chargement) {
    return (
      <div className="sous-barre-etat min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement texte="Chargement de l'annonce…" />
      </div>
    );
  }

  if (annonce.erreur || !listing) {
    return (
      <div className="sous-barre-etat min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
        <div className="px-4 pt-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-11 h-11 -ml-2.5 flex items-center justify-center"
            style={{ color: "#1E3A5F" }}
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
        </div>
        <Erreur message={annonce.erreur ?? "Annonce introuvable"} onReessayer={annonce.recharger} />
      </div>
    );
  }

  // `undefined` : annonce sans photo, l'image de repli locale s'affiche.
  const photos: (string | undefined)[] = listing.images.length ? listing.images : [undefined];
  const equipementsActifs = EQUIPEMENTS.filter((e) => listing.equipements[e.cle]);
  const dejaCandidat = Boolean(listing.ma_candidature);
  const estLocataire = user?.role === "tenant";
  const niveau = user?.trust_level ?? 0;

  // Le niveau requis dépend de la certification de l'annonce.
  const niveauRequis = listing.is_certified ? 2 : 1;
  const niveauSuffisant = niveau >= niveauRequis;
  const libelleAction = listing.est_vente ? "Contacter le vendeur" : "Envoyer ma candidature";
  const lieu = listing.adresse ?? [listing.quartier, listing.ville].filter(Boolean).join(", ");

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "#F0F4FA" }}>
      {/* Photo : passe sous la barre d'état */}
      <div className="relative h-[300px] shrink-0">
        {/* Pas de lazy : première image visible de la page. */}
        <PhotoAnnonce
          url={urlFichier(photos[indexPhoto])}
          tailles={TAILLES_CARROUSEL}
          alt={listing.title}
          width={LARGEUR_REPLI}
          height={HAUTEUR_REPLI}
          className="w-full h-full object-cover"
          decoding="async"
        />
        <div
          className="absolute inset-x-0 top-0 h-[120px] pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(15,32,64,0.45) 0%, rgba(15,32,64,0) 100%)" }}
        />

        <div
          className="absolute left-4 right-4 flex items-center justify-between"
          style={{ top: "calc(12px + var(--inset-haut))" }}
        >
          <BoutonPhoto libelle="Retour" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} aria-hidden="true" />
          </BoutonPhoto>
          <div className="flex gap-2.5">
            <BoutonPhoto libelle="Partager l'annonce" onClick={partager}>
              <Share2 size={19} aria-hidden="true" />
            </BoutonPhoto>
            <BoutonPhoto
              libelle={listing.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              onClick={basculerFavori}
            >
              <Heart
                size={20}
                fill={listing.is_favorite ? "#F97316" : "none"}
                stroke={listing.is_favorite ? "#F97316" : "#1E3A5F"}
                aria-hidden="true"
              />
            </BoutonPhoto>
          </div>
        </div>

        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndexPhoto((i) => (i === 0 ? photos.length - 1 : i - 1))}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: "rgba(15,32,64,0.45)", color: "white" }}
              aria-label="Photo précédente"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setIndexPhoto((i) => (i === photos.length - 1 ? 0 : i + 1))}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: "rgba(15,32,64,0.45)", color: "white" }}
              aria-label="Photo suivante"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <span
              className="absolute right-4 rounded-full text-white font-bold"
              style={{ bottom: 40, padding: "5px 10px", background: "rgba(15,32,64,0.7)", fontSize: 12 }}
              aria-live="polite"
            >
              <span className="sr-only">Photo </span>
              {indexPhoto + 1} / {photos.length}
            </span>
          </>
        )}
      </div>

      {/* Fiche : remonte sur la photo */}
      <div
        className="relative grow flex flex-col gap-4 px-5 pb-5"
        style={{ marginTop: -24, paddingTop: 22, borderRadius: "26px 26px 0 0", background: "#F0F4FA" }}
      >
        {partage && (
          <div
            role="status"
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-center"
            style={{ background: "#ECFDF5", color: "#065F46" }}
          >
            {partage}
          </div>
        )}

        <div>
          <div className="flex flex-wrap gap-2 mb-2.5">
            {listing.is_certified && <BadgeCertifie size="sm" />}
            {listing.score_compatibilite != null && (
              <span
                className="rounded-full font-extrabold"
                style={{ padding: "5px 10px", background: "#DCFCE7", color: "#047857", fontSize: 12 }}
              >
                {listing.score_compatibilite} % compatible
              </span>
            )}
            {listing.est_vente && (
              <span
                className="rounded-full font-bold text-white"
                style={{ padding: "5px 10px", background: "#1D4ED8", fontSize: 12 }}
              >
                {labelTransaction(true)}
              </span>
            )}
          </div>
          <h1 className="m-0 font-extrabold" style={{ fontSize: 24, lineHeight: 1.2, color: "#1E293B" }}>
            {listing.title}
          </h1>
          <p className="m-0 mt-1.5 flex items-center gap-1.5" style={{ fontSize: 14, color: TEXTE_SECONDAIRE }}>
            <MapPin size={16} className="shrink-0" aria-hidden="true" />
            {lieu}
            {listing.adresse_masquee && " · adresse après acceptation"}
          </p>
          <p className="m-0 mt-1.5 flex items-center gap-3" style={{ fontSize: 12, color: "#64748B" }}>
            <span className="flex items-center gap-1">
              <Eye size={12} aria-hidden="true" />
              {listing.views_count} vue{listing.views_count > 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Users size={12} aria-hidden="true" />
              {listing.nb_candidatures} candidature{listing.nb_candidatures > 1 ? "s" : ""}
            </span>
          </p>
        </div>

        {/* Caractéristiques */}
        <dl className="m-0 grid grid-cols-4 gap-2">
          {[
            { label: "Surface", valeur: listing.superficie ? `${listing.superficie} m²` : "—" },
            { label: "Pièces", valeur: listing.nb_pieces != null ? String(listing.nb_pieces) : "—" },
            { label: "Étage", valeur: etage(listing.etage) },
            { label: "Meublé", valeur: listing.meuble ? "Oui" : "Non" },
          ].map((c) => (
            <div key={c.label} className="bg-white text-center flex flex-col-reverse" style={{ padding: "12px 6px", borderRadius: 16 }}>
              <dt style={{ fontSize: 11, color: TEXTE_SECONDAIRE, marginTop: 2 }}>{c.label}</dt>
              <dd className="m-0 font-extrabold" style={{ fontSize: 15, color: "#1E3A5F" }}>
                {c.valeur}
              </dd>
            </div>
          ))}
        </dl>

        {/* Équipements */}
        {equipementsActifs.length > 0 && (
          <div>
            <h2 className="m-0 mb-2.5 font-extrabold" style={{ fontSize: 16, color: "#1E293B" }}>
              Équipements
            </h2>
            <div className="flex flex-wrap gap-2">
              {equipementsActifs.map((eq) => (
                <Pastille key={eq.cle} forme="etiquette">
                  {eq.label}
                </Pastille>
              ))}
            </div>
          </div>
        )}

        {/* Compatibilité détaillée */}
        {listing.details_compatibilite && (
          <Section
            titre="Votre compatibilité"
            droite={
              listing.score_compatibilite != null ? (
                <span className="font-extrabold" style={{ fontSize: 14, color: "#047857" }}>
                  {listing.score_compatibilite} %
                </span>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-2.5">
              {listing.details_compatibilite.map((detail) => (
                <div key={detail.critere}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span style={{ color: "#334155" }}>{detail.critere}</span>
                    <span className="text-xs" style={{ color: "#64748B" }}>
                      {detail.libelle}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(detail.points / detail.max) * 100}%`,
                        background:
                          detail.points === detail.max ? "#10B981" : detail.points > 0 ? "#F97316" : "#E2E8F0",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Description */}
        <Section titre="Description">
          <p className="m-0 text-sm leading-relaxed whitespace-pre-line" style={{ color: "#334155" }}>
            {listing.description}
          </p>
        </Section>

        {/* Disponibilité */}
        {listing.disponible_a_partir && (
          <div
            className="flex items-center gap-3"
            style={{ padding: 16, borderRadius: 20, background: "#ECFDF5", border: "1.5px solid #A7F3D0" }}
          >
            <Calendar size={20} style={{ color: "#047857", flexShrink: 0 }} aria-hidden="true" />
            <p className="m-0 text-sm font-semibold" style={{ color: "#065F46" }}>
              Disponible à partir du {formatDate(listing.disponible_a_partir)}
            </p>
          </div>
        )}

        {/* Propriétaire */}
        {listing.landlord && (
          <Section titre="Propriétaire">
            <Link to={`/profil/${listing.landlord.id}`} className="flex items-center gap-4 no-underline">
              <Avatar nom={listing.landlord.full_name} url={listing.landlord.avatar_url} taille={56} forme="rond" />
              <div className="flex-1 min-w-0">
                <p className="m-0 font-bold" style={{ color: "#1E293B" }}>
                  {listing.landlord.full_name}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <BadgeVerification level={listing.landlord.trust_level} size="sm" />
                  <BadgeProprietaireVerifie utilisateur={listing.landlord} />
                </div>
                {listing.landlord.note_moyenne != null && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <Star size={13} style={{ color: "#B45309" }} aria-hidden="true" />
                    <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>
                      {listing.landlord.note_moyenne}
                    </span>
                    <span className="text-xs" style={{ color: "#64748B" }}>
                      ({listing.landlord.nb_avis} avis)
                    </span>
                  </div>
                )}
              </div>
              <ChevronRight size={18} style={{ color: "#94A3B8", flexShrink: 0 }} aria-hidden="true" />
            </Link>
          </Section>
        )}

        {/* Prix de vente : il n'y a ni loyer, ni caution, ni coût d'entrée. */}
        {listing.est_vente && (
          <div style={{ padding: 16, borderRadius: 20, background: "#EFF6FF", border: "1.5px solid #BFDBFE" }}>
            <p className="m-0 text-sm font-semibold mb-2" style={{ color: "#1E3070" }}>
              Bien à vendre
            </p>
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: "#1D4ED8" }}>
                Prix demandé
              </span>
              <span className="text-sm font-bold" style={{ color: "#1E3070" }}>
                {formatMontant(listing.prix, listing.devise)}
              </span>
            </div>
            <p className="m-0 text-xs mt-2.5 leading-relaxed" style={{ color: "#1D4ED8" }}>
              La cession se conclut devant notaire, hors plateforme. Tcheyna vous met en relation avec le vendeur et
              conserve la trace de vos échanges.
            </p>
          </div>
        )}

        {/* Coût d'entrée */}
        {!listing.est_vente && (
          <div style={{ padding: 16, borderRadius: 20, background: "#FFF7ED", border: "1.5px solid #FED7AA" }}>
            <p className="m-0 text-sm font-semibold mb-2" style={{ color: "#92400E" }}>
              Coût d'entrée estimé
            </p>
            <div className="flex flex-col gap-1.5">
              <Ligne label="Premier loyer" valeur={formatMontant(listing.prix, listing.devise)} />
              {listing.charges > 0 && <Ligne label="Charges" valeur={formatMontant(listing.charges, listing.devise)} />}
              {listing.caution != null && (
                <Ligne label="Dépôt de garantie" valeur={formatMontant(listing.caution, listing.devise)} />
              )}
            </div>
            <div className="border-t border-orange-200 mt-2.5 pt-2.5 flex justify-between">
              <span className="text-sm font-semibold" style={{ color: "#9A3412" }}>
                Total
              </span>
              <span className="text-sm font-bold" style={{ color: "#7C2D12" }}>
                {formatMontant(listing.cout_entree, listing.devise)}
              </span>
            </div>
            <p className="m-0 text-xs mt-2.5 leading-relaxed" style={{ color: "#C2410C" }}>
              À régler directement au propriétaire : Tcheyna n'encaisse ni la caution ni le loyer.
            </p>
          </div>
        )}
      </div>

      {/* Barre du bas : prix et action, au-dessus de la barre de gestes */}
      <div
        className="sticky bottom-0 z-10 bg-white"
        style={{
          padding: "14px 20px",
          paddingBottom: "calc(14px + var(--inset-bas))",
          boxShadow: "0 -8px 24px rgba(15,32,64,0.08)",
        }}
      >
        {formulaireOuvert ? (
          <div className="flex flex-col gap-3">
            <textarea
              value={messageCandidature}
              onChange={(e) => setMessageCandidature(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={
                listing.est_vente
                  ? "Présentez-vous et dites ce qui vous intéresse : financement, délai d'acquisition, visite souhaitée…"
                  : "Présentez-vous en quelques lignes : situation, date d'emménagement souhaitée…"
              }
              aria-label={listing.est_vente ? "Message au vendeur" : "Message de candidature"}
              className="w-full px-4 py-3 rounded-2xl outline-none resize-none"
              style={{ background: "#F8FAFC", border: "1.5px solid #CBD5E1", fontSize: 14 }}
            />
            <MessageErreur message={candidature.erreur} />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFormulaireOuvert(false)}
                className="flex-1 h-[54px] rounded-2xl font-bold"
                style={{ background: "#F0F4FA", color: TEXTE_SECONDAIRE }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={envoyerCandidature}
                disabled={candidature.enCours}
                className="flex-[2] h-[54px] rounded-2xl font-bold text-white disabled:opacity-60"
                style={{ background: "#F97316", fontSize: 15 }}
              >
                {candidature.enCours ? "Envoi…" : libelleAction}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            <div className="shrink-0">
              <div className="font-extrabold" style={{ fontSize: 18, color: "#1E3A5F" }}>
                {formatMontantCourt(listing.prix, listing.devise)}
              </div>
              <div style={{ fontSize: 12, color: TEXTE_SECONDAIRE }}>
                {listing.est_vente ? "prix de vente" : "par mois"}
              </div>
            </div>
            <div className="grow min-w-0">
              <Action
                listing={listing}
                connecte={Boolean(user)}
                estLocataire={estLocataire}
                niveauSuffisant={niveauSuffisant}
                niveauRequis={niveauRequis}
                dejaCandidat={dejaCandidat}
                libelle={libelleAction}
                onOuvrir={() => setFormulaireOuvert(true)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type DetailAnnonce = Awaited<ReturnType<typeof listingsAPI.detail>>;

/** Action de la barre du bas, selon le visiteur et l'état de sa candidature. */
function Action({
  listing,
  connecte,
  estLocataire,
  niveauSuffisant,
  niveauRequis,
  dejaCandidat,
  libelle,
  onOuvrir,
}: {
  listing: DetailAnnonce;
  connecte: boolean;
  estLocataire: boolean;
  niveauSuffisant: boolean;
  niveauRequis: number;
  dejaCandidat: boolean;
  libelle: string;
  onOuvrir: () => void;
}) {
  const bouton = "w-full h-[54px] rounded-2xl font-bold text-white flex items-center justify-center text-center";

  if (listing.is_owner) {
    return (
      <Link to={`/owner/listings/${listing.id}`} className={bouton} style={{ background: "#1E3A5F", fontSize: 15 }}>
        Gérer mon annonce
      </Link>
    );
  }
  if (dejaCandidat) {
    const statut = listing.ma_candidature!.status;
    return (
      <div
        role="status"
        className={`${bouton} gap-2 px-3 leading-tight`}
        style={{ background: statut === "rejected" ? "#64748B" : "#047857", fontSize: 14 }}
      >
        <CheckCircle size={18} className="shrink-0" aria-hidden="true" />
        {LIBELLES_CANDIDATURE[statut]}
      </div>
    );
  }
  if (!connecte) {
    return (
      <Link to="/inscription" className={`${bouton} px-3 leading-tight`} style={{ background: "#F97316", fontSize: 14 }}>
        {listing.est_vente ? "Créer un compte pour contacter le vendeur" : "Créer un compte pour candidater"}
      </Link>
    );
  }
  if (!estLocataire) {
    return (
      <p className="m-0 text-sm text-center" style={{ color: TEXTE_SECONDAIRE }}>
        {listing.est_vente
          ? "Seuls les comptes locataires peuvent contacter le vendeur."
          : "Seuls les comptes locataires peuvent candidater."}
      </p>
    );
  }
  if (!niveauSuffisant) {
    return (
      <Link
        to="/tenant/profile"
        className={`${bouton} flex-col leading-tight`}
        style={{ background: "#1E3A5F", height: "auto", minHeight: 54, padding: "8px 12px" }}
      >
        <span style={{ fontSize: 14 }}>{niveauRequis === 2 ? "Vérifiez votre identité" : "Vérifiez votre téléphone"}</span>
        <span className="font-normal" style={{ fontSize: 12, color: "rgba(255,255,255,0.78)" }}>
          {niveauRequis === 2 ? "Les annonces certifiées demandent le niveau 2" : "Requis pour candidater"}
        </span>
      </Link>
    );
  }
  return (
    <button type="button" onClick={onOuvrir} className={bouton} style={{ background: "#F97316", fontSize: 15 }}>
      {libelle}
    </button>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs" style={{ color: "#C2410C" }}>
        {label}
      </span>
      <span className="text-xs font-bold" style={{ color: "#7C2D12" }}>
        {valeur}
      </span>
    </div>
  );
}
