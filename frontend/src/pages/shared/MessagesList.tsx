import { MessageSquare } from "lucide-react";
import { Link } from "react-router";

import { messagesAPI } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { formatMontantCourt, formatRelatif } from "../../lib/format";

export function MessagesList() {
  const { user } = useAuth();
  const conversations = useApi(() => messagesAPI.conversations(), []);

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
          conversations.data.conversations.map((conversation) => {
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
      </div>
    </div>
  );
}
