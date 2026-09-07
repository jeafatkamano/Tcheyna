"""routes/notifications.py — Notifications in-app."""
from datetime import datetime

from flask import Blueprint, jsonify, request

from app import db
from app.models import Notification
from app.routes import current_user_required

notifications_bp = Blueprint("notifications", __name__)


# ─── GET /api/notifications ──────────────────────────────────

@notifications_bp.route("/", methods=["GET"])
@current_user_required
def liste(current_user):
    limite = min(request.args.get("limite", 30, type=int), 100)
    query = current_user.notifications
    if request.args.get("non_lues", "").lower() in ("true", "1"):
        query = query.filter(Notification.read_at.is_(None))

    notifs = query.order_by(Notification.created_at.desc()).limit(limite).all()

    return jsonify({
        "notifications": [n.to_dict() for n in notifs],
        "non_lues": current_user.notifications.filter(Notification.read_at.is_(None)).count(),
    }), 200


# ─── GET /api/notifications/non-lues ─────────────────────────

@notifications_bp.route("/non-lues", methods=["GET"])
@current_user_required
def compteur(current_user):
    total = current_user.notifications.filter(Notification.read_at.is_(None)).count()
    return jsonify({"non_lues": total}), 200


# ─── PUT /api/notifications/<id>/lue ─────────────────────────

@notifications_bp.route("/<string:notif_id>/lue", methods=["PUT"])
@current_user_required
def marquer_lue(current_user, notif_id):
    notif = Notification.query.get_or_404(notif_id)
    if notif.user_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    if not notif.read_at:
        notif.read_at = datetime.utcnow()
        db.session.commit()

    return jsonify({"message": "Notification lue"}), 200


# ─── PUT /api/notifications/tout-lire ────────────────────────

@notifications_bp.route("/tout-lire", methods=["PUT"])
@current_user_required
def tout_marquer_lu(current_user):
    maintenant = datetime.utcnow()
    nb = (Notification.query
          .filter(Notification.user_id == current_user.id,
                  Notification.read_at.is_(None))
          .update({"read_at": maintenant}, synchronize_session=False))
    db.session.commit()
    return jsonify({"message": f"{nb} notification(s) marquée(s) comme lue(s)"}), 200


# ─── DELETE /api/notifications/<id> ──────────────────────────

@notifications_bp.route("/<string:notif_id>", methods=["DELETE"])
@current_user_required
def supprimer(current_user, notif_id):
    notif = Notification.query.get_or_404(notif_id)
    if notif.user_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    db.session.delete(notif)
    db.session.commit()
    return jsonify({"message": "Notification supprimée"}), 200
