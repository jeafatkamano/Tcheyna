/**
 * MessagesList.tsx — Liste des discussions (maquette Messages, lot 3.15b).
 *
 * Chaque discussion : vignette de l'annonce, titre, dernier message (« Vous : »
 * quand il est de soi), heure, nombre de non-lus et statut de la candidature.
 * Le statut vient de la liste des candidatures (mes-candidatures ou
 * mes-demandes), sans changement d'API ; s'il manque, la pastille ne
 * s'affiche pas.
 *
 * Lot 2.8 : la liste se charge par pages de 20 (« Afficher plus ») quand le
 * serveur la pagine ; un serveur antérieur ignore `page` et renvoie tout, sans
 * bouton. Une discussion fermée à l'écriture porte la mention « Fermée ».
 */
import { Loader2, Lock, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import {
  ApiError,
  matchesAPI,
  messagesAPI,
  urlFichier,
  type Conversation,
  type Match,
  type MatchStatus,
  type PageConversations,
} from "../../api";
import { BadgeProprietaireVerifie } from "../../components/BadgeVerification";
import { BoutonNotifications, EnTetePage } from "../../components/EnTetePage";
import { Erreur, ListeVide, MessageErreur, SqueletteCartes } from "../../components/Etats";
import { PhotoAnnonce } from "../../components/PhotoAnnonce";
import { PastilleStatut } from "../../components/StatutCandidature";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { formatHeureMessage, formatMontantCourt } from "../../lib/format";
import { HAUTEUR_REPLI, LARGEUR_REPLI } from "../../lib/imageRepli";
import { transitionPage } from "../../lib/transitions";

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
  const estLocataire = user?.role === "tenant";
  const conversations = useApi(
    (signal) => messagesAPI.conversations({ page: 1, per_page: PAR_PAGE }, signal),
    [],
  );

  // Statut de chaque candidature, par identifiant de mise en relation. Un
  // échec n'empêche pas la liste : la pastille ne s'affiche pas.
  const candidatures = useApi(
    (): Promise<{ matches: Match[] }> =>
      user?.role === "admin"
        ? Promise.resolve({ matches: [] })
        : estLocataire
          ? matchesAPI.mesCandidatures()
          : matchesAPI.mesDemandes(),
    [user?.role],
  );
  const statuts = new Map<string, MatchStatus>(
    (candidatures.data?.matches ?? []).map((m) => [m.id, m.status]),
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

  const nonLus = conversations.data?.non_lus ?? 0;

  return (
    <div className="pb-6">
      <EnTetePage titre="Messages" droite={<BoutonNotifications />}>
        <p className="m-0 -mt-2" style={{ fontSize: 14, color: "rgba(255,255,255,0.78)" }}>
          {nonLus
            ? `${nonLus} message${nonLus > 1 ? "s" : ""} non lu${nonLus > 1 ? "s" : ""}`
            : estLocataire
              ? "Vos échanges avec les propriétaires"
              : "Vos échanges avec les candidats"}
        </p>
      </EnTetePage>

      <div className="px-4 pt-4 flex flex-col gap-2.5">
        {conversations.chargement ? (
          <SqueletteCartes nombre={2} />
        ) : conversations.erreur ? (
          <Erreur message={conversations.erreur} onReessayer={conversations.recharger} />
        ) : !conversations.data?.conversations.length ? (
          <ListeVide
            titre="Aucune discussion"
            description={
              estLocataire
                ? "Une discussion s'ouvre dès qu'un propriétaire accepte votre candidature."
                : "Une discussion s'ouvre dès que vous acceptez une candidature."
            }
            icone={<MessageSquare size={26} style={{ color: "#64748B" }} />}
            action={
              estLocataire
                ? { label: "Voir les annonces", to: "/tenant/listings" }
                : { label: "Voir les candidats", to: "/owner/matches" }
            }
          />
        ) : (
          liste.map((conversation) => (
            <CarteDiscussion
              key={conversation.id}
              conversation={conversation}
              moi={user?.id}
              statut={statuts.get(conversation.match_id)}
            />
          ))
        )}

        <MessageErreur message={erreurSuite} />
        {encoreDesPages && !conversations.erreur && (
          <button
            type="button"
            onClick={afficherPlus}
            disabled={suiteEnCours}
            aria-busy={suiteEnCours}
            className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-bold disabled:opacity-60"
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

function CarteDiscussion({
  conversation,
  moi,
  statut,
}: {
  conversation: Conversation;
  moi?: string;
  statut?: MatchStatus;
}) {
  const nbNonLus = conversation.nb_non_lus ?? 0;
  const nonLus = nbNonLus > 0;
  const { listing, interlocuteur, dernier_message: dernier } = conversation;
  const deMoi = dernier && dernier.sender_id === moi;

  return (
    <Link
      to={`/messages/${conversation.match_id}`}
      viewTransition={transitionPage()}
      className="flex gap-3 items-center bg-white no-underline"
      style={{
        padding: 14,
        borderRadius: 20,
        color: "#1E293B",
        boxShadow: "0 4px 14px rgba(15,32,64,0.06)",
      }}
    >
      <span className="w-14 h-14 rounded-2xl overflow-hidden shrink-0" style={{ background: "#E2E8F0" }}>
        <PhotoAnnonce
          url={urlFichier(listing?.images?.[0])}
          tailles="56px"
          alt=""
          width={LARGEUR_REPLI}
          height={HAUTEUR_REPLI}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </span>

      <span className="grow min-w-0">
        <span className="flex justify-between gap-2">
          <span className="truncate" style={{ fontSize: 15, fontWeight: nonLus ? 800 : 700 }}>
            {listing?.title ?? interlocuteur?.full_name ?? "Discussion"}
          </span>
          <span
            className="shrink-0"
            style={{ fontSize: 12, fontWeight: nonLus ? 700 : 400, color: nonLus ? "#C2410C" : "#475569" }}
          >
            {formatHeureMessage(conversation.last_message_at)}
          </span>
        </span>

        <span className="flex justify-between gap-2 mt-1 items-center">
          <span
            className="truncate"
            style={{ fontSize: 13, fontWeight: nonLus ? 600 : 400, color: nonLus ? "#1E293B" : "#475569" }}
          >
            {dernier ? `${deMoi ? "Vous : " : ""}${dernier.contenu}` : "Démarrez la discussion"}
          </span>
          {nonLus && (
            <span
              className="min-w-5 h-5 px-1.5 rounded-full text-white flex items-center justify-center font-extrabold shrink-0"
              style={{ background: "#F97316", fontSize: 11 }}
              aria-label={`${nbNonLus} non lu${nbNonLus > 1 ? "s" : ""}`}
            >
              {nbNonLus}
            </span>
          )}
        </span>

        <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {statut && <PastilleStatut statut={statut} />}
          {conversation.ecriture_fermee && (
            <span
              className="inline-flex items-center gap-1 rounded-full font-bold"
              style={{ padding: "2px 8px", background: "#F1F5F9", color: "#475569", fontSize: 11 }}
              title="Discussion fermée : l'historique reste consultable"
            >
              <Lock size={10} aria-hidden="true" />
              Fermée
            </span>
          )}
          <span className="truncate" style={{ fontSize: 12, color: "#475569" }}>
            {interlocuteur?.full_name ?? "Interlocuteur"}
            {listing && ` · ${formatMontantCourt(listing.prix, listing.devise)}/mois`}
          </span>
          {interlocuteur?.proprietaire_verifie && <BadgeProprietaireVerifie utilisateur={interlocuteur} />}
        </span>
      </span>
    </Link>
  );
}
