"""Lot 2.1 — Bailleur vérifié (décision D3).

Publier une annonce exige un téléphone vérifié par OTP ; la pièce d'identité
validée par un administrateur donne le badge « Propriétaire vérifié »
(`proprietaire_verifie`) sans conditionner la publication.

Constat d'audit couvert : un compte bailleur créé à l'instant (niveau 0)
publiait une annonce appât et recevait, par les candidatures, l'identité et
le passeport public des candidats.
"""
import pytest

from app.models import Listing, User
from app.services.acces import CODE_TELEPHONE_NON_VERIFIE, MESSAGE_TELEPHONE_NON_VERIFIE
from tests.conftest import MOT_DE_PASSE

NOUVELLE_ANNONCE = {
    "title_fr": "Studio meublé à Kaloum",
    "description_fr": "Proche du port, gardien jour et nuit.",
    "pays": "Guinée", "ville": "Conakry", "quartier": "Kaloum Centre",
    "type_bien": "studio", "prix": 1_500_000,
}

ROLES_BAILLEUR = ("landlord", "agency")


def _non_verifie(fabrique, role, **champs):
    """Bailleur ou agence qui n'a pas vérifié son téléphone (niveau 0)."""
    return fabrique.utilisateur(role, **{"phone": "+224621000777", "phone_verified": False,
                                         **champs})


def _verifie(fabrique, role, **champs):
    """Bailleur ou agence au téléphone vérifié (niveau 1)."""
    return fabrique.utilisateur(role, **{"phone": "+224621000778", "phone_verified": True,
                                         "trust_level": 1, **champs})


def _publier(client, entetes, user, corps=NOUVELLE_ANNONCE):
    return client.post("/api/listings/", headers=entetes(user), json=corps)


# ─── Publication : téléphone vérifié exigé ───────────────────

@pytest.mark.parametrize("role", ROLES_BAILLEUR)
def test_publication_refusee_sans_telephone_verifie(client, fabrique, entetes, role):
    user = _non_verifie(fabrique, role)

    reponse = _publier(client, entetes, user)

    assert reponse.status_code == 403
    assert reponse.get_json() == {
        "error": MESSAGE_TELEPHONE_NON_VERIFIE,
        "details": [{"champ": "__root__", "code": "telephone_non_verifie",
                     "message": MESSAGE_TELEPHONE_NON_VERIFIE}],
    }
    assert CODE_TELEPHONE_NON_VERIFIE == "telephone_non_verifie"  # code stable, lu par le web
    assert Listing.query.count() == 0


@pytest.mark.parametrize("role", ROLES_BAILLEUR)
def test_publication_acceptee_avec_telephone_verifie(client, fabrique, entetes, role):
    user = _verifie(fabrique, role)

    reponse = _publier(client, entetes, user)

    assert reponse.status_code == 201
    annonce = Listing.query.filter_by(landlord_id=user.id).one()
    assert (annonce.status, annonce.is_visible) == ("active", True)


def test_refus_avant_la_validation_du_corps(client, fabrique, entetes):
    # Le formulaire n'a rien à corriger : c'est le compte qu'il faut vérifier.
    # Un corps vide ou invalide reçoit donc le même 403, pas un 422.
    user = _non_verifie(fabrique, "landlord")

    for corps in ({}, {"prix": "abc"}):
        reponse = _publier(client, entetes, user, corps)
        assert reponse.status_code == 403
        assert reponse.get_json()["details"][0]["code"] == "telephone_non_verifie"


def test_cni_validee_sans_telephone_ne_permet_pas_de_publier(client, fabrique, entetes):
    # D3 : le badge ne remplace pas la vérification du téléphone.
    user = _non_verifie(fabrique, "landlord", cni_uploaded=True, cni_verified=True)

    assert _publier(client, entetes, user).status_code == 403
    assert Listing.query.count() == 0


