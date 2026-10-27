"""
routes/messages.py — Messagerie intégrée.

Une conversation n'existe qu'adossée à une candidature acceptée : c'est ce qui
garantit qu'aucun échange n'a lieu avant que les deux parties se soient
mutuellement choisies.

Messagerie bornée (lot 2.8) : l'écriture suit le statut COURANT de la
candidature. Après un refus ou un retrait, le fil reste lisible par les deux
participants, mais plus personne n'y écrit.
"""
from datetime import datetime

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from app import db
from app.models import Conversation, Match, Message
from app.routes import current_user_required
from app.schemas import ErreurValidation, erreur_champ, valider_corps
from app.schemas.messages import (
    CONVERSATIONS_PAR_PAGE_DEFAUT,
    LIMITE_MESSAGES_DEFAUT,
    NouveauMessage,
    PageConversations,
    PageMessages,
)
from app.services import notifications as notify

messages_bp = Blueprint("messages", __name__)


# ─── Écriture : ouverte ou fermée ────────────────────────────

# Statuts de candidature qui laissent écrire dans la conversation. Liste
# blanche : un statut inconnu ou ajouté plus tard ferme l'écriture tant que
# personne n'a décidé de l'ouvrir. `completed` reste ouvert : bailleur et
# locataire ont encore à s'écrire après la conclusion (remise des clés,
# entretien, état des lieux). `pending` n'a en pratique pas de conversation
# (elle s'ouvre à l'acceptation) ; il est listé pour qu'une candidature
# remise en attente ne coupe pas un échange en cours.
STATUTS_OUVRANT_ECRITURE = ("pending", "accepted", "completed")

# Motif de fermeture exposé au client (`motif_fermeture`, code stable) et
# message affiché tel quel en cas de tentative d'envoi.
MOTIFS_FERMETURE = {
    "rejected":  ("candidature_refusee",
                  "Cette discussion est fermée : la candidature a été refusée. "
                  "L'historique reste consultable."),
    "cancelled": ("candidature_retiree",
                  "Cette discussion est fermée : la candidature a été retirée. "
                  "L'historique reste consultable."),
}
MOTIF_FERMETURE_AUTRE = ("candidature_close",
                         "Cette discussion est fermée. L'historique reste consultable.")


def motif_fermeture(candidature):
    """`None` si l'on peut écrire dans la conversation de `candidature`,
    sinon le couple `(code, message)` du motif de fermeture.

    Une conversation sans candidature n'existe pas (`match_id` non nul, clé
    étrangère, suppression en cascade) ; si cela arrivait, l'écriture serait
    fermée : fermer par défaut.
    """
    if candidature is not None and candidature.status in STATUTS_OUVRANT_ECRITURE:
        return None
    statut = candidature.status if candidature is not None else None
    return MOTIFS_FERMETURE.get(statut, MOTIF_FERMETURE_AUTRE)


