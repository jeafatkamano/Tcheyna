import {
  Calendar,
  Check,
  ChevronRight,
  Handshake,
  MapPin,
  MessageSquare,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { listingsAPI, matchesAPI, type Match, type MatchStatus } from "../../api";
import { Avatar } from "../../components/Avatar";
import { BadgeVerification, ScoreCircle, ScoreMatch } from "../../components/BadgeVerification";
import { Erreur, ListeVide, MessageErreur, SqueletteCartes } from "../../components/Etats";
import { useAction, useApi } from "../../hooks/useApi";
import { formatDateHeure, formatMontantCourt, formatRelatif } from "../../lib/format";
import { ModaleAvis } from "../tenant/TenantMatches";

const STATUTS: Record<MatchStatus, { label: string; couleur: string; fond: string }> = {
  pending: { label: "À examiner", couleur: "#D97706", fond: "#FEF3C7" },
  accepted: { label: "Acceptée", couleur: "#059669", fond: "#D1FAE5" },
  rejected: { label: "Refusée", couleur: "#DC2626", fond: "#FEE2E2" },
  completed: { label: "Location conclue", couleur: "#1D4ED8", fond: "#DBEAFE" },
  cancelled: { label: "Retirée", couleur: "#64748B", fond: "#F1F5F9" },
};

const FILTRES = [
  { valeur: undefined, label: "Toutes" },
  { valeur: "pending" as const, label: "À examiner" },
  { valeur: "accepted" as const, label: "Acceptées" },
  { valeur: "completed" as const, label: "Conclues" },
];

type Onglet = "candidatures" | "suggestions";

export function OwnerMatches() {
  const [onglet, setOnglet] = useState<Onglet>("candidatures");
  const [filtre, setFiltre] = useState<MatchStatus | undefined>(undefined);
  const [visiteOuverte, setVisiteOuverte] = useState<string | null>(null);
  const [avisOuvert, setAvisOuvert] = useState<{ matchId: string; cible: string } | null>(null);

  const demandes = useApi(() => matchesAPI.mesDemandes({ statut: filtre }), [filtre]);
  const reponse = useAction(matchesAPI.repondre);
  const conclusion = useAction(matchesAPI.conclure);

  async function repondre(match: Match, statut: "accepted" | "rejected") {
    const ok = await reponse.executer(match.id, statut);
    if (ok) void demandes.recharger();
  }

  async function conclure(match: Match) {
    if (
      !window.confirm(
        "Confirmer que la location est conclue avec ce candidat ? Les autres candidatures seront automatiquement refusées.",
      )
    )
      return;
    const ok = await conclusion.executer(match.id);
    if (ok) void demandes.recharger();
  }

  const stats = demandes.data?.stats;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
          Candidats
        </h1>
        <p className="text-white/60 text-sm">Les dossiers reçus sur vos annonces</p>

        {stats && (
          <div className="grid grid-cols-4 gap-2 mt-5">
            {[
              { label: "Total", valeur: stats.total },
              { label: "À examiner", valeur: stats.en_attente },
              { label: "Acceptées", valeur: stats.acceptees },
              { label: "Conclues", valeur: stats.conclues },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-3 text-center"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                <span className="text-white font-bold text-xl block">{s.valeur}</span>
                <span className="text-white/50 text-xs leading-tight">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Onglets */}
      <div className="px-4 -mt-3 relative z-10">
        <div
          className="flex gap-1 p-1 rounded-2xl"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.1)" }}
        >
          {(
            [
              { cle: "candidatures" as const, label: "Candidatures reçues" },
              { cle: "suggestions" as const, label: "Suggestions" },
            ]
          ).map((o) => (
            <button
              key={o.cle}
              onClick={() => setOnglet(o.cle)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{
                background: onglet === o.cle ? "#F97316" : "transparent",
                color: onglet === o.cle ? "white" : "#64748B",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {onglet === "suggestions" ? (
        <OngletSuggestions />
      ) : (
        <>
          <div className="flex gap-2 px-4 py-4 overflow-x-auto">
            {FILTRES.map((f) => (
              <button
                key={f.label}
                onClick={() => setFiltre(f.valeur)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
                style={{
                  background: filtre === f.valeur ? "#1E3A5F" : "white",
                  color: filtre === f.valeur ? "white" : "#64748B",
                  border: "1px solid #E2E8F0",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="px-4 space-y-4">
            <MessageErreur message={reponse.erreur ?? conclusion.erreur} />

            {demandes.chargement ? (
              <SqueletteCartes nombre={2} />
            ) : demandes.erreur ? (
              <Erreur message={demandes.erreur} onReessayer={demandes.recharger} />
            ) : !demandes.data?.matches.length ? (
              <ListeVide
                titre="Aucune candidature"
                description="Faites certifier vos annonces : elles remontent dans les résultats et attirent les locataires vérifiés."
                action={{ label: "Voir mes annonces", to: "/owner/listings" }}
              />
            ) : (
              demandes.data.matches.map((match) => {
                const statut = STATUTS[match.status];
                return (
                  <div
                    key={match.id}
                    className="rounded-2xl overflow-hidden"
                    style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
                  >
                    {/* Annonce concernée */}
                    <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-gray-100">
                      <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" style={{ background: "#F0F4FA" }}>
                        {match.listing?.images[0] && (
                          <img src={match.listing.images[0]} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                          {match.listing?.title}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <MapPin size={11} />
                          {match.listing?.quartier} ·{" "}
                          {formatMontantCourt(match.listing?.prix, match.listing?.devise)}/mois
                        </div>
                      </div>
                      <span
                        className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                        style={{ background: statut.fond, color: statut.couleur }}
                      >
                        {statut.label}
                      </span>
                    </div>

                    {/* Candidat */}
                    <div className="px-4 py-4">
                      <div className="flex items-center gap-3 mb-3">
                        <Link to={`/profil/${match.tenant?.id}`}>
                          <Avatar
                            nom={match.tenant?.full_name}
                            url={match.tenant?.avatar_url}
                            taille={48}
                          />
                        </Link>
                        <div className="flex-1 min-w-0">
                          <Link to={`/profil/${match.tenant?.id}`} className="flex items-center gap-2">
                            <span className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                              {match.tenant?.full_name}
                            </span>
                            <ChevronRight size={14} style={{ color: "#CBD5E1" }} />
                          </Link>
                          <p className="text-xs text-gray-400 mb-1">
                            {match.passeport?.situation_pro ?? "Situation non précisée"}
                            {match.passeport?.a_un_garant && " · avec garant"}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <BadgeVerification level={match.tenant?.trust_level ?? 0} size="sm" />
                            <ScoreMatch score={match.score_compatibilite} />
                          </div>
                        </div>
                        {match.passeport && <ScoreCircle score={match.passeport.score} size={46} label="" />}
                      </div>

                      {match.message && (
                        <div className="px-3.5 py-3 rounded-xl mb-3" style={{ background: "#F8FAFC" }}>
                          <p className="text-sm text-gray-600 leading-relaxed">{match.message}</p>
                        </div>
                      )}

                      {match.visite_date && (
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
                          style={{ background: "#EFF6FF" }}
                        >
                          <Calendar size={14} style={{ color: "#1D4ED8", flexShrink: 0 }} />
                          <span className="text-xs font-medium" style={{ color: "#1E3A5F" }}>
                            Visite le {formatDateHeure(match.visite_date)}
                          </span>
                        </div>
                      )}

                      <p className="text-xs text-gray-400 mb-3">
                        Candidature reçue {formatRelatif(match.created_at)}
                      </p>

                      {/* Actions selon le statut */}
                      {match.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => repondre(match, "rejected")}
                            disabled={reponse.enCours}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                            style={{ background: "#F1F5F9", color: "#64748B" }}
                          >
                            <X size={15} />
                            Refuser
                          </button>
                          <button
                            onClick={() => repondre(match, "accepted")}
                            disabled={reponse.enCours}
                            className="flex-[2] flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: "#F97316" }}
                          >
                            <Check size={15} />
                            Accepter et discuter
                          </button>
                        </div>
                      )}

                      {match.status === "accepted" && (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Link
                              to={`/messages/${match.id}`}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-sm font-semibold"
                              style={{ background: "#1E3A5F" }}
                            >
                              <MessageSquare size={15} />
                              Discuter
                            </Link>
                            <button
                              onClick={() => setVisiteOuverte(match.id)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold"
                              style={{ background: "#EFF6FF", color: "#1E3A5F" }}
                            >
                              <Calendar size={15} />
                              {match.visite_date ? "Replanifier" : "Planifier"}
                            </button>
                          </div>
                          <button
                            onClick={() => conclure(match)}
                            disabled={conclusion.enCours}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: "#10B981" }}
                          >
                            <Handshake size={15} />
                            Conclure la location avec ce candidat
                          </button>
                        </div>
                      )}

                      {match.status === "completed" && (
                        <div className="space-y-2">
                          <div
                            className="px-3.5 py-3 rounded-xl"
                            style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
                          >
                            <p className="text-xs font-semibold" style={{ color: "#1E3070" }}>
                              Commission Tcheyna :{" "}
                              {formatMontantCourt(match.commission, match.listing?.devise)}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "#1D4ED8" }}>
                              6 % du premier loyer, sur une location conclue via la plateforme.
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              setAvisOuvert({
                                matchId: match.id,
                                cible: match.tenant?.full_name ?? "ce locataire",
                              })
                            }
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold"
                            style={{ background: "#FFF7ED", color: "#F97316" }}
                          >
                            <Star size={15} />
                            Laisser un avis
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {visiteOuverte && (
        <ModaleVisite
          matchId={visiteOuverte}
          onFerme={() => setVisiteOuverte(null)}
          onPlanifie={() => {
            setVisiteOuverte(null);
            void demandes.recharger();
          }}
        />
      )}

      {avisOuvert && (
        <ModaleAvis
          matchId={avisOuvert.matchId}
          cible={avisOuvert.cible}
          onFerme={() => setAvisOuvert(null)}
          onPublie={() => setAvisOuvert(null)}
        />
      )}
    </div>
  );
}

/* ─── Suggestions de candidats ─────────────────────────────── */

function OngletSuggestions() {
  const annonces = useApi(() => listingsAPI.mesAnnonces(), []);
  const [annonceId, setAnnonceId] = useState<string>("");

  const actives = (annonces.data?.listings ?? []).filter((l) => l.status === "active");
  const selectionnee = annonceId || actives[0]?.id || "";

  const suggestions = useApi(
    () => matchesAPI.candidatsSuggeres(selectionnee, 12),
    [selectionnee],
    { actif: Boolean(selectionnee) },
  );

  if (annonces.chargement) return <SqueletteCartes nombre={2} />;

  if (!actives.length) {
    return (
      <div className="px-4 pt-6">
        <ListeVide
          titre="Aucune annonce active"
          description="Publiez une annonce pour découvrir les locataires vérifiés qui cherchent exactement votre type de bien."
          action={{ label: "Publier une annonce", to: "/owner/listings/nouveau" }}
        />
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 space-y-4">
      <div className="rounded-2xl p-4" style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE" }}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} style={{ color: "#1D4ED8" }} />
          <p className="font-semibold text-sm" style={{ color: "#1E3070" }}>
            Locataires vérifiés compatibles
          </p>
        </div>
        <p className="text-xs" style={{ color: "#1D4ED8" }}>
          Au lieu d'attendre les candidatures, voyez qui, dans la base vérifiée, cherche votre bien.
        </p>
      </div>

      <div>
        <label htmlFor="annonce" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
          Pour quelle annonce ?
        </label>
        <select
          id="annonce"
          value={selectionnee}
          onChange={(e) => setAnnonceId(e.target.value)}
          className="w-full px-4 py-3 rounded-xl outline-none"
          style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
        >
          {actives.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      </div>

      {suggestions.chargement ? (
        <SqueletteCartes nombre={2} />
      ) : suggestions.erreur ? (
        <Erreur message={suggestions.erreur} onReessayer={suggestions.recharger} />
      ) : !suggestions.data?.candidats.length ? (
        <ListeVide
          titre="Aucun candidat compatible pour l'instant"
          description="Les suggestions apparaissent dès qu'un locataire vérifié renseigne des critères correspondant à ce bien."
        />
      ) : (
        suggestions.data.candidats.map((candidat) => (
          <div
            key={candidat.tenant.id}
            className="rounded-2xl p-4"
            style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
          >
            <div className="flex items-center gap-3 mb-3">
              <Link to={`/profil/${candidat.tenant.id}`}>
                <Avatar
                  nom={candidat.tenant.full_name}
                  url={candidat.tenant.avatar_url}
                  taille={48}
                />
              </Link>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                  {candidat.tenant.full_name}
                </p>
                <p className="text-xs text-gray-400 mb-1">
                  {candidat.passeport?.situation_pro ?? "Situation non précisée"}
                  {candidat.passeport?.a_un_garant && " · avec garant"}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <BadgeVerification level={candidat.tenant.trust_level} size="sm" />
                  <ScoreMatch score={candidat.score_compatibilite} />
                </div>
              </div>
              {candidat.passeport && <ScoreCircle score={candidat.passeport.score} size={46} label="" />}
            </div>

            <div className="space-y-1.5">
              {candidat.details_compatibilite.map((detail) => (
                <div key={detail.critere} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">{detail.critere}</span>
                  <span className="font-medium" style={{ color: detail.points === detail.max ? "#059669" : "#94A3B8" }}>
                    {detail.libelle}
                  </span>
                </div>
              ))}
            </div>

            <Link
              to={`/profil/${candidat.tenant.id}`}
              className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "#F0F4FA", color: "#1E3A5F" }}
            >
              Voir le dossier complet
              <ChevronRight size={15} />
            </Link>
          </div>
        ))
      )}
    </div>
  );
}

/* ─── Planification de visite ──────────────────────────────── */

function ModaleVisite({
  matchId,
  onFerme,
  onPlanifie,
}: {
  matchId: string;
  onFerme: () => void;
  onPlanifie: () => void;
}) {
  const [date, setDate] = useState("");
  const planification = useAction(matchesAPI.planifierVisite);

  async function planifier() {
    const ok = await planification.executer(matchId, date);
    if (ok) onPlanifie();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onFerme} />
      <div className="relative w-full rounded-t-3xl p-6 space-y-5" style={{ background: "white" }}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg" style={{ color: "#1E3A5F" }}>
            Planifier une visite
          </h3>
          <button onClick={onFerme} style={{ color: "#64748B" }} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>

        <div>
          <label htmlFor="visite" className="block text-sm font-semibold text-gray-700 mb-2">
            Date et heure
          </label>
          <input
            id="visite"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl outline-none"
            style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
          />
          <p className="text-xs text-gray-400 mt-1.5">
            Le locataire reçoit une notification avec la date proposée.
          </p>
        </div>

        <MessageErreur message={planification.erreur} />

        <button
          onClick={planifier}
          disabled={!date || planification.enCours}
          className="w-full py-4 rounded-2xl font-semibold text-white disabled:opacity-50"
          style={{ background: "#F97316" }}
        >
          {planification.enCours ? "Enregistrement…" : "Confirmer la visite"}
        </button>
      </div>
    </div>
  );
}
