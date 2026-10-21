/**
 * ConversationPage.tsx — Fil de discussion d'une mise en relation.
 *
 * La conversation est ouverte par le backend au moment où le propriétaire
 * accepte la candidature : cette page ne fait que l'afficher.
 *
 * Messagerie bornée (lot 2.8) : après un refus ou un retrait de la
 * candidature, le fil reste lisible mais la saisie est grisée, avec le motif.
 * Le fil se charge par pages (« Charger les messages plus anciens »), et des
 * messages types proposés par le serveur aident à démarrer l'échange.
 */
import { ArrowLeft, Loader2, Lock, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError, messagesAPI, type Message, type User } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Chargement, Erreur, MessageErreur } from "../../components/Etats";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { useFilConversation } from "../../hooks/useFilConversation";
import { formatMontantCourt } from "../../lib/format";

const ID_EXPLICATION_FERMETURE = "explication-fermeture";

/** Pourquoi la discussion est fermée, selon le code stable du serveur. */
function texteFermeture(motif?: string | null): string {
  switch (motif) {
    case "candidature_refusee":
      return "La candidature a été refusée : la discussion est fermée. L'historique reste consultable.";
    case "candidature_retiree":
      return "La candidature a été retirée : la discussion est fermée. L'historique reste consultable.";
    default:
      return "La discussion est fermée. L'historique reste consultable.";
  }
}

/** Motif d'un refus d'envoi 409 (`{"error", "motif", "details"}`). */
function motifDuRefus(err: ApiError): string {
  const motif = (err.details as { motif?: unknown } | null | undefined)?.motif;
  return typeof motif === "string" ? motif : "candidature_close";
}

