"""
services/taches_nocturnes.py — Les tâches de chaque nuit, en un seul appel
(lot 1.25, D13 révisée).

D13 révisée (27/10/2026) : pas de Render Cron Job, qui exige une carte
bancaire. cron-job.org appelle chaque nuit POST /api/interne/taches-nocturnes
(routes/interne.py), qui lance ici, dans l'ordre, les mêmes fonctions que les
commandes `flask` (et non un sous-processus) :
  1. reprise des suppressions de fichiers restées en échec ;
  2. purge des pièces sans décision depuis 12 mois (D5) ;
  3. validité de 3 mois des justificatifs de revenus (D12) ;
  4. expiration des annonces sans activité depuis 30 jours (D6) ;
  5. rappels des visites du jour et du lendemain.

Chaque étape tourne même si une précédente échoue : il suffit d'un fichier
que Supabase refuse durablement pour que la reprise échoue chaque nuit, et la
purge, engagement de la politique de confidentialité, ne doit pas en dépendre.

Durée : cron-job.org coupe l'appel au bout de 30 s, gunicorn au bout de 60 s.
Chaque étape dispose d'un budget de BUDGET_ETAPE_SECONDES : passé ce délai,
elle s'arrête entre deux éléments et le reste attend l'appel suivant. Toutes
les étapes sont faites pour être rejouées sans doublon, et un fichier dont la
suppression n'a pas été tentée reste dans `fichiers_a_supprimer`.
"""
import time

from flask import current_app

from app import db
from app.models import FichierASupprimer
from app.routes.listings import expirer_annonces
from app.services import donnees_personnelles as dp
from app.services import notifications as notify

# 5 étapes × 5 s = 25 s au plus, sous les 30 s de cron-job.org. Un appel
# réseau déjà lancé (suppression Supabase) va jusqu'à son terme : c'est la
# seule marge que le budget ne tient pas, d'où DELAI_RESEAU.
BUDGET_ETAPE_SECONDES = 5
# Délais (connexion, lecture) d'une suppression Supabase pendant les tâches
# nocturnes, au lieu de 30 s : au pire 3 étapes × (5 s + 8 s), sous les 60 s
# de gunicorn. Un fichier non supprimé à temps reste en file.
DELAI_RESEAU = (3, 5)


class Budget:
    """Temps alloué à une étape. Les boucles des tâches appellent `reste()`
    avant chaque élément ; `epuise` dit ensuite si l'étape s'est arrêtée
    avant la fin."""

    delai_reseau = DELAI_RESEAU

    def __init__(self, secondes):
        self.fin = time.monotonic() + secondes
        self.epuise = False

    def reste(self):
        if not self.epuise and time.monotonic() >= self.fin:
            self.epuise = True
        return not self.epuise


def _reprise(budget):
    avant = FichierASupprimer.query.count()
    _, echecs = dp.retenter_suppressions(budget=budget)
    apres = FichierASupprimer.query.count()
    compteurs = {"supprimes": avant - apres, "en_echec": echecs, "en_file": apres}
    # Comme `flask donnees retenter-suppressions`, qui sort alors en erreur.
    erreur = f"{echecs} suppression(s) encore en échec" if echecs else None
    return compteurs, erreur


def _purge(budget):
    return {"fichiers": dp.purger_pieces_sans_decision(budget=budget)}, None


def _revenus(budget):
    expires, relances = dp.appliquer_validite_revenus(budget=budget)
    return {"expires": expires, "relances": relances}, None


def _annonces(budget):
    relances, retraits = expirer_annonces(budget=budget)
    return {"relances": relances, "retraits": retraits}, None


def _visites(budget):
    return {"rappels": notify.rappeler_visites(budget=budget)}, None


ETAPES = (
    ("reprise_suppressions", _reprise),
    ("purge_pieces", _purge),
    ("expiration_revenus", _revenus),
    ("expiration_annonces", _annonces),
    ("rappels_visites", _visites),
)

# Erreurs dont le message est rédigé pour l'exploitant et ne contient aucune
# donnée. Pour toute autre exception, la réponse ne donne que son type : elle
# est conservée dans l'historique de cron-job.org, hors de notre contrôle, et
# le message d'une erreur SQL peut citer des valeurs. Le détail complet est
# dans les journaux de l'API.
ERREURS_LISIBLES = (dp.PurgeNonConfiguree,)


def executer(budget_etape=None):
    """Lance toutes les étapes ; retourne (tout_a_reussi, rapport)."""
    secondes = BUDGET_ETAPE_SECONDES if budget_etape is None else budget_etape
    debut = time.monotonic()
    etapes = []
    for nom, etape in ETAPES:
        budget = Budget(secondes)
        depart = time.monotonic()
        try:
            compteurs, erreur = etape(budget)
        except Exception as exc:  # une étape ne doit pas arrêter les suivantes
            db.session.rollback()
            current_app.logger.exception("Tâche nocturne « %s » en échec", nom)
            compteurs = {}
            erreur = (str(exc) if isinstance(exc, ERREURS_LISIBLES)
                      else f"Erreur inattendue ({type(exc).__name__}) : voir les journaux de l'API")
        else:
            if erreur:
                current_app.logger.error("Tâche nocturne « %s » : %s", nom, erreur)
        etapes.append({
            "etape": nom,
            "ok": erreur is None,
            # Faux : budget épuisé, le reste sera traité à l'appel suivant.
            "complete": not budget.epuise,
            "duree_ms": round((time.monotonic() - depart) * 1000),
            "compteurs": compteurs,
            "erreur": erreur,
        })
    ok = all(e["ok"] for e in etapes)
    return ok, {"ok": ok, "duree_ms": round((time.monotonic() - debut) * 1000),
                "etapes": etapes}
