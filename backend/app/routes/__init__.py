"""Blueprints de l'API Tcheyna."""
from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.models import User


def role_required(*roles):
    """Restreint une route à certains rôles et injecte l'utilisateur courant.

    La vue reçoit l'utilisateur en premier argument nommé `current_user`, ce qui
    évite de refaire un `User.query.get` dans chaque handler.
    """
    def decorator(fn):
        @wraps(fn)
        @jwt_required()
        def wrapper(*args, **kwargs):
            user = User.query.get(get_jwt_identity())
            if not user:
                return jsonify({"error": "Utilisateur introuvable"}), 404
            if not user.is_active:
                return jsonify({"error": "Compte désactivé"}), 403
            if roles and user.role not in roles:
                libelles = {
                    "tenant":   "locataires",
                    "landlord": "propriétaires",
                    "agency":   "agences",
                    "admin":    "administrateurs",
                }
                attendus = " ou ".join(libelles.get(r, r) for r in roles)
                return jsonify({"error": f"Action réservée aux {attendus}"}), 403
            return fn(*args, current_user=user, **kwargs)
        return wrapper
    return decorator


def current_user_required(fn):
    """Authentification simple, sans contrainte de rôle."""
    return role_required()(fn)
