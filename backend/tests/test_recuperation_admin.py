"""Lot 1.22 : récupération d'un compte administrateur par une commande serveur.

Les administrateurs n'ont aucune récupération en libre-service (décision du
27/10/2026) : `flask admin reinitialiser-mot-de-passe <email>`, lancée depuis
un poste qui a la base de production, lit le nouveau mot de passe au clavier.
"""
import logging

import pytest
from werkzeug.security import check_password_hash

from app.models import OTPCode, User
from tests.conftest import MOT_DE_PASSE

NOUVEAU = "nouveau-mot-de-passe-admin"
COMMANDE = ["admin", "reinitialiser-mot-de-passe"]


def _lancer(app, email, saisie):
    return app.test_cli_runner().invoke(args=[*COMMANDE, email], input=saisie)


def test_reinitialise_le_mot_de_passe_et_ferme_les_sessions(app, client, admin, entetes):
    ancien_jeton = entetes(admin)
    version = admin.token_version

    resultat = _lancer(app, admin.email, f"{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code == 0, resultat.output
    assert "réinitialisé" in resultat.output
    relu = User.query.get(admin.id)
    assert check_password_hash(relu.password_hash, NOUVEAU)
    assert relu.token_version == version + 1
    # Les jetons émis avant ne valent plus rien ; le nouveau mot de passe ouvre une session.
    assert client.get("/api/auth/me", headers=ancien_jeton).status_code == 401
    connexion = client.post("/api/auth/login", json={"email": admin.email, "password": NOUVEAU})
    assert connexion.status_code == 200
    assert client.post("/api/auth/login",
                       json={"email": admin.email, "password": MOT_DE_PASSE}).status_code == 401


def test_le_mot_de_passe_n_est_ni_affiche_ni_journalise(app, admin, caplog):
    with caplog.at_level(logging.DEBUG):
        resultat = _lancer(app, admin.email, f"{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code == 0, resultat.output
    assert NOUVEAU not in resultat.output
    assert NOUVEAU not in caplog.text
    assert admin.id in caplog.text


def test_le_mot_de_passe_ne_se_passe_pas_en_argument(app, admin):
    resultat = app.test_cli_runner().invoke(args=[*COMMANDE, admin.email, NOUVEAU])

    assert resultat.exit_code == 2  # argument en trop refusé par click
    assert check_password_hash(User.query.get(admin.id).password_hash, MOT_DE_PASSE)


def test_email_insensible_a_la_casse(app, admin):
    resultat = _lancer(app, f"  {admin.email.upper()} ", f"{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code == 0, resultat.output
    assert check_password_hash(User.query.get(admin.id).password_hash, NOUVEAU)


def test_refuse_un_compte_qui_n_est_pas_administrateur(app, fabrique):
    for compte in (fabrique.locataire(), fabrique.bailleur(), fabrique.agence()):
        resultat = _lancer(app, compte.email, f"{NOUVEAU}\n{NOUVEAU}\n")

        assert resultat.exit_code != 0
        assert "Aucun compte administrateur" in resultat.output
        assert check_password_hash(User.query.get(compte.id).password_hash, MOT_DE_PASSE)


def test_refuse_un_email_inconnu(app):
    resultat = _lancer(app, "personne@tcheyna.test", f"{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code != 0
    assert "Aucun compte administrateur" in resultat.output


def test_refuse_un_mot_de_passe_trop_court(app, admin):
    resultat = _lancer(app, admin.email, "court\n")

    assert resultat.exit_code != 0
    assert "12 à 128 caractères" in resultat.output
    assert check_password_hash(User.query.get(admin.id).password_hash, MOT_DE_PASSE)


def test_refuse_un_mot_de_passe_trop_long(app, admin):
    resultat = _lancer(app, admin.email, "x" * 129 + "\n")

    assert resultat.exit_code != 0
    assert "12 à 128 caractères" in resultat.output
    assert check_password_hash(User.query.get(admin.id).password_hash, MOT_DE_PASSE)


def test_longueur_refusee_puis_saisie_redemandee_sur_place(app, admin):
    resultat = _lancer(app, admin.email, f"court\n{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code == 0, resultat.output
    assert "12 à 128 caractères" in resultat.output
    assert check_password_hash(User.query.get(admin.id).password_hash, NOUVEAU)


def test_confirmation_differente_redemandee_puis_abandon(app, admin):
    # Deux saisies différentes : click redemande ; sans nouvelle saisie, il abandonne.
    resultat = _lancer(app, admin.email, f"{NOUVEAU}\nautre-mot-de-passe\n")

    assert resultat.exit_code != 0
    assert check_password_hash(User.query.get(admin.id).password_hash, MOT_DE_PASSE)


def test_codes_otp_en_cours_invalides(app, admin):
    from datetime import datetime, timedelta

    from app import db

    db.session.add(OTPCode(user_id=admin.id, phone="+224621000999", code_hash="0" * 64,
                           expires_at=datetime.utcnow() + timedelta(minutes=10)))
    db.session.commit()

    resultat = _lancer(app, admin.email, f"{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code == 0, resultat.output
    assert OTPCode.query.filter_by(user_id=admin.id, is_used=False).count() == 0


def test_compte_desactive_signale(app, fabrique):
    inactif = fabrique.admin(is_active=False)

    resultat = _lancer(app, inactif.email, f"{NOUVEAU}\n{NOUVEAU}\n")

    assert resultat.exit_code == 0, resultat.output
    assert "désactivé" in resultat.output


@pytest.mark.parametrize("faible", ["motdepasseadmin", "123456789012", "aaaaaa111111"])
def test_refuse_un_mot_de_passe_trop_simple(app, admin, faible):
    # Audit du 27/10 : 12 caractères ne suffisent pas, il faut mêler lettres
    # et chiffres ou symboles, avec au moins 6 caractères différents.
    resultat = _lancer(app, admin.email, f"{faible}\n")

    assert resultat.exit_code != 0
    assert "lettres et chiffres ou symboles" in resultat.output
    assert check_password_hash(User.query.get(admin.id).password_hash, MOT_DE_PASSE)