def test_verification_otp_ouvre_la_publication(client, fabrique, entetes, codes_otp):
    user = _non_verifie(fabrique, "landlord")
    en_tetes = entetes(user)
    assert _publier(client, entetes, user).status_code == 403

    assert client.post("/api/auth/send-otp", headers=en_tetes, json={}).status_code == 200
    assert client.post("/api/auth/verify-otp", headers=en_tetes,
                       json={"code": codes_otp[-1]}).status_code == 200

    assert User.query.get(user.id).phone_verified is True
    assert _publier(client, entetes, user).status_code == 201


def test_le_corps_ne_peut_pas_declarer_le_telephone_verifie(client, fabrique, entetes):
    user = _non_verifie(fabrique, "landlord")

    reponse = _publier(client, entetes, user, {**NOUVELLE_ANNONCE, "phone_verified": True})

    assert reponse.status_code == 403
    assert User.query.get(user.id).phone_verified is False
    assert Listing.query.count() == 0


def test_compte_desactive_ne_publie_pas(client, fabrique, entetes):
    user = _verifie(fabrique, "landlord", is_active=False)

    assert _publier(client, entetes, user).status_code == 403
    assert Listing.query.count() == 0


# ─── Aucun autre chemin de remise en ligne ───────────────────

@pytest.mark.parametrize("corps", [{"is_visible": True}, {"status": "active"},
                                   {"is_visible": True, "status": "active"}],
                         ids=["is_visible", "status", "les_deux"])
def test_modification_ne_remet_pas_en_ligne(client, fabrique, entetes, corps):
    # Une annonce retirée ne revient pas par PUT : `status` et `is_visible`
    # ne figurent dans aucun schéma.
    user = _non_verifie(fabrique, "landlord")
    annonce = fabrique.annonce(user, status="closed", is_visible=False)

    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(user), json=corps)

    assert reponse.status_code == 422
    relue = Listing.query.get(annonce.id)
    assert (relue.status, relue.is_visible) == ("closed", False)


def test_reactivation_du_compte_ne_republie_pas_ses_annonces(client, fabrique, admin, entetes):
    user = _non_verifie(fabrique, "landlord")
    annonce = fabrique.annonce(user)
    assert client.delete("/api/users/me", headers=entetes(user)).status_code == 200

    reponse = client.put(f"/api/admin/users/{user.id}/statut", headers=entetes(admin),
                         json={"is_active": True})

    assert reponse.status_code == 200
    relue = Listing.query.get(annonce.id)
    assert (relue.status, relue.is_visible) == ("closed", False)
    assert client.get("/api/listings/").get_json()["total"] == 0


# ─── Refus d'accès existants, inchangés ──────────────────────

def test_locataire_toujours_refuse_par_son_role(client, locataire, entetes):
    reponse = _publier(client, entetes, locataire)

    assert reponse.status_code == 403
    assert reponse.get_json()["error"] == "Action réservée aux propriétaires ou agences"


def test_annonce_d_un_autre_bailleur_toujours_refusee(client, fabrique, annonce, entetes):
    intrus = _verifie(fabrique, "landlord")

    modification = client.put(f"/api/listings/{annonce.id}", headers=entetes(intrus),
                              json={"prix": 1})
    retrait = client.delete(f"/api/listings/{annonce.id}", headers=entetes(intrus))

    assert (modification.status_code, retrait.status_code) == (403, 403)
    relue = Listing.query.get(annonce.id)
    assert (relue.prix, relue.is_visible) == (2_000_000, True)


# ─── Badge « Propriétaire vérifié » ──────────────────────────

@pytest.mark.parametrize("role", ROLES_BAILLEUR)
def test_badge_present_avec_cni_validee(client, fabrique, entetes, role):
    user = _verifie(fabrique, role, cni_uploaded=True, cni_verified=True, trust_level=2)
    annonce = fabrique.annonce(user)

    profil = client.get(f"/api/users/{user.id}").get_json()
    detail = client.get(f"/api/listings/{annonce.id}").get_json()
    recherche = client.get("/api/listings/").get_json()["listings"]

    assert profil["proprietaire_verifie"] is True
    assert detail["landlord"]["proprietaire_verifie"] is True
    assert recherche[0]["landlord"]["proprietaire_verifie"] is True
    assert client.get("/api/auth/me", headers=entetes(user)).get_json()[
        "proprietaire_verifie"] is True