def _candidature_verrouillee(match_id):
    """Relit la candidature en posant un verrou sur sa ligne.

    Un envoi et un refus (ou un retrait) peuvent arriver en même temps. Le
    refus écrit `matches.status` par un `UPDATE`, qui verrouille la ligne
    jusqu'à son commit ; le `SELECT … FOR UPDATE` de l'envoi attend donc ce
    commit, puis lit le statut refusé et rejette le message. Si l'envoi
    prend le verrou le premier, c'est le refus qui attend : le message est
    antérieur au refus, et légitime. Sans verrou, un message lu « acceptée »
    juste avant le refus serait écrit juste après. SQLite ignore le verrou,
    mais n'a qu'un écrivain à la fois. `populate_existing` force la relecture
    même si la candidature est déjà dans la session.
    """
    return db.session.execute(
        db.select(Match).filter_by(id=match_id).with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


# ─── Sérialisation ───────────────────────────────────────────

def _conversation_autorisee(conversation, user):
    return user.id in (conversation.tenant_id, conversation.landlord_id)


def _conversation(conversation, user):
    """`Conversation.to_dict`, plus l'état de l'écriture (ajout du lot 2.8) :
    le client grise la saisie et explique pourquoi."""
    data = conversation.to_dict(user_id=user.id)
    motif = motif_fermeture(conversation.match)
    data["ecriture_fermee"] = motif is not None
    data["motif_fermeture"] = motif[0] if motif else None
    return data


def _parametres(schema):
    """Valide les paramètres d'URL ; une erreur donne le même 422 qu'un corps."""
    try:
        return schema.model_validate(request.args.to_dict())
    except ValidationError as exc:
        raise ErreurValidation(exc) from exc


def _marquer_lus(messages, user):
    non_lus = [m for m in messages if m.sender_id != user.id and m.read_at is None]
    for message in non_lus:
        message.read_at = datetime.utcnow()
    if non_lus:
        db.session.commit()


def _fil(conversation, user):
    """Sérialise le fil et marque comme lus les messages reçus par `user`.

    Sans paramètre : le fil complet, comme avant le lot 2.8 (le web actuel
    l'attend ; une borne par défaut lui ferait perdre les anciens messages).
    Avec `limite` ou `avant` : une page, du plus ancien au plus récent, et
    seuls les messages de la page sont marqués lus (lu = affiché).
    """
    page = _parametres(PageMessages)
    if page.limite is None and page.avant is None:
        _marquer_lus(conversation.messages.filter(Message.sender_id != user.id,
                                                  Message.read_at.is_(None)).all(), user)
        return {
            **_conversation(conversation, user),
            "messages": [m.to_dict() for m in conversation.messages],
        }

    limite = page.limite or LIMITE_MESSAGES_DEFAUT
    query = Message.query.filter(Message.conversation_id == conversation.id)
    if page.avant is not None:
        # Le curseur doit appartenir à CETTE conversation : un identifiant
        # d'un autre fil ne dit rien de plus qu'un identifiant inventé.
        curseur = Message.query.filter_by(id=page.avant,
                                          conversation_id=conversation.id).first()
        if curseur is None:
            raise erreur_champ("avant", "curseur_inconnu",
                               "Curseur inconnu pour cette conversation", page.avant)
        # Ordre total (date, puis identifiant) : deux messages de même
        # horodatage ne sont ni perdus ni répétés d'une page à l'autre.
        query = query.filter(db.or_(
            Message.created_at < curseur.created_at,
            db.and_(Message.created_at == curseur.created_at, Message.id < curseur.id),
        ))

    # Une ligne de plus que demandé : elle dit s'il reste des messages plus
    # anciens, sans requête de comptage.
    lignes = (query.order_by(Message.created_at.desc(), Message.id.desc())
              .limit(limite + 1).all())
    plus_anciens = len(lignes) > limite
    messages = list(reversed(lignes[:limite]))
    _marquer_lus(messages, user)

    return {
        **_conversation(conversation, user),
        "messages": [m.to_dict() for m in messages],
        "pagination": {
            "limite": limite,
            "plus_anciens": plus_anciens,
            # À passer en `avant` pour la page suivante (plus ancienne).
            "curseur": messages[0].id if plus_anciens else None,
        },
    }


def _requete_non_lus(user):
    return (Message.query
            .join(Conversation, Message.conversation_id == Conversation.id)
            .filter(db.or_(Conversation.tenant_id == user.id,
                           Conversation.landlord_id == user.id),
                    Message.sender_id != user.id,
                    Message.read_at.is_(None)))


# ─── GET /api/messages/conversations ─────────────────────────

@messages_bp.route("/conversations", methods=["GET"])
@current_user_required
def liste_conversations(current_user):
    """Sans paramètre : toutes les conversations, comme avant le lot 2.8.
    Avec `page` ou `per_page` : une page, et `non_lus` reste le total de
    TOUTES les conversations (c'est la pastille de navigation)."""
    pagination = _parametres(PageConversations)
    query = (Conversation.query
             .filter(db.or_(Conversation.tenant_id == current_user.id,
                            Conversation.landlord_id == current_user.id))
             .order_by(Conversation.last_message_at.desc(),
                       # Départage stable d'une page à l'autre.
                       Conversation.id))

    if pagination.page is None and pagination.per_page is None:
        data = [_conversation(c, current_user) for c in query.all()]
        return jsonify({
            "conversations": data,
            "total": len(data),
            "non_lus": sum(c["nb_non_lus"] for c in data),
        }), 200

    page = pagination.page or 1
    per_page = pagination.per_page or CONVERSATIONS_PAR_PAGE_DEFAUT
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "conversations": [_conversation(c, current_user) for c in paginated.items],
        "total": paginated.total,
        "pages": paginated.pages,
        "page": page,
        "per_page": per_page,
        "non_lus": _requete_non_lus(current_user).count(),
    }), 200


# ─── GET /api/messages/conversations/<id> ────────────────────

@messages_bp.route("/conversations/<string:conversation_id>", methods=["GET"])
@current_user_required
def get_conversation(current_user, conversation_id):
    """Retourne le fil (complet, ou une page) et marque comme lus les messages
    reçus. Un fil fermé à l'écriture reste lisible."""
    conversation = Conversation.query.get_or_404(conversation_id)
    if not _conversation_autorisee(conversation, current_user):
        return jsonify({"error": "Non autorisé"}), 403

    return jsonify(_fil(conversation, current_user)), 200


