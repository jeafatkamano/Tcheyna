/**
 * TenantDashboard.tsx — Accueil du locataire (maquette Accueil, lot 3.15a).
 *
 * En-tête bleu nuit arrondi (avatar qui ouvre le menu, « Bonjour, <prénom> »,
 * cloche), carte « Score de dossier » qui chevauche l'en-tête, alerte du
 * numéro à vérifier, deux raccourcis, « Pour vous » en défilement horizontal.
 */
import { ChevronRight, ClipboardList, Search, ShieldAlert } from "lucide-react";
import { Link } from "react-router";

import { favorisAPI, listingsAPI, passportAPI, type Listing } from "../../api";
import { BadgeVerification } from "../../components/BadgeVerification";
import { BoutonMenuAvatar, BoutonNotifications, EnTetePage } from "../../components/EnTetePage";
import { Erreur, ListeVide } from "../../components/Etats";
import { ListingCard } from "../../components/ListingCard";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { transitionPage } from "../../lib/transitions";

const TEXTE_SECONDAIRE = "#475569";

/** Anneau de progression du score de dossier (maquette : 76 px, orange). */
function AnneauScore({ score }: { score: number }) {
  const valeur = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div
      role="img"
      aria-label={`Score de dossier : ${valeur} sur 100`}
      className="w-[76px] h-[76px] rounded-full flex items-center justify-center shrink-0"
      style={{ background: `conic-gradient(#F97316 0 ${valeur}%, #E2E8F0 ${valeur}% 100%)` }}
    >
      <div
        className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center font-extrabold"
        style={{ fontSize: 19, color: "#1E3A5F" }}
        aria-hidden="true"
      >
        {valeur}%
      </div>
    </div>
  );
}