def test_badge_absent_sans_cni_validee(client, fabrique, bailleur):
    # Pièce déposée mais pas encore examinée : pas de badge.
    en_attente = _verifie(fabrique, "landlord", cni_uploaded=True)
    for user in (bailleur, en_attente):
        annonce = fabrique.annonce(user)
        assert client.get(f"/api/users/{user.id}").get_json()["proprietaire_verifie"] is False
        assert client.get(f"/api/listings/{annonce.id}").get_json()[
            "landlord"]["proprietaire_verifie"] is False


def test_badge_reserve_aux_bailleurs(client, fabrique):
    # Un locataire à l'identité validée a son propre niveau (« Identifié »),
    # pas le badge des bailleurs.
    locataire = fabrique.locataire(niveau=2)

    profil = client.get(f"/api/users/{locataire.id}").get_json()

    assert profil["proprietaire_verifie"] is False


def test_badge_pose_et_retire_par_la_decision_admin(client, fabrique, admin, entetes):
    # Aucune route ne permet encore à un bailleur de déposer sa pièce (lot à
    # venir, voir la PR) : la pièce est posée directement, pour prouver que
    # le badge suit la décision de l'administrateur et elle seule.
    user = _verifie(fabrique, "landlord", cni_uploaded=True, cni_verified=False)
    fabrique.passeport(user, cni_recto_url="/uploads/cni-bailleur.png", docs_uploaded=True)
    assert client.get(f"/api/users/{user.id}").get_json()["proprietaire_verifie"] is False

    reponse = client.put(f"/api/admin/verify-cni/{user.id}", headers=entetes(admin),
                         json={"approuve": True})
    assert reponse.status_code == 200
    assert client.get(f"/api/users/{user.id}").get_json()["proprietaire_verifie"] is True

    refuse = _verifie(fabrique, "agency", phone="+224621000779", cni_uploaded=True)
    fabrique.passeport(refuse, cni_recto_url="/uploads/cni-agence.png", docs_uploaded=True)
    client.put(f"/api/admin/verify-cni/{refuse.id}", headers=entetes(admin),
               json={"approuve": False, "motif": "Photo illisible"})
    assert client.get(f"/api/users/{refuse.id}").get_json()["proprietaire_verifie"] is False


@pytest.mark.parametrize("champ", ["proprietaire_verifie", "cni_verified", "phone_verified"])
def test_badge_non_modifiable_par_le_profil(client, fabrique, entetes, champ):
    user = _verifie(fabrique, "landlord")

    reponse = client.put("/api/users/me", headers=entetes(user), json={champ: True})

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["code"] == "extra_forbidden"
    relu = User.query.get(user.id)
    assert (relu.cni_verified, relu.proprietaire_verifie) == (False, False)


def test_badge_non_declarable_a_l_inscription(client):
    reponse = client.post("/api/auth/register", json={
        "email": "escroc@exemple.test", "password": MOT_DE_PASSE, "full_name": "Faux Bailleur",
        "role": "landlord", "phone": "621000123", "proprietaire_verifie": True,
    })

    assert reponse.status_code == 422
    assert User.query.filter_by(email="escroc@exemple.test").count() == 0


def test_badge_non_declarable_dans_une_annonce(client, bailleur, entetes):
    reponse = _publier(client, entetes, bailleur,
                       {**NOUVELLE_ANNONCE, "proprietaire_verifie": True})

    assert reponse.status_code == 422
    assert Listing.query.count() == 0
    assert User.query.get(bailleur.id).proprietaire_verifie is False
