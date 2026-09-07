/**
 * ListingDetail.tsx — Fiche annonce.
 *
 * Consultable sans compte (acquisition), mais candidater exige un numéro
 * vérifié — et une identité vérifiée si l'annonce est certifiée.
 */
import {
  AirVent,
  ArrowLeft,
  Bed,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Layers,
  MapPin,
  ParkingCircle,
  Share2,
  Shield,
  Sofa,
  Square,
  Star,
  Users,
  Wifi,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { favorisAPI, listingsAPI, matchesAPI } from "../api";
import { Avatar } from "../components/Avatar";
import { BadgeCertifie, BadgeVerification, ScoreMatch } from "../components/BadgeVerification";
import { Chargement, Erreur, MessageErreur } from "../components/Etats";
import { useAuth } from "../context/AuthContext";
import { useAction, useApi } from "../hooks/useApi";
import { formatDate, formatMontant, formatMontantCourt } from "../lib/format";

const IMAGE_PAR_DEFAUT = "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080&q=80";

const EQUIPEMENTS = [
  { cle: "generateur", label: "Groupe électrogène", icone: Zap },
  { cle: "eau", label: "Eau courante", icone: Sofa },
  { cle: "wifi", label: "WiFi", icone: Wifi },
  { cle: "securite", label: "Gardien / clôture", icone: Shield },
  { cle: "parking", label: "Parking", icone: ParkingCircle },
  { cle: "climatisation", label: "Climatisation", icone: AirVent },
] as const;

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement texte="Chargement de l'annonce…" />
      </div>
    );
  }

  if (annonce.erreur || !listing) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
        <div className="px-4 pt-6">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2" style={{ color: "#1E3A5F" }}>
            <ArrowLeft size={20} />
          </button>
        </div>
        <Erreur message={annonce.erreur ?? "Annonce introuvable"} onReessayer={annonce.recharger} />
      </div>
    );
  }

  const photos = listing.images.length ? listing.images : [IMAGE_PAR_DEFAUT];
  const equipementsActifs = EQUIPEMENTS.filter((e) => listing.equipements[e.cle]);
  const dejaCandidat = Boolean(listing.ma_candidature);
  const estLocataire = user?.role === "tenant";
  const niveau = user?.trust_level ?? 0;

  // Le niveau requis dépend de la certification de l'annonce.
  const niveauRequis = listing.is_certified ? 2 : 1;
  const niveauSuffisant = niveau >= niveauRequis;

  return (
    <div className="min-h-screen" style={{ background: "#F0F4FA" }}>
      {/* Carrousel */}
      <div className="relative h-64 sm:h-80">
        <img
          src={photos[indexPhoto]}
          alt={listing.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = IMAGE_PAR_DEFAUT;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-transparent pointer-events-none" />

        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl backdrop-blur-sm"
            style={{ background: "rgba(0,0,0,0.35)", color: "white" }}
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex gap-2">
            <button
              onClick={basculerFavori}
              className="p-2 rounded-xl backdrop-blur-sm"
              style={{ background: "rgba(0,0,0,0.35)" }}
              aria-label={listing.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            >
              <Heart
                size={20}
                fill={listing.is_favorite ? "#F97316" : "none"}
                stroke={listing.is_favorite ? "#F97316" : "white"}
              />
            </button>
            <button
              onClick={partager}
              className="p-2 rounded-xl backdrop-blur-sm"
              style={{ background: "rgba(0,0,0,0.35)", color: "white" }}
              aria-label="Partager l'annonce"
            >
              <Share2 size={20} />
            </button>
          </div>
        </div>

        {photos.length > 1 && (
          <>
            <button
              onClick={() => setIndexPhoto((i) => (i === 0 ? photos.length - 1 : i - 1))}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full backdrop-blur-sm"
              style={{ background: "rgba(0,0,0,0.3)", color: "white" }}
              aria-label="Photo précédente"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setIndexPhoto((i) => (i === photos.length - 1 ? 0 : i + 1))}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full backdrop-blur-sm"
              style={{ background: "rgba(0,0,0,0.3)", color: "white" }}
              aria-label="Photo suivante"
            >
              <ChevronRight size={18} />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className="rounded-full transition-all"
                  style={{
                    width: i === indexPhoto ? "20px" : "6px",
                    height: "6px",
                    background: i === indexPhoto ? "white" : "rgba(255,255,255,0.5)",
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div className="absolute bottom-4 left-4 flex gap-2">
          {listing.is_certified && <BadgeCertifie size="sm" />}
          <ScoreMatch score={listing.score_compatibilite} />
        </div>
      </div>

      {partage && (
        <div
          className="mx-4 mt-3 px-4 py-2.5 rounded-xl text-sm font-medium text-center"
          style={{ background: "#ECFDF5", color: "#065F46" }}
        >
          {partage}
        </div>
      )}

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* Titre et caractéristiques */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <h1 className="font-bold" style={{ color: "#1E293B", fontSize: "18px", lineHeight: 1.35 }}>
              {listing.title}
            </h1>
            <div className="flex-shrink-0 text-right">
              <div className="font-bold" style={{ color: "#1E3A5F", fontSize: "19px" }}>
                {formatMontantCourt(listing.prix, listing.devise)}
              </div>
              <div className="text-xs text-gray-400">/mois</div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-gray-500 text-sm mb-1">
            <MapPin size={14} />
            {listing.adresse ?? `${listing.quartier ?? ""}, ${listing.ville}`}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
            <span className="flex items-center gap-1">
              <Eye size={12} />
              {listing.views_count} vue{listing.views_count > 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Users size={12} />
              {listing.nb_candidatures} candidature{listing.nb_candidatures > 1 ? "s" : ""}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              { icone: Square, valeur: listing.superficie ? `${listing.superficie} m²` : "—", label: "Surface" },
              { icone: Bed, valeur: `${listing.nb_pieces}P`, label: "Pièces" },
              { icone: Layers, valeur: listing.etage != null ? `Ét. ${listing.etage}` : "—", label: "Étage" },
              { icone: Sofa, valeur: listing.meuble ? "Oui" : "Non", label: "Meublé" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center text-center">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-1"
                  style={{ background: "#F0F4FA" }}
                >
                  <item.icone size={16} style={{ color: "#1E3A5F" }} />
                </div>
                <span className="font-bold text-sm" style={{ color: "#1E293B" }}>
                  {item.valeur}
                </span>
                <span className="text-xs text-gray-400">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Compatibilité détaillée */}
        {listing.details_compatibilite && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold" style={{ color: "#1E293B" }}>
                Votre compatibilité
              </h2>
              <ScoreMatch score={listing.score_compatibilite} />
            </div>
            <div className="space-y-2.5">
              {listing.details_compatibilite.map((detail) => (
                <div key={detail.critere}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span style={{ color: "#334155" }}>{detail.critere}</span>
                    <span className="text-xs text-gray-400">{detail.libelle}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(detail.points / detail.max) * 100}%`,
                        background: detail.points === detail.max ? "#10B981" : detail.points > 0 ? "#F97316" : "#E2E8F0",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <h2 className="font-bold mb-3" style={{ color: "#1E293B" }}>
            Description
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">
            {listing.description}
          </p>
        </div>

        {/* Équipements */}
        {equipementsActifs.length > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-3" style={{ color: "#1E293B" }}>
              Équipements
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              {equipementsActifs.map((eq) => (
                <div key={eq.cle} className="flex items-center gap-2">
                  <eq.icone size={16} style={{ color: "#10B981", flexShrink: 0 }} />
                  <span className="text-sm text-gray-600">{eq.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disponibilité */}
        {listing.disponible_a_partir && (
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "#ECFDF5", border: "1.5px solid #A7F3D0" }}
          >
            <Calendar size={20} style={{ color: "#059669", flexShrink: 0 }} />
            <p className="text-sm font-semibold" style={{ color: "#065F46" }}>
              Disponible à partir du {formatDate(listing.disponible_a_partir)}
            </p>
          </div>
        )}

        {/* Propriétaire */}
        {listing.landlord && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-4" style={{ color: "#1E293B" }}>
              Propriétaire
            </h2>
            <Link to={`/profil/${listing.landlord.id}`} className="flex items-center gap-4">
              <Avatar
                nom={listing.landlord.full_name}
                url={listing.landlord.avatar_url}
                taille={56}
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold" style={{ color: "#1E293B" }}>
                  {listing.landlord.full_name}
                </p>
                <div className="mt-1">
                  <BadgeVerification level={listing.landlord.trust_level} size="sm" />
                </div>
                {listing.landlord.note_moyenne != null && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <Star size={13} style={{ color: "#F59E0B" }} />
                    <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>
                      {listing.landlord.note_moyenne}
                    </span>
                    <span className="text-xs text-gray-400">({listing.landlord.nb_avis} avis)</span>
                  </div>
                )}
              </div>
              <ChevronRight size={18} style={{ color: "#CBD5E1", flexShrink: 0 }} />
            </Link>
          </div>
        )}

        {/* Coût d'entrée */}
        <div className="rounded-2xl p-4" style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA" }}>
          <p className="text-sm font-semibold mb-2" style={{ color: "#92400E" }}>
            Coût d'entrée estimé
          </p>
          <div className="space-y-1.5">
            <Ligne label="Premier loyer" valeur={formatMontant(listing.prix, listing.devise)} />
            {listing.charges > 0 && (
              <Ligne label="Charges" valeur={formatMontant(listing.charges, listing.devise)} />
            )}
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
          <p className="text-xs mt-2.5 leading-relaxed" style={{ color: "#C2410C" }}>
            Payable par Mobile Money via Tcheyna, avec reçu numérique pour les deux parties.
          </p>
        </div>
      </div>

      {/* Barre d'action */}
      <div
        className="sticky bottom-0 px-4 py-4 border-t border-gray-200"
        style={{ background: "#F0F4FA" }}
      >
        {listing.is_owner ? (
          <Link
            to={`/owner/listings/${listing.id}`}
            className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2"
            style={{ background: "#1E3A5F", fontSize: "16px" }}
          >
            Gérer mon annonce
          </Link>
        ) : dejaCandidat ? (
          <div
            className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-white font-semibold text-center px-4"
            style={{ background: listing.ma_candidature!.status === "rejected" ? "#94A3B8" : "#10B981", fontSize: "15px" }}
          >
            <CheckCircle size={19} />
            {
              {
                pending: "Candidature envoyée — en attente de réponse",
                accepted: "Candidature acceptée !",
                rejected: "Candidature non retenue",
                completed: "Location conclue",
                cancelled: "Candidature retirée",
              }[listing.ma_candidature!.status]
            }
          </div>
        ) : !user ? (
          <Link
            to="/inscription"
            className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
            style={{ background: "#F97316", fontSize: "16px" }}
          >
            Créer un compte pour candidater
          </Link>
        ) : !estLocataire ? (
          <p className="text-center text-sm text-gray-500 py-2">
            Seuls les comptes locataires peuvent candidater.
          </p>
        ) : !niveauSuffisant ? (
          <Link
            to="/tenant/profile"
            className="w-full py-4 rounded-2xl font-semibold text-white flex flex-col items-center justify-center transition-transform active:scale-[0.98]"
            style={{ background: "#1E3A5F" }}
          >
            <span style={{ fontSize: "15px" }}>
              {niveauRequis === 2 ? "Vérifiez votre identité" : "Vérifiez votre téléphone"}
            </span>
            <span className="text-xs font-normal text-white/60 mt-0.5">
              {niveauRequis === 2
                ? "Les annonces certifiées demandent le niveau 2"
                : "Requis pour candidater"}
            </span>
          </Link>
        ) : formulaireOuvert ? (
          <div className="space-y-3">
            <textarea
              value={messageCandidature}
              onChange={(e) => setMessageCandidature(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Présentez-vous en quelques lignes : situation, date d'emménagement souhaitée…"
              aria-label="Message de candidature"
              className="w-full px-4 py-3 rounded-xl outline-none resize-none"
              style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "14px" }}
            />
            <MessageErreur message={candidature.erreur} />
            <div className="flex gap-3">
              <button
                onClick={() => setFormulaireOuvert(false)}
                className="flex-1 py-3.5 rounded-2xl font-semibold"
                style={{ background: "#E2E8F0", color: "#475569" }}
              >
                Annuler
              </button>
              <button
                onClick={envoyerCandidature}
                disabled={candidature.enCours}
                className="flex-[2] py-3.5 rounded-2xl font-semibold text-white disabled:opacity-60"
                style={{ background: "#F97316" }}
              >
                {candidature.enCours ? "Envoi…" : "Envoyer ma candidature"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setFormulaireOuvert(true)}
            className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
            style={{ background: "#F97316", fontSize: "16px" }}
          >
            Je suis intéressé(e)
          </button>
        )}
      </div>
    </div>
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
