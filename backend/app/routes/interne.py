"""
routes/interne.py — Routes appelées par nos propres automates, jamais par le site.

POST /api/interne/taches-nocturnes (lot 1.25, D13 révisée) : déclenchée
chaque nuit par cron-job.org (docs/RUNBOOK_PHASE1.md, « Tâches nocturnes »).
Les clés de la base restent sur Render ; seul sort le jeton de cette route,
qui ne permet rien d'autre que de lancer ces tâches, toutes rejouables.

  • TACHES_NOCTURNES_JETON absent : 404, la fonction est désactivée ;
  • en-tête X-Taches-Jeton faux ou absent : 401, sans dire lequel. Le jeton
    n'est lu que dans cet en-tête (une URL finit dans les journaux) et n'est
    jamais journalisé ;
  • 5 appels par heure et par IP, bon jeton ou non ;
  • aucun en-tête CORS (voir `create_app`) : aucune page web n'a à l'appeler.
"""
import hmac

from flask import Blueprint, current_app, jsonify, request

from app import limiter
from app.services import taches_nocturnes

interne_bp = Blueprint("interne", __name__)

ENTETE_JETON = "X-Taches-Jeton"
LIMITE_TACHES_NOCTURNES = "5 per hour"


def _desactivee():
    return not current_app.config.get("TACHES_NOCTURNES_JETON")


@interne_bp.route("/taches-nocturnes", methods=["POST"])
# Fonction désactivée : 404 à chaque appel, sans compter, comme une route
# qui n'existe pas.
@limiter.limit(LIMITE_TACHES_NOCTURNES, exempt_when=_desactivee)
def lancer_taches_nocturnes():
    attendu = current_app.config.get("TACHES_NOCTURNES_JETON") or ""
    if not attendu:
        return jsonify({"error": "Ressource introuvable", "details": []}), 404

    fourni = request.headers.get(ENTETE_JETON, "")
    # Comparaison en temps constant : la durée de la réponse ne dit pas
    # combien de caractères du début sont justes.
    if not hmac.compare_digest(fourni.encode(), attendu.encode()):
        return jsonify({"error": "Authentification requise", "details": []}), 401

    ok, rapport = taches_nocturnes.executer()
    # 500 si une étape a échoué : cron-job.org compte l'exécution en échec et
    # prévient par e-mail ; le détail est dans les journaux de l'API.
    return jsonify(rapport), 200 if ok else 500
