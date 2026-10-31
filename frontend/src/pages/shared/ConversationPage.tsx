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
import { ArrowLeft, CalendarDays, House, Loader2, Lock, Send, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError, matchesAPI, messagesAPI, urlFichier, type Message, type Role } from "../../api";
import { BadgeProprietaireVerifie } from "../../components/BadgeVerification";
import { Chargement, Erreur, MessageErreur } from "../../components/Etats";
import { PhotoAnnonce } from "../../components/PhotoAnnonce";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { useFilConversation } from "../../hooks/useFilConversation";
import { formatMontantCourt } from "../../lib/format";
import { HAUTEUR_REPLI, LARGEUR_REPLI } from "../../lib/imageRepli";

const ID_EXPLICATION_FERMETURE = "explication-fermeture";

/** Rôle de l'interlocuteur, sous le titre de l'annonce (maquette Discussion). */
const ROLES: Record<Role, string> = {
  tenant: "Locataire",
  landlord: "Propriétaire",
  agency: "Agence",
  admin: "Administrateur",
};

/** « Samedi 2 nov. · 10:00 » */
function formatJourVisite(date: Date) {
  const jour = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} · ${heure}`;
}

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

  // Mise en relation : la date de visite planifiée, si elle existe. Un échec
  // n'affiche rien (la carte de visite est un complément).
  const match = useApi(() => matchesAPI.detail(matchId!), [matchId], { actif: Boolean(matchId) });

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

  async function chargerPlusAnciens() {
    hauteurAvantAnciens.current = zoneFil.current?.scrollHeight ?? null;
    // Échec : aucune page ajoutée. Une hauteur restée en mémoire décalerait
    // le défilement au prochain changement du premier message (fil reparti
    // d'une nouvelle page, par exemple).
    if (!(await chargerAnciens())) hauteurAvantAnciens.current = null;
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
      <div className="sous-barre-etat min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement texte="Ouverture de la discussion…" />
      </div>
    );
  }

  if (conversation.erreur || !conversation.data) {
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
            <ArrowLeft size={20} aria-hidden="true" />
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
  const role = interlocuteur?.role ? ROLES[interlocuteur.role] : null;
  const visite = match.data?.visite_date ? new Date(match.data.visite_date) : null;

  return (
    <div className="flex flex-col h-dvh" style={{ background: "#F0F4FA" }}>
      {/* En-tête : retour, vignette de l'annonce, titre, rôle de l'interlocuteur */}
      <header
        className="flex items-center gap-2.5 shrink-0 text-white"
        // Fond sous la barre d'état (bord à bord, index.css), contenu en dessous.
        style={{ background: "#1E3A5F", padding: "calc(12px + var(--inset-haut)) 12px 14px" }}
      >
        <button
          type="button"
          onClick={() => navigate("/messages")}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full"
          aria-label="Retour aux messages"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>

        <span className="w-[42px] h-[42px] rounded-[14px] overflow-hidden shrink-0" style={{ background: "#E2E8F0" }}>
          <PhotoAnnonce
            url={urlFichier(listing?.images?.[0])}
            tailles="42px"
            alt=""
            width={LARGEUR_REPLI}
            height={HAUTEUR_REPLI}
            className="w-full h-full object-cover"
            decoding="async"
          />
        </span>

        <div className="grow min-w-0">
          <p className="m-0 font-extrabold truncate" style={{ fontSize: 16 }}>
            {listing?.title ?? interlocuteur?.full_name ?? "Discussion"}
          </p>
          <p className="m-0 truncate" style={{ fontSize: 12, color: "rgba(255,255,255,0.78)" }}>
            {[role, interlocuteur?.full_name, listing && `${formatMontantCourt(listing.prix, listing.devise)}/mois`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {interlocuteur?.proprietaire_verifie && (
            <div className="mt-0.5">
              <BadgeProprietaireVerifie utilisateur={interlocuteur} />
            </div>
          )}
        </div>

        {conversation.actualisation && (
          <Loader2 size={14} className="animate-spin shrink-0 text-white/60" aria-label="Actualisation" />
        )}
        {interlocuteur && (
          <Link
            to={`/profil/${interlocuteur.id}`}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white"
            aria-label="Voir le profil"
          >
            <UserRound size={20} aria-hidden="true" />
          </Link>
        )}
        {listing && (
          <Link
            to={`/listing/${listing.id}`}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white"
            aria-label="Voir l'annonce"
          >
            <House size={20} aria-hidden="true" />
          </Link>
        )}
      </header>

      {/* Discussion fermée : bandeau, annoncé dès qu'il apparaît (région status). */}
      <div role="status" className="shrink-0">
        {fermee && (
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "#F1F5F9", borderBottom: "1px solid #E2E8F0" }}>
            <Lock size={14} style={{ color: "#475569", flexShrink: 0 }} aria-hidden="true" />
            <p id={ID_EXPLICATION_FERMETURE} className="m-0 text-xs font-semibold" style={{ color: "#334155" }}>
              {texteFermeture(motif)}
            </p>
          </div>
        )}
      </div>

      {conversation.erreurActualisation && (
        <p className="m-0 px-4 py-1.5 text-xs shrink-0" style={{ background: "#FEF3C7", color: "#92400E" }} role="status">
          {conversation.erreurActualisation} Les nouveaux messages arriveront au retour du réseau.
        </p>
      )}

      {/* Fil */}
      <div ref={zoneFil} className="flex-1 overflow-y-auto flex flex-col gap-2.5" style={{ padding: "16px 16px 8px" }}>
        {!fermee && (
          <p
            className="m-0 self-center rounded-full font-bold text-center"
            style={{ padding: "6px 12px", background: "#DCFCE7", color: "#047857", fontSize: 12 }}
          >
            Mise en relation validée · organisez la visite en toute confiance
          </p>
        )}

        {plusAnciens && (
          <div className="text-center">
            <button
              type="button"
              onClick={chargerPlusAnciens}
              disabled={anciensEnCours}
              aria-busy={anciensEnCours}
              className="inline-flex items-center gap-1.5 text-xs font-bold h-11 px-4 rounded-full disabled:opacity-60"
              style={{ background: "white", color: "#1E3A5F", border: "1px solid #CBD5E1" }}
            >
              {anciensEnCours && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              {anciensEnCours ? "Chargement…" : "Charger les messages plus anciens"}
            </button>
          </div>
        )}
        <MessageErreur message={erreurAnciens} />

        {messages.length === 0 && (
          <p className="m-0 text-center text-sm py-10" style={{ color: "#475569" }}>
            Aucun message pour l'instant. Lancez la discussion.
          </p>
        )}

        {messages.map((message, i) => (
          <Bulle key={message.id} message={message} estMien={message.sender_id === user?.id} precedent={messages[i - 1]} />
        ))}

        {/* Visite planifiée : date et heure seulement (la confirmation par
            l'autre partie relève du lot 2.7 suite). */}
        {visite && (
          <div
            className="mt-1 flex items-center gap-3 bg-white"
            style={{ padding: 14, borderRadius: 18, border: "1.5px solid #FED7AA" }}
          >
            <span className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: "#FFF7ED" }}>
              <CalendarDays size={22} color="#C2410C" aria-hidden="true" />
            </span>
            <div>
              <p className="m-0 font-semibold" style={{ fontSize: 12, color: "#475569" }}>
                Visite planifiée
              </p>
              <p className="m-0 font-extrabold" style={{ fontSize: 15, color: "#1E3A5F" }}>
                {formatJourVisite(visite)}
              </p>
            </div>
          </div>
        )}
        <div ref={finDuFil} />
      </div>

      {/* Messages types : pastilles au-dessus de la saisie, insérées sans envoi. */}
      {!fermee && !saisie && listeModeles.length > 0 && (
        <div
          role="group"
          aria-label="Messages types"
          className="flex gap-2 overflow-x-auto shrink-0 [&::-webkit-scrollbar]:hidden"
          style={{ padding: "4px 16px 10px", scrollbarWidth: "none" }}
        >
          {listeModeles.map((modele) => (
            <button
              key={modele.id}
              type="button"
              onClick={() => insererModele(modele.texte)}
              className="shrink-0 max-w-[16rem] truncate h-9 px-3 rounded-full font-semibold bg-white relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']"
              style={{ border: "1px solid #CBD5E1", color: "#1E3A5F", fontSize: 13 }}
              title={modele.texte}
            >
              {modele.texte}
            </button>
          ))}
        </div>
      )}

      {/* Saisie : champ en pilule, envoi rond orange, au-dessus de la barre de gestes. */}
      <div
        className="shrink-0 bg-white"
        style={{ padding: "10px 12px", paddingBottom: "calc(10px + var(--inset-bas))", borderTop: "1px solid #E2E8F0" }}
      >
        <MessageErreur message={erreurEnvoi} />
        <div className="flex items-end gap-2.5">
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
            enterKeyHint="send"
            // Fermée : lecture seule plutôt que `disabled`, pour que le texte
            // rendu après un refus d'envoi reste sélectionnable et copiable.
            readOnly={fermee}
            aria-disabled={fermee || undefined}
            aria-describedby={fermee ? ID_EXPLICATION_FERMETURE : undefined}
            className="grow min-w-0 rounded-[23px] outline-none resize-none max-h-32"
            style={{
              minHeight: 46,
              padding: "12px 16px",
              background: fermee ? "#E2E8F0" : "#F8FAFC",
              border: "1.5px solid #E2E8F0",
              fontSize: 15,
              color: fermee ? "#475569" : "#1E293B",
              cursor: fermee ? "not-allowed" : undefined,
            }}
          />
          <button
            type="button"
            onClick={envoyer}
            disabled={fermee || !saisie.trim() || envoiEnCours}
            aria-describedby={fermee ? ID_EXPLICATION_FERMETURE : undefined}
            className="w-[46px] h-[46px] rounded-full text-white shrink-0 flex items-center justify-center disabled:opacity-40"
            style={{ background: "#F97316" }}
            aria-label="Envoyer"
          >
            <Send size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bulle({ message, estMien, precedent }: { message: Message; estMien: boolean; precedent?: Message }) {
  const date = message.created_at ? new Date(message.created_at) : new Date();
  const nouveauJour =
    !precedent ||
    (precedent.created_at && new Date(precedent.created_at).toDateString() !== date.toDateString());
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {nouveauJour && (
        <p className="m-0 my-2 self-center">
          <span className="text-xs px-3 py-1 rounded-full" style={{ background: "#E2E8F0", color: "#475569" }}>
            {date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </span>
        </p>
      )}
      <div
        className={`max-w-[75%] ${estMien ? "self-end" : "self-start"}`}
        style={{
          padding: "11px 14px",
          borderRadius: estMien ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
          background: estMien ? "#1E3A5F" : "#ffffff",
          color: estMien ? "#ffffff" : "#1E293B",
          fontSize: 14,
          lineHeight: 1.45,
          boxShadow: estMien ? undefined : "0 2px 8px rgba(15,32,64,0.06)",
        }}
      >
        <p className="m-0 whitespace-pre-wrap break-words">{message.contenu}</p>
        <p
          className={`m-0 mt-1 ${estMien ? "text-right" : ""}`}
          style={{ fontSize: 11, color: estMien ? "rgba(255,255,255,0.78)" : "#475569" }}
        >
          {heure}
          {estMien && message.lu && " · Lu"}
        </p>
      </div>
    </>
  );
}
