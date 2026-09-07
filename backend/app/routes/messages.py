"""
routes/messages.py — Messagerie intégrée.

Une conversation n'existe qu'adossée à une candidature acceptée : c'est ce qui
garantit qu'aucun échange n'a lieu avant que les deux parties se soient
mutuellement choisies.
"""
from datetime import datetime

from flask import Blueprint, jsonify, request

from app import db
from app.models import Conversation, Message
from app.routes import current_user_required
from app.services import notifications as notify

messages_bp = Blueprint("messages", __name__)

LONGUEUR_MAX = 2000


def _conversation_autorisee(conversation, user):
    return user.id in (conversation.tenant_id, conversation.landlord_id)


def _fil_complet(conversation, user):
    """Sérialise le fil et marque comme lus les messages reçus par `user`."""
    non_lus = conversation.messages.filter(Message.sender_id != user.id,
                                           Message.read_at.is_(None)).all()
    for message in non_lus:
        message.read_at = datetime.utcnow()
    if non_lus:
        db.session.commit()

    return {
        **conversation.to_dict(user_id=user.id),
        "messages": [m.to_dict() for m in conversation.messages],
    }


# ─── GET /api/messages/conversations ─────────────────────────

@messages_bp.route("/conversations", methods=["GET"])
@current_user_required
def liste_conversations(current_user):
    conversations = (Conversation.query
                     .filter(db.or_(Conversation.tenant_id == current_user.id,
                                    Conversation.landlord_id == current_user.id))
                     .order_by(Conversation.last_message_at.desc())
                     .all())

    data = [c.to_dict(user_id=current_user.id) for c in conversations]
    return jsonify({
        "conversations": data,
        "total": len(data),
        "non_lus": sum(c["nb_non_lus"] for c in data),
    }), 200


# ─── GET /api/messages/conversations/<id> ────────────────────

@messages_bp.route("/conversations/<string:conversation_id>", methods=["GET"])
@current_user_required
def get_conversation(current_user, conversation_id):
    """Retourne le fil complet et marque comme lus les messages reçus."""
    conversation = Conversation.query.get_or_404(conversation_id)
    if not _conversation_autorisee(conversation, current_user):
        return jsonify({"error": "Non autorisé"}), 403

    return jsonify(_fil_complet(conversation, current_user)), 200


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

    return jsonify(_fil_complet(conversation, current_user)), 200


# ─── POST /api/messages/conversations/<id> ───────────────────

@messages_bp.route("/conversations/<string:conversation_id>", methods=["POST"])
@current_user_required
def envoyer_message(current_user, conversation_id):
    conversation = Conversation.query.get_or_404(conversation_id)
    if not _conversation_autorisee(conversation, current_user):
        return jsonify({"error": "Non autorisé"}), 403

    contenu = ((request.get_json() or {}).get("contenu") or "").strip()
    if not contenu:
        return jsonify({"error": "Message vide"}), 400
    if len(contenu) > LONGUEUR_MAX:
        return jsonify({"error": f"Message trop long ({LONGUEUR_MAX} caractères maximum)"}), 400

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
                               contenu, conversation.id)

    db.session.commit()
    return jsonify({"message": "Message envoyé", "data": message.to_dict()}), 201


# ─── GET /api/messages/non-lus ───────────────────────────────

@messages_bp.route("/non-lus", methods=["GET"])
@current_user_required
def compteur_non_lus(current_user):
    """Alimente la pastille de la barre de navigation."""
    total = (Message.query
             .join(Conversation, Message.conversation_id == Conversation.id)
             .filter(db.or_(Conversation.tenant_id == current_user.id,
                            Conversation.landlord_id == current_user.id),
                     Message.sender_id != current_user.id,
                     Message.read_at.is_(None))
             .count())
    return jsonify({"non_lus": total}), 200