export function TenantDashboard() {
  const { user } = useAuth();

  const passeport = useApi(() => passportAPI.recuperer(), []);
  const recommandations = useApi(() => listingsAPI.recommandations(6), []);

  async function basculerFavori(listing: Listing) {
    // Optimiste : le cœur réagit immédiatement, on corrige si l'API refuse.
    recommandations.muter((precedent) => ({
      ...precedent,
      listings: precedent.listings.map((l) =>
        l.id === listing.id ? { ...l, is_favorite: !l.is_favorite } : l,
      ),
    }));
    try {
      await (listing.is_favorite ? favorisAPI.retirer(listing.id) : favorisAPI.ajouter(listing.id));
    } catch {
      recommandations.muter((precedent) => ({
        ...precedent,
        listings: precedent.listings.map((l) =>
          l.id === listing.id ? { ...l, is_favorite: listing.is_favorite } : l,
        ),
      }));
    }
  }

  const niveau = user?.trust_level ?? 0;
  const score = passeport.data?.score ?? 0;
  const etapes = passeport.data?.etapes ?? [];
  const prochaineEtape = etapes.find((e) => !e.fait);
  const prenom = user?.full_name?.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="pb-6">
      <EnTetePage
        arrondi
        chevauchement={54}
        gauche={<BoutonMenuAvatar nom={user?.full_name} url={user?.avatar_url} />}
        titre={
          <div className="min-w-0">
            <p className="m-0" style={{ fontSize: 14, color: "rgba(255,255,255,0.78)" }}>
              Bonjour,
            </p>
            <h1 className="m-0 font-extrabold truncate" style={{ fontSize: 20 }}>
              {prenom}
            </h1>
          </div>
        }
        droite={<BoutonNotifications />}
      >
        <div>
          <BadgeVerification level={niveau} size="sm" />
        </div>
      </EnTetePage>

      <div className="px-5 flex flex-col gap-4" style={{ marginTop: -52 }}>
        {/* Score de dossier et prochaine étape */}
        <Link
          to="/tenant/profile"
          className="flex items-center gap-4 bg-white no-underline"
          style={{ padding: 18, borderRadius: 22, boxShadow: "0 10px 30px rgba(15,32,64,0.12)", color: "#1E293B" }}
        >
          <AnneauScore score={score} />
          <div className="min-w-0">
            <p className="m-0 font-extrabold" style={{ fontSize: 15, color: "#1E3A5F" }}>
              Score de dossier
            </p>
            {prochaineEtape ? (
              <>
                <p className="m-0 mt-1" style={{ fontSize: 13, lineHeight: 1.4, color: TEXTE_SECONDAIRE }}>
                  Prochaine étape : {prochaineEtape.titre}
                </p>
                <p className="m-0 mt-1.5 font-bold" style={{ fontSize: 13, color: "#C2410C" }}>
                  Compléter mon dossier →
                </p>
              </>
            ) : (
              <p className="m-0 mt-1" style={{ fontSize: 13, lineHeight: 1.4, color: TEXTE_SECONDAIRE }}>
                Dossier complet. Vous êtes prioritaire auprès des propriétaires.
              </p>
            )}
          </div>
        </Link>

        {/* Alerte si le téléphone n'est pas vérifié */}
        {niveau === 0 && (
          <Link
            to="/tenant/profile"
            className="flex items-center gap-3 no-underline"
            style={{ padding: 16, borderRadius: 18, background: "#FFF7ED", border: "1.5px solid #FED7AA" }}
          >
            <span
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "#FFEDD5" }}
            >
              <ShieldAlert size={20} style={{ color: "#C2410C" }} aria-hidden="true" />
            </span>
            <span className="grow min-w-0">
              <span className="block font-bold" style={{ fontSize: 14, color: "#9A3412" }}>
                Vérifiez votre numéro de téléphone
              </span>
              <span className="block" style={{ fontSize: 12, color: "#C2410C" }}>
                Indispensable pour candidater aux annonces.
              </span>
            </span>
            <ChevronRight size={18} style={{ color: "#C2410C", flexShrink: 0 }} aria-hidden="true" />
          </Link>
        )}

        {/* Raccourcis */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { to: "/tenant/listings", icone: Search, fond: "#FFF7ED", couleur: "#C2410C", texte: "Rechercher" },
            { to: "/tenant/matches", icone: ClipboardList, fond: "#EFF6FF", couleur: "#1E3A5F", texte: "Candidatures" },
          ].map((r) => (
            <Link
              key={r.to}
              to={r.to}
              viewTransition={transitionPage()}
              className="flex items-center gap-2.5 bg-white font-bold no-underline"
              style={{ padding: 14, borderRadius: 18, color: "#1E3A5F", fontSize: 14 }}
            >
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: r.fond }}
              >
                <r.icone size={18} color={r.couleur} aria-hidden="true" />
              </span>
              {r.texte}
            </Link>
          ))}
        </div>

        {/* Recommandations */}
        <section aria-labelledby="pour-vous" className="flex flex-col gap-3">
          <div className="flex items-center justify-between mt-1">
            <h2 id="pour-vous" className="m-0 font-extrabold" style={{ fontSize: 18, color: "#1E293B" }}>
              Pour vous
            </h2>
            <Link
              to="/tenant/listings"
              className="min-h-11 inline-flex items-center font-bold no-underline"
              style={{ fontSize: 14, color: "#C2410C" }}
            >
              Tout voir →
            </Link>
          </div>

          {recommandations.chargement ? (
            <div className="flex gap-3 -mr-5 overflow-hidden" aria-hidden="true">
              {[0, 1].map((i) => (
                <div key={i} className="w-[220px] h-[200px] shrink-0 rounded-[20px] bg-white animate-pulse" />
              ))}
            </div>
          ) : recommandations.erreur ? (
            <Erreur message={recommandations.erreur} onReessayer={recommandations.recharger} />
          ) : !recommandations.data?.listings.length ? (
            <ListeVide
              titre="Aucune annonce compatible pour l'instant"
              description={
                recommandations.data?.passeport_complet
                  ? "De nouvelles annonces arrivent chaque semaine à Conakry. Revenez bientôt."
                  : "Précisez vos critères de recherche pour obtenir des propositions ciblées."
              }
              action={
                recommandations.data?.passeport_complet
                  ? { label: "Parcourir les annonces", to: "/tenant/listings" }
                  : { label: "Définir mes critères", to: "/tenant/profile" }
              }
            />
          ) : (
            <div
              className="flex gap-3 -mr-5 pr-5 pb-2 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {recommandations.data.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} onToggleFavori={basculerFavori} compacte />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
