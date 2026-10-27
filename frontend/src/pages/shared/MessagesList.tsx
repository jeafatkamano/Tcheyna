/**
 * MessagesList.tsx — Liste des discussions.
 *
 * Lot 2.8 : la liste se charge par pages de 20 (« Afficher plus ») quand le
 * serveur la pagine ; un serveur antérieur ignore `page` et renvoie tout, sans
 * bouton. Une discussion fermée à l'écriture porte la mention « Fermée ».
 */
import { Loader2, Lock, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ApiError, messagesAPI, type Conversation, type PageConversations } from "../../api";
import { Avatar } from "../../components/Avatar";
import { BadgeProprietaireVerifie } from "../../components/BadgeVerification";
import { Erreur, ListeVide, MessageErreur, SqueletteCartes } from "../../components/Etats";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { formatMontantCourt, formatRelatif } from "../../lib/format";

const PAR_PAGE = 20;

/** Ajoute `suivantes` sans doublon : une conversation remontée en tête par un
 * nouveau message entre deux pages n'apparaît qu'une fois. */
function ajouterSansDoublon(liste: Conversation[], suivantes: Conversation[]) {
  const vues = new Set(liste.map((c) => c.id));
  return [...liste, ...suivantes.filter((c) => !vues.has(c.id))];
}

interface Suite {
  /** Première page à laquelle cette suite s'ajoute. */
  source: PageConversations;
  page: number;
  liste: Conversation[];
}

export function MessagesList() {
  const { user } = useAuth();
  const conversations = useApi(
    (signal) => messagesAPI.conversations({ page: 1, per_page: PAR_PAGE }, signal),
    [],
  );

  // Pages suivantes, ajoutées à la première à chaque « Afficher plus ». Un
  // rechargement de la première page (« Réessayer ») repart de zéro.
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteEnCours, setSuiteEnCours] = useState(false);
  const [erreurSuite, setErreurSuite] = useState<string | null>(null);
  const suiteValide = suite && suite.source === conversations.data ? suite : null;

  const liste = suiteValide?.liste ?? conversations.data?.conversations ?? [];
  const pageCourante = suiteValide?.page ?? conversations.data?.page ?? 1;
  // Sans `pages`, le serveur a tout renvoyé : pas de bouton.
  const pages = conversations.data?.pages;
  const encoreDesPages = pages !== undefined && pageCourante < pages;

  async function afficherPlus() {
    const source = conversations.data;
    if (!source || suiteEnCours) return;
    setSuiteEnCours(true);
    setErreurSuite(null);
    try {
      const page = pageCourante + 1;
      const reponse = await messagesAPI.conversations({ page, per_page: PAR_PAGE });
      setSuite({ source, page, liste: ajouterSansDoublon(liste, reponse.conversations) });
    } catch (err) {
      setErreurSuite(err instanceof ApiError ? err.message : "Impossible de charger la suite");
    } finally {
      setSuiteEnCours(false);
    }
  }

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
          Messages
        </h1>
        <p className="text-white/60 text-sm">
          {conversations.data?.non_lus
            ? `${conversations.data.non_lus} message${conversations.data.non_lus > 1 ? "s" : ""} non lu${conversations.data.non_lus > 1 ? "s" : ""}`
            : "Vos discussions avec les candidats et propriétaires"}
        </p>
      </div>

      <div className="px-4 pt-5 space-y-3">
        {conversations.chargement ? (
          <SqueletteCartes nombre={2} />
        ) : conversations.erreur ? (
          <Erreur message={conversations.erreur} onReessayer={conversations.recharger} />
        ) : !conversations.data?.conversations.length ? (
          <ListeVide
            titre="Aucune discussion"
            description={
              user?.role === "tenant"
                ? "Une discussion s'ouvre dès qu'un propriétaire accepte votre candidature."
                : "Une discussion s'ouvre dès que vous acceptez une candidature."
            }
            icone={<MessageSquare size={26} style={{ color: "#94A3B8" }} />}
            action={
              user?.role === "tenant"
                ? { label: "Voir les annonces", to: "/tenant/listings" }
                : { label: "Voir les candidats", to: "/owner/matches" }
            }
          />
        ) : (
          liste.map((conversation) => {
            const nonLus = conversation.nb_non_lus > 0;
            return (
              <Link
                key={conversation.id}
                to={`/messages/${conversation.match_id}`}
                className="flex items-center gap-3 p-4 rounded-2xl transition-transform active:scale-[0.98]"
                style={{
                  background: "white",
                  boxShadow: "0 2px 12px rgba(30,58,95,0.07)",
                  border: nonLus ? "1.5px solid #FED7AA" : "1.5px solid transparent",
                }}
              >
                <Avatar
                  nom={conversation.interlocuteur?.full_name}
                  url={conversation.interlocuteur?.avatar_url}
                  taille={48}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span
                      className="font-bold text-sm truncate"
                      style={{ color: "#1E293B" }}
                    >
                      {conversation.interlocuteur?.full_name ?? "Interlocuteur"}
                    </span>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatRelatif(conversation.last_message_at)}
                    </span>
                  </div>

                  {conversation.interlocuteur?.proprietaire_verifie && (
                    <div className="mb-1">
                      <BadgeProprietaireVerifie utilisateur={conversation.interlocuteur} />
                    </div>
                  )}

                  {conversation.listing && (
                    <p className="text-xs text-gray-400 truncate mb-1">
                      {conversation.listing.title} ·{" "}
                      {formatMontantCourt(conversation.listing.prix, conversation.listing.devise)}/mois
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <p
                      className="text-sm truncate"
                      style={{
                        color: nonLus ? "#1E293B" : "#94A3B8",
                        fontWeight: nonLus ? 600 : 400,
                      }}
                    >
                      {conversation.dernier_message?.contenu ?? "Démarrez la discussion"}
                    </p>
                    {conversation.ecriture_fermee && (
                      <span
                        className="inline-flex items-center gap-1 h-5 px-2 rounded-full font-semibold flex-shrink-0"
                        style={{ background: "#F1F5F9", color: "#475569", fontSize: "11px" }}
                        title="Discussion fermée : l'historique reste consultable"
                      >
                        <Lock size={10} aria-hidden="true" />
                        Fermée
                      </span>
                    )}
                    {nonLus && (
                      <span
                        className="min-w-[20px] h-5 px-1.5 rounded-full text-white flex items-center justify-center font-bold flex-shrink-0"
                        style={{ background: "#F97316", fontSize: "11px" }}
                      >
                        {conversation.nb_non_lus}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}

        <MessageErreur message={erreurSuite} />
        {encoreDesPages && !conversations.erreur && (
          <button
            type="button"
            onClick={afficherPlus}
            disabled={suiteEnCours}
            aria-busy={suiteEnCours}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold disabled:opacity-60"
            style={{ background: "white", color: "#1E3A5F", border: "1.5px solid #E2E8F0" }}
          >
            {suiteEnCours && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {suiteEnCours ? "Chargement…" : "Afficher plus"}
          </button>
        )}
      </div>
    </div>
  );
}
