"""
Contrat d'API (lot 3.10) : backend/openapi.json est généré depuis le code et
doit rester à jour ; chaque objet renvoyé par l'API a son modèle de contrat.

La validation des `to_dict()` eux-mêmes est faite pendant toute la suite par
la fixture `contrat_des_reponses` (conftest.py).
"""
import json

from app import models
from app.openapi import FICHIER_SPEC, construire_spec, spec_en_texte
from app.schemas import reponses

# Classes qui ont un `to_dict()` jamais renvoyé par une route : hors contrat.
HORS_API = {models.Verification}


def test_le_fichier_versionne_est_a_jour(app):
    assert FICHIER_SPEC.read_text(encoding="utf-8") == spec_en_texte(app), (
        "backend/openapi.json n'est pas à jour : lancer `flask api spec` dans backend/, "
        "puis `npm run api:types` dans frontend/."
    )


def test_chaque_objet_serialise_a_son_modele_de_contrat():
    avec_to_dict = {
        classe for classe in vars(models).values()
        if isinstance(classe, type) and issubclass(classe, models.db.Model)
        and "to_dict" in vars(classe)
    }
    couvertes = {models.User, models.TenantPassport, *reponses.MODELES_PAR_CLASSE}
    assert avec_to_dict - HORS_API == couvertes


def test_corps_et_authentification_viennent_des_decorateurs(app):
    chemins = construire_spec(app)["paths"]

    connexion = chemins["/api/auth/login"]["post"]
    assert "security" not in connexion
    assert connexion["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/Connexion"
    }
    assert "422" in connexion["responses"]

    modification = chemins["/api/listings/{listing_id}"]["put"]
    assert modification["security"] == [{"jwt": []}]
    assert modification["x-roles"] == ["landlord", "agency"]
    assert modification["parameters"][0]["name"] == "listing_id"

    # Route authentifiée sans restriction de rôle : pas de `x-roles`.
    moi = chemins["/api/auth/me"]["get"]
    assert moi["security"] == [{"jwt": []}] and "x-roles" not in moi

    # Le rafraîchissement exige le jeton de rafraîchissement, pas celui d'accès.
    rafraichir = chemins["/api/auth/refresh"]["post"]
    assert rafraichir["security"] == [{"jwtRefresh": []}] and "401" in rafraichir["responses"]

    # La déconnexion accepte l'un ou l'autre jeton (lot 1.12).
    deconnexion = chemins["/api/auth/logout"]["post"]
    assert deconnexion["security"] == [{"jwt": []}, {"jwtRefresh": []}]

    # Le webhook CinetPay accepte aussi un formulaire.
    callback = chemins["/api/payments/callback"]["post"]["requestBody"]["content"]
    assert set(callback) == {"application/json", "application/x-www-form-urlencoded"}


def test_identifiants_uniques_et_references_resolues(app):
    spec = construire_spec(app)
    ids = [op["operationId"] for ops in spec["paths"].values() for op in ops.values()]
    assert len(ids) == len(set(ids))

    texte = json.dumps(spec)
    for section in ("schemas", "responses"):
        prefixe = f'"#/components/{section}/'
        for morceau in texte.split(prefixe)[1:]:
            nom = morceau.split('"', 1)[0]
            assert nom in spec["components"][section], f"référence cassée : {section}/{nom}"


def test_les_fichiers_de_developpement_ne_sont_pas_publies(app):
    assert not any(chemin.startswith("/uploads") for chemin in construire_spec(app)["paths"])


def test_les_routes_internes_ne_sont_pas_publiees(app):
    @app.route("/api/interne/essai", methods=["POST"])
    def route_interne_d_essai():
        return "", 204

    assert not any(chemin.startswith("/api/interne/") for chemin in construire_spec(app)["paths"])


def test_erreurs_propres_a_certaines_routes_decrites(app):
    erreur = construire_spec(app)["components"]["schemas"]["Erreur"]["properties"]
    for champ in ("reessayer_dans", "action_requise", "paiement", "code", "plafond"):
        assert champ in erreur
