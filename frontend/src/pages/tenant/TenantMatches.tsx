import { Calendar, MapPin, MessageSquare, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { avisAPI, matchesAPI, type Match, type MatchStatus } from "../../api";
import { Erreur, ListeVide, MessageErreur, SqueletteCartes } from "../../components/Etats";
import { useAction, useApi } from "../../hooks/useApi";
import { formatDateHeure, formatMontantCourt, formatRelatif } from "../../lib/format";

const STATUTS: Record<MatchStatus, { label: string; couleur: string; fond: string }> = {
  pending: { label: "En attente", couleur: "#D97706", fond: "#FEF3C7" },
  accepted: { label: "Acceptée", couleur: "#059669", fond: "#D1FAE5" },
  rejected: { label: "Non retenue", couleur: "#DC2626", fond: "#FEE2E2" },
  completed: { label: "Location conclue", couleur: "#1D4ED8", fond: "#DBEAFE" },
  cancelled: { label: "Retirée", couleur: "#64748B", fond: "#F1F5F9" },
};

const FILTRES = [
  { valeur: undefined, label: "Toutes" },
  { valeur: "pending" as const, label: "En attente" },
  { valeur: "accepted" as const, label: "Acceptées" },
  { valeur: "completed" as const, label: "Conclues" },
];

export function TenantMatches() {
  const [filtre, setFiltre] = useState<MatchStatus | undefined>(undefined);
  const [avisOuvert, setAvisOuvert] = useState<string | null>(null);

  const candidatures = useApi(() => matchesAPI.mesCandidatures(filtre), [filtre]);
  const avisADonner = useApi(() => avisAPI.aDonner(), []);
  const retrait = useAction(matchesAPI.retirer);

  async function retirer(match: Match) {
    if (!window.confirm("Retirer définitivement cette candidature ?")) return;
    const ok = await retrait.executer(match.id);
    if (ok) void candidatures.recharger();
  }

  const stats = candidatures.data?.stats;
  const enAttenteDAvis = avisADonner.data?.a_donner ?? [];

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
          Mes candidatures
        </h1>
        <p className="text-white/60 text-sm">Le suivi de vos dossiers déposés</p>

        {stats && (
          <div className="grid grid-cols-4 gap-2 mt-5">
            {[
              { label: "Total", valeur: stats.total },
              { label: "En attente", valeur: stats.en_attente },
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

      <div
        className="flex gap-2 px-4 py-3 overflow-x-auto"
        style={{ background: "#1E3A5F", borderBottom: "1px solid rgba(255,255,255,0.1)" }}
      >
        {FILTRES.map((f) => (
          <button
            key={f.label}
            onClick={() => setFiltre(f.valeur)}
            className="px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
            style={{
              background: filtre === f.valeur ? "#F97316" : "rgba(255,255,255,0.12)",
              color: filtre === f.valeur ? "white" : "rgba(255,255,255,0.6)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Avis en attente : rappel discret mais visible */}
      {enAttenteDAvis.length > 0 && (
        <div className="px-4 pt-4">
          <div className="rounded-2xl p-4" style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA" }}>
            <div className="flex items-center gap-2 mb-2">
              <Star size={17} style={{ color: "#F97316" }} />
              <p className="font-semibold text-sm" style={{ color: "#9A3412" }}>
                {enAttenteDAvis.length} avis à laisser
              </p>
            </div>
            <p className="text-xs mb-3" style={{ color: "#C2410C" }}>
              Votre avis nourrit l'historique de confiance de la communauté.
            </p>
            {enAttenteDAvis.map((a) => (
              <button
                key={a.match_id}
                onClick={() => setAvisOuvert(a.match_id)}
                className="w-full text-left px-3 py-2.5 rounded-xl mb-2 last:mb-0 flex items-center justify-between"
                style={{ background: "white" }}
              >
                <span className="text-sm font-medium" style={{ color: "#1E293B" }}>
                  Noter {a.cible.full_name}
                </span>
                <Star size={15} style={{ color: "#F97316" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pt-4 space-y-4">
        {candidatures.chargement ? (
          <SqueletteCartes nombre={2} />
        ) : candidatures.erreur ? (
          <Erreur message={candidatures.erreur} onReessayer={candidatures.recharger} />
        ) : !candidatures.data?.matches.length ? (
          <ListeVide
            titre="Aucune candidature"
            description="Parcourez les annonces et postulez à celles qui vous correspondent."
            action={{ label: "Voir les annonces", to: "/tenant/listings" }}
          />
        ) : (
          candidatures.data.matches.map((match) => {
            const statut = STATUTS[match.status];
            const listing = match.listing;
            if (!listing) return null;

            return (
              <div
                key={match.id}
                className="rounded-2xl overflow-hidden"
                style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
              >
                <Link
                  to={`/listing/${listing.id}`}
                  className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-gray-100"
                >
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ background: "#F0F4FA" }}>
                    {listing.images[0] && (
                      <img src={listing.images[0]} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
                      {listing.title}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <MapPin size={11} />
                      {listing.quartier ?? listing.ville} ·{" "}
                      {formatMontantCourt(listing.prix, listing.devise)}/mois
                    </div>
                  </div>
                  <span
                    className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ background: statut.fond, color: statut.couleur }}
                  >
                    {statut.label}
                  </span>
                </Link>

                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Candidature {formatRelatif(match.created_at)}</span>
                    {match.score_compatibilite != null && (
                      <span className="font-semibold" style={{ color: "#F97316" }}>
                        {match.score_compatibilite}% de compatibilité
                      </span>
                    )}
                  </div>

                  {match.visite_date && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "#EFF6FF" }}
                    >
                      <Calendar size={14} style={{ color: "#1D4ED8", flexShrink: 0 }} />
                      <span className="text-xs font-medium" style={{ color: "#1E3A5F" }}>
                        Visite prévue le {formatDateHeure(match.visite_date)}
                      </span>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    {match.status === "accepted" || match.status === "completed" ? (
                      <Link
                        to={`/messages/${match.id}`}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold"
                        style={{ background: "#1E3A5F" }}
                      >
                        <MessageSquare size={15} />
                        Ouvrir la discussion
                      </Link>
                    ) : match.status === "pending" ? (
                      <button
                        onClick={() => retirer(match)}
                        disabled={retrait.enCours}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                        style={{ background: "#F1F5F9", color: "#64748B" }}
                      >
                        <Trash2 size={15} />
                        Retirer ma candidature
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}

        <MessageErreur message={retrait.erreur} />
      </div>

      {avisOuvert && (
        <ModaleAvis
          matchId={avisOuvert}
          cible={enAttenteDAvis.find((a) => a.match_id === avisOuvert)?.cible.full_name ?? ""}
          onFerme={() => setAvisOuvert(null)}
          onPublie={() => {
            setAvisOuvert(null);
            void avisADonner.recharger();
          }}
        />
      )}
    </div>
  );
}

interface ModaleAvisProps {
  matchId: string;
  cible: string;
  onFerme: () => void;
  onPublie: () => void;
}

export function ModaleAvis({ matchId, cible, onFerme, onPublie }: ModaleAvisProps) {
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState("");
  const publication = useAction(avisAPI.publier);

  async function publier() {
    const ok = await publication.executer({
      match_id: matchId,
      note,
      commentaire: commentaire.trim() || undefined,
    });
    if (ok) onPublie();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onFerme} />
      <div className="relative w-full rounded-t-3xl p-6 space-y-5" style={{ background: "white" }}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg" style={{ color: "#1E3A5F" }}>
            Noter {cible}
          </h3>
          <button onClick={onFerme} style={{ color: "#64748B" }} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>

        <div>
          <span className="block text-sm font-semibold text-gray-700 mb-3">Votre note</span>
          <div className="flex gap-2 justify-center">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setNote(n)}
                className="p-1 transition-transform active:scale-90"
                aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
              >
                <Star
                  size={34}
                  fill={n <= note ? "#F59E0B" : "none"}
                  stroke={n <= note ? "#F59E0B" : "#CBD5E1"}
                />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="commentaire" className="block text-sm font-semibold text-gray-700 mb-2">
            Commentaire <span className="font-normal text-gray-400">(facultatif)</span>
          </label>
          <textarea
            id="commentaire"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            rows={3}
            maxLength={800}
            placeholder="Ponctualité, état du logement, qualité des échanges…"
            className="w-full px-4 py-3 rounded-xl outline-none resize-none"
            style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "14px" }}
          />
        </div>

        <MessageErreur message={publication.erreur} />

        <button
          onClick={publier}
          disabled={note === 0 || publication.enCours}
          className="w-full py-4 rounded-2xl font-semibold text-white disabled:opacity-50"
          style={{ background: "#F97316" }}
        >
          {publication.enCours ? "Publication…" : "Publier mon avis"}
        </button>
      </div>
    </div>
  );
}
