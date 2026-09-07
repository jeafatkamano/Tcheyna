/**
 * ConversationPage.tsx — Fil de discussion d'une mise en relation.
 *
 * La conversation est ouverte par le backend au moment où le propriétaire
 * accepte la candidature : cette page ne fait que l'afficher.
 */
import { ArrowLeft, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { messagesAPI, type Message } from "../../api";
import { Chargement, Erreur, MessageErreur } from "../../components/Etats";
import { useAuth } from "../../context/AuthContext";
import { useAction, useApi } from "../../hooks/useApi";
import { formatMontantCourt, initiales } from "../../lib/format";

const INTERVALLE_RAFRAICHISSEMENT = 15_000;

export function ConversationPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [saisie, setSaisie] = useState("");
  const finDuFil = useRef<HTMLDivElement>(null);

  const conversation = useApi(() => messagesAPI.filParMatch(matchId!), [matchId], {
    actif: Boolean(matchId),
  });
  const envoi = useAction(messagesAPI.envoyer);

  const messages = conversation.data?.messages ?? [];

  // Sondage léger : suffisant pour un fil de discussion, sans websocket.
  useEffect(() => {
    if (!conversation.data) return;
    const timer = setInterval(() => void conversation.recharger(), INTERVALLE_RAFRAICHISSEMENT);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.data?.id]);

  useEffect(() => {
    finDuFil.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function envoyer() {
    const contenu = saisie.trim();
    if (!contenu || !conversation.data) return;
    setSaisie("");
    const reponse = await envoi.executer(conversation.data.id, contenu);
    if (reponse) await conversation.recharger();
    else setSaisie(contenu); // échec : on rend son texte à l'utilisateur
  }

  if (conversation.chargement) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement texte="Ouverture de la discussion…" />
      </div>
    );
  }

  if (conversation.erreur || !conversation.data) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
        <div className="px-4 pt-6">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2" style={{ color: "#1E3A5F" }}>
            <ArrowLeft size={20} />
          </button>
        </div>
        <Erreur
          message={conversation.erreur ?? "Discussion introuvable"}
          onReessayer={conversation.recharger}
        />
      </div>
    );
  }

  const { interlocuteur, listing } = conversation.data;

  return (
    <div className="flex flex-col h-screen" style={{ background: "#F0F4FA" }}>
      {/* En-tête */}
      <div
        className="flex items-center gap-3 px-4 py-3 shadow-sm flex-shrink-0"
        style={{ background: "#1E3A5F" }}
      >
        <button
          onClick={() => navigate("/messages")}
          className="p-2 rounded-xl"
          style={{ background: "rgba(255,255,255,0.12)", color: "white" }}
          aria-label="Retour aux messages"
        >
          <ArrowLeft size={18} />
        </button>

        <Link
          to={`/profil/${interlocuteur?.id}`}
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-white"
          style={{ background: "rgba(255,255,255,0.2)" }}
        >
          {initiales(interlocuteur?.full_name)}
        </Link>

        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">
            {interlocuteur?.full_name ?? "Interlocuteur"}
          </p>
          {listing && (
            <Link to={`/listing/${listing.id}`} className="text-white/50 text-xs truncate block">
              {listing.title} · {formatMontantCourt(listing.prix, listing.devise)}/mois
            </Link>
          )}
        </div>
      </div>

      {/* Bandeau de mise en relation */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
        style={{ background: "#D1FAE5", borderBottom: "1px solid #A7F3D0" }}
      >
        <span style={{ fontSize: "14px" }}>🎉</span>
        <p className="text-xs font-semibold" style={{ color: "#065F46" }}>
          Mise en relation validée — organisez la visite en toute confiance.
        </p>
      </div>

      {/* Fil */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-10">
            Aucun message pour l'instant. Lancez la discussion.
          </p>
        )}

        {messages.map((message, i) => (
          <Bulle
            key={message.id}
            message={message}
            estMien={message.sender_id === user?.id}
            precedent={messages[i - 1]}
            initialesAutre={initiales(interlocuteur?.full_name)}
          />
        ))}
        <div ref={finDuFil} />
      </div>

      {/* Saisie */}
      <div
        className="flex-shrink-0 px-4 py-3 border-t border-gray-200"
        style={{ background: "white" }}
      >
        <MessageErreur message={envoi.erreur} />
        <div className="flex items-end gap-2 mt-1">
          <textarea
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void envoyer();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Écrivez votre message…"
            aria-label="Message"
            className="flex-1 px-4 py-3 rounded-2xl outline-none resize-none max-h-32"
            style={{ background: "#F0F4FA", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
          />
          <button
            onClick={envoyer}
            disabled={!saisie.trim() || envoi.enCours}
            className="p-3 rounded-2xl text-white flex-shrink-0 transition-transform active:scale-90 disabled:opacity-40"
            style={{ background: "#F97316" }}
            aria-label="Envoyer"
          >
            <Send size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bulle({
  message,
  estMien,
  precedent,
  initialesAutre,
}: {
  message: Message;
  estMien: boolean;
  precedent?: Message;
  initialesAutre: string;
}) {
  const date = message.created_at ? new Date(message.created_at) : new Date();
  const nouveauJour =
    !precedent ||
    (precedent.created_at &&
      new Date(precedent.created_at).toDateString() !== date.toDateString());

  return (
    <div>
      {nouveauJour && (
        <div className="text-center my-3">
          <span
            className="text-xs px-3 py-1 rounded-full"
            style={{ background: "#E2E8F0", color: "#64748B" }}
          >
            {date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </span>
        </div>
      )}

      <div className={`flex items-end gap-2 ${estMien ? "flex-row-reverse" : "flex-row"}`}>
        {!estMien && (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mb-1 text-white font-semibold"
            style={{ background: "#1E3A5F", fontSize: "10px" }}
          >
            {initialesAutre}
          </div>
        )}

        <div
          className="max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
          style={{
            background: estMien ? "#1E3A5F" : "white",
            color: estMien ? "white" : "#1E293B",
            borderBottomRightRadius: estMien ? "4px" : "16px",
            borderBottomLeftRadius: estMien ? "16px" : "4px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          }}
        >
          <p className="whitespace-pre-wrap break-words">{message.contenu}</p>
          <div className={`flex items-center gap-1 mt-1 ${estMien ? "justify-end" : ""}`}>
            <span
              style={{
                fontSize: "10px",
                color: estMien ? "rgba(255,255,255,0.55)" : "#94A3B8",
              }}
            >
              {date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              {estMien && message.lu && " · lu"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