# ─── GET /api/messages/par-match/<match_id> ──────────────────

@messages_bp.route("/par-match/<string:match_id>", methods=["GET"])
@current_user_required
def conversation_par_match(current_user, match_id):
    """Permet au frontend d'ouvrir un fil à partir d'un identifiant de match."""
    conversation = Conversation.query.filter_by(match_id=match_id).first()
    if not conversation:
        return jsonify({"error": "Aucune conversation pour cette candidature. "
                                 "Elle s'ouvre lorsque le propriétaire accepte le dossier."}), 404
    if not _conversation_autorisee(conversation, current_user):
        return jsonify({"error": "Non autorisé"}), 403

    return jsonify(_fil(conversation, current_user)), 200


# ─── POST /api/messages/conversations/<id> ───────────────────

@messages_bp.route("/conversations/<string:conversation_id>", methods=["POST"])
@current_user_required
@valider_corps(NouveauMessage)
def envoyer_message(current_user, conversation_id, corps):
    conversation = Conversation.query.get_or_404(conversation_id)
    if not _conversation_autorisee(conversation, current_user):
        return jsonify({"error": "Non autorisé"}), 403

    # Contrôle serveur à chaque envoi, sous verrou (voir
    # `_candidature_verrouillee`) : griser la saisie côté web ne suffit pas.
    motif = motif_fermeture(_candidature_verrouillee(conversation.match_id))
    if motif is not None:
        code, message_erreur = motif
        return jsonify({"error": message_erreur, "motif": code, "details": []}), 409

    contenu = corps.contenu

    message = Message(
        conversation_id=conversation.id,
        sender_id=current_user.id,
        contenu=contenu,
    )
    db.session.add(message)
    conversation.last_message_at = datetime.utcnow()

    destinataire = conversation.autre_participant(current_user.id)
    if destinataire:
        notify.nouveau_message(destinataire.id, current_user.full_name,
                               contenu, conversation.match_id)

    db.session.commit()
    return jsonify({"message": "Message envoyé", "data": message.to_dict()}), 201


# ─── GET /api/messages/non-lus ───────────────────────────────

@messages_bp.route("/non-lus", methods=["GET"])
@current_user_required
def compteur_non_lus(current_user):
    """Alimente la pastille de la barre de navigation."""
    return jsonify({"non_lus": _requete_non_lus(current_user).count()}), 200


# ─── GET /api/messages/modeles ───────────────────────────────

# Messages types proposés à la saisie, selon le côté de la conversation.
# TEXTE À VALIDER PAR KAMANO (question posée dans la PR du lot 2.8) : liste
# courte et neutre, rédigée pour une conversation déjà ouverte (candidature
# acceptée). `id` est stable : le client s'en sert comme clé, et une
# traduction future le gardera.
MODELES_MESSAGES = {
    "locataire": [
        {"id": "visite",
         "texte": "Bonjour, merci d'avoir retenu ma candidature. "
                  "Quand puis-je visiter le logement ?"},
        {"id": "date_entree",
         "texte": "À partir de quelle date le logement est-il disponible ?"},
        {"id": "montants",
         "texte": "Pouvez-vous me confirmer le montant du loyer et des charges ?"},
        {"id": "documents",
         "texte": "Quels documents dois-je préparer pour la suite ?"},
    ],
    "bailleur": [
        {"id": "visite",
         "texte": "Bonjour, votre candidature a retenu mon attention. "
                  "Quand êtes-vous disponible pour une visite ?"},
        {"id": "date_entree",
         "texte": "À quelle date souhaitez-vous emménager ?"},
        {"id": "questions",
         "texte": "Avez-vous des questions sur le logement ?"},
        {"id": "suite",
         "texte": "Merci pour votre réponse, je reviens vers vous rapidement."},
    ],
}

COTE_PAR_ROLE = {"tenant": "locataire", "landlord": "bailleur", "agency": "bailleur"}


@messages_bp.route("/modeles", methods=["GET"])
@current_user_required
def modeles_messages(current_user):
    """Messages types du côté de l'appelant. Un compte qui ne participe à
    aucune conversation (admin) n'en reçoit aucun."""
    cote = COTE_PAR_ROLE.get(current_user.role)
    return jsonify({
        "cote": cote,
        "modeles": MODELES_MESSAGES.get(cote, []),
    }), 200