export function ConversationPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [saisie, setSaisie] = useState("");
  const champSaisie = useRef<HTMLTextAreaElement>(null);
  const finDuFil = useRef<HTMLDivElement>(null);
  const zoneFil = useRef<HTMLDivElement>(null);
  // Hauteur du fil juste avant l'ajout d'une page ancienne en tête : sert à
  // garder sous les yeux le message que l'on lisait.
  const hauteurAvantAnciens = useRef<number | null>(null);

  // Sondage léger de la dernière page : suffisant pour un fil de discussion,
  // sans websocket. Il se suspend quand l'onglet est caché (économie de data
  // mobile) et ne démonte jamais la saisie : le clavier reste ouvert.
  const { conversation, messages, plusAnciens, chargerAnciens, anciensEnCours, erreurAnciens } =
    useFilConversation(matchId);

  // Messages types, chargés une fois. Un serveur antérieur au lot 2.8 répond
  // 404 : aucune puce, et aucun message d'erreur.
  const modeles = useApi((signal) => messagesAPI.modeles(signal), []);
  const listeModeles = modeles.data?.modeles ?? [];

  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const envoiVerrou = useRef(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  // Fermeture apprise par un refus d'envoi (409) : la discussion s'est fermée
  // pendant la saisie, avant que le sondage ne le rapporte.
  const [fermetureVue, setFermetureVue] = useState<{ matchId?: string; motif: string } | null>(
    null,
  );

  const motifVu = fermetureVue && fermetureVue.matchId === matchId ? fermetureVue.motif : null;
  const fermeeServeur = conversation.data?.ecriture_fermee === true;
  const fermee = fermeeServeur || motifVu !== null;
  const motif = fermeeServeur ? conversation.data?.motif_fermeture : motifVu;

  // Défilement vers le bas à l'arrivée d'un nouveau message, mais pas quand
  // une page ancienne s'ajoute en tête.
  const dernierId = messages[messages.length - 1]?.id;
  useEffect(() => {
    finDuFil.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [dernierId]);

  const premierId = messages[0]?.id;
  useLayoutEffect(() => {
    const zone = zoneFil.current;
    const avant = hauteurAvantAnciens.current;
    if (!zone || avant === null) return;
    hauteurAvantAnciens.current = null;
    zone.scrollTop += zone.scrollHeight - avant;
  }, [premierId]);

  function chargerPlusAnciens() {
    hauteurAvantAnciens.current = zoneFil.current?.scrollHeight ?? null;
    void chargerAnciens();
  }

  async function envoyer() {
    const contenu = saisie.trim();
    if (!contenu || !conversation.data || fermee || envoiVerrou.current) return;
    envoiVerrou.current = true;
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    setSaisie("");
    try {
      await messagesAPI.envoyer(conversation.data.id, contenu);
      await conversation.recharger();
    } catch (err) {
      setSaisie(contenu); // échec : on rend son texte à l'utilisateur
      if (err instanceof ApiError && err.statut === 409) {
        setFermetureVue({ matchId, motif: motifDuRefus(err) });
        void conversation.recharger();
      } else {
        setErreurEnvoi(err instanceof ApiError ? err.message : "Une erreur est survenue");
      }
    } finally {
      envoiVerrou.current = false;
      setEnvoiEnCours(false);
    }
  }

  function insererModele(texte: string) {
    setSaisie(texte); // inséré, pas envoyé : l'utilisateur relit d'abord
    champSaisie.current?.focus();
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

        <Link to={`/profil/${interlocuteur?.id}`} aria-label="Voir le profil">
          <Avatar
            nom={interlocuteur?.full_name}
            url={interlocuteur?.avatar_url}
            taille={40}
            surFonce
          />
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

        {conversation.actualisation && (
          <Loader2
            size={14}
            className="animate-spin flex-shrink-0 text-white/40"
            aria-label="Actualisation"
          />
        )}
      </div>

      {/* Bandeau : mise en relation validée, ou discussion fermée. Région
          `status` : la fermeture est annoncée dès qu'elle apparaît. */}
      <div role="status" className="flex-shrink-0">
        {fermee ? (
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: "#F1F5F9", borderBottom: "1px solid #E2E8F0" }}
          >
            <Lock size={14} style={{ color: "#475569", flexShrink: 0 }} aria-hidden="true" />
            <p
              id={ID_EXPLICATION_FERMETURE}
              className="text-xs font-semibold"
              style={{ color: "#334155" }}
            >
              {texteFermeture(motif)}
            </p>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: "#D1FAE5", borderBottom: "1px solid #A7F3D0" }}
          >
            <span style={{ fontSize: "14px" }}>🎉</span>
            <p className="text-xs font-semibold" style={{ color: "#065F46" }}>
              Mise en relation validée — organisez la visite en toute confiance.
            </p>
          </div>
        )}
      </div>

      {conversation.erreurActualisation && (
        <p
          className="px-4 py-1.5 text-xs flex-shrink-0"
          style={{ background: "#FEF3C7", color: "#92400E" }}
          role="status"
        >
          {conversation.erreurActualisation} Les nouveaux messages arriveront au retour du réseau.
        </p>
      )}

      {/* Fil */}
      <div ref={zoneFil} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {plusAnciens && (
          <div className="text-center">
            <button
              type="button"
              onClick={chargerPlusAnciens}
              disabled={anciensEnCours}
              aria-busy={anciensEnCours}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full disabled:opacity-60"
              style={{ background: "white", color: "#1E3A5F", border: "1px solid #E2E8F0" }}
            >
              {anciensEnCours && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              {anciensEnCours ? "Chargement…" : "Charger les messages plus anciens"}
            </button>
          </div>
        )}
        <MessageErreur message={erreurAnciens} />

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
            interlocuteur={interlocuteur}
          />
        ))}
        <div ref={finDuFil} />
      </div>

      {/* Saisie */}
      <div
        className="flex-shrink-0 px-4 py-3 border-t border-gray-200"
        style={{ background: "white" }}
      >
        <MessageErreur message={erreurEnvoi} />
        {/* Messages types : proposés sur une saisie vide, insérés sans envoi. */}
        {!fermee && !saisie && listeModeles.length > 0 && (
          <div
            role="group"
            aria-label="Messages types"
            className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1"
          >
            {listeModeles.map((modele) => (
              <button
                key={modele.id}
                type="button"
                onClick={() => insererModele(modele.texte)}
                className="flex-shrink-0 max-w-[16rem] truncate text-xs px-3 py-1.5 rounded-full"
                style={{ background: "#F0F4FA", color: "#1E3A5F", border: "1px solid #E2E8F0" }}
                title={modele.texte}
              >
                {modele.texte}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 mt-1">
          <textarea
            ref={champSaisie}
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
            placeholder={fermee ? "Discussion fermée" : "Écrivez votre message…"}
            aria-label="Message"
            // Fermée : lecture seule plutôt que `disabled`, pour que le texte
            // rendu après un refus d'envoi reste sélectionnable et copiable.
            readOnly={fermee}
            aria-disabled={fermee || undefined}
            aria-describedby={fermee ? ID_EXPLICATION_FERMETURE : undefined}
            className="flex-1 px-4 py-3 rounded-2xl outline-none resize-none max-h-32"
            style={{
              background: fermee ? "#E2E8F0" : "#F0F4FA",
              border: "1.5px solid #E2E8F0",
              fontSize: "15px",
              color: fermee ? "#64748B" : undefined,
              cursor: fermee ? "not-allowed" : undefined,
            }}
          />
          <button
            onClick={envoyer}
            disabled={fermee || !saisie.trim() || envoiEnCours}
            aria-describedby={fermee ? ID_EXPLICATION_FERMETURE : undefined}
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
  interlocuteur,
}: {
  message: Message;
  estMien: boolean;
  precedent?: Message;
  interlocuteur?: User;
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
          <span className="mb-1">
            <Avatar
              nom={interlocuteur?.full_name}
              url={interlocuteur?.avatar_url}
              taille={28}
              forme="rond"
            />
          </span>
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
