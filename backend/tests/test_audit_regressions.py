"""
tests/test_audit_regressions.py — Les 9 failles reproduites par l'audit (R1–R9).

Chaque test décrit le comportement ATTENDU, pas le comportement actuel. Ils sont
marqués `xfail(strict=True)` : tant que la faille existe, le test échoue et la
suite reste verte ; le jour où un lot la corrige, le test passe, `xfail_strict`
fait alors échouer la suite, et la PR du lot doit retirer le marqueur. Une
faille ne peut donc ni être corrigée sans que cela se voie, ni réapparaître
sans casser la CI.

`raises=AssertionError` garantit que l'échec vient bien de l'assertion qui
décrit la faille, et non d'une erreur annexe (fixture cassée, exception dans
le test lui-même), qui serait alors signalée comme un vrai échec.

Référence : audit/01-audit.md §2 · critère de sortie de la phase 1 du plan.
"""
import pytest

from app.models import Listing, TenantPassport, User


def faille(code, lot, constat):
    return pytest.mark.xfail(strict=True, raises=AssertionError,
                             reason=f"{code} — corrigé par le lot {lot} : {constat}")


# ─── R1 · Validation d'identité par défaut ───────────────────
# Corrigée au lot 1.4 (`approuve` requis, pièce exigée) : le test reste en
# garde-fou.

def test_r1_verify_cni_sans_decision_ni_piece_est_refuse(client, fabrique, admin, entetes):
    # Locataire au téléphone vérifié, qui n'a déposé aucune pièce d'identité.
    sans_piece = fabrique.locataire(niveau=1)
    assert sans_piece.cni_uploaded is False

    reponse = client.put(f"/api/admin/verify-cni/{sans_piece.id}",
                         headers=entetes(admin), json={})

    user = User.query.get(sans_piece.id)
    assert user.trust_level == 1, "niveau 2 accordé sans pièce ni décision explicite"
    assert user.cni_verified is False
    assert reponse.status_code in (400, 422)


def test_r1_bis_verify_revenus_sans_decision_ni_justificatif_est_refuse(client, fabrique, admin,
                                                                       entetes):
    # Locataire identifié (niveau 2) qui n'a déposé aucun justificatif de revenus.
    sans_justificatif = fabrique.locataire(niveau=2)
    assert sans_justificatif.passport.income_doc_url is None

    reponse = client.put(f"/api/admin/verify-revenus/{sans_justificatif.id}",
                         headers=entetes(admin), json={})

    user = User.query.get(sans_justificatif.id)
    assert user.income_verified is False, "revenus validés sans justificatif ni décision"
    assert user.passport.income_verified is False
    assert user.trust_level == 2
    assert reponse.status_code in (400, 422)


# ─── R2 · Passeport lisible par n'importe quel bailleur ──────

@faille("R2", "1.6", "GET /passport/<id> ouvert à tout bailleur, sans candidature")
def test_r2_bailleur_sans_lien_ne_lit_pas_le_passeport(client, fabrique, locataire, entetes):
    inconnu = fabrique.bailleur()
    # Aucune candidature de ce locataire sur une annonce de ce bailleur.
    fabrique.annonce(inconnu)

    reponse = client.get(f"/api/passport/{locataire.id}", headers=entetes(inconnu))

    assert reponse.status_code in (403, 404), "passeport d'un inconnu servi au bailleur"


# ─── R3 · Adresse exacte exposée aux anonymes ────────────────

@faille("R3", "1.6", "Listing.to_dict renvoie l'adresse exacte à tout le monde")
def test_r3_visiteur_anonyme_ne_voit_pas_l_adresse(client, annonce):
    assert annonce.adresse  # l'annonce a bien une adresse à protéger

    detail = client.get(f"/api/listings/{annonce.id}").get_json()
    recherche = client.get("/api/listings/").get_json()["listings"]

    assert not detail.get("adresse"), "adresse exacte servie à un visiteur anonyme"
    assert all(not a.get("adresse") for a in recherche)


# ─── R4 · Pays et devise libres ──────────────────────────────
# Corrigée au lot 1.2 (schémas de app/schemas) : le test reste en garde-fou.

def test_r4_annonce_hors_marche_ouvert_refusee(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), json={
        "title_fr": "Villa martienne", "description_fr": "Vue sur Olympus Mons.",
        "pays": "Mars", "ville": "Conakry", "type_bien": "villa",
        "prix": 5_000_000, "devise": "XOF",
    })

    assert Listing.query.count() == 0, "annonce créée sur un marché non ouvert, en XOF"
    assert reponse.status_code in (400, 422)


# ─── R5 · Mass-assignment de status / is_visible ─────────────
# Corrigée au lot 1.2 (schémas de app/schemas) : le test reste en garde-fou.

@pytest.mark.parametrize("corps", [{"status": "n_importe_quoi"}, {"is_visible": False}],
                         ids=["status", "is_visible"])
def test_r5_put_listing_n_ecrit_ni_statut_ni_visibilite(client, annonce, bailleur, entetes, corps):
    # Retirer ou rouvrir une annonce passe par des actions dédiées (cycle de
    # vie), pas par une modification libre des champs.
    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur), json=corps)

    relue = Listing.query.get(annonce.id)
    assert relue.status == "active", "statut arbitraire enregistré"
    assert relue.is_visible is True, "visibilité modifiée hors du cycle de vie"


# ─── R6 · Types non validés → 500 ────────────────────────────
# Corrigée au lot 1.2 (schémas de app/schemas) : le test reste en garde-fou.

def test_r6_prix_non_numerique_refuse_proprement(app, client, annonce, bailleur, entetes):
    # Comme en production : une exception devient un 500 JSON au lieu de
    # remonter dans le test.
    app.config["PROPAGATE_EXCEPTIONS"] = False

    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"prix": "abc"})

    assert reponse.status_code in (400, 422), f"{reponse.status_code} au lieu d'un refus"
    assert client.get(f"/api/listings/{annonce.id}").status_code == 200


def test_r6_budget_non_numerique_refuse_proprement(app, client, locataire, entetes):
    app.config["PROPAGATE_EXCEPTIONS"] = False

    reponse = client.put("/api/passport/preferences", headers=entetes(locataire),
                         json={"budget_min": "beaucoup", "budget_max": 2_000_000})

    assert reponse.status_code in (400, 422), f"{reponse.status_code} au lieu d'un refus"
    passeport = TenantPassport.query.filter_by(tenant_id=locataire.id).one()
    assert passeport.budget_min == 1_000_000


# ─── R7 · Aucune limitation de débit ─────────────────────────
# Corrigée au lot 1.4 (flask-limiter, quota de SMS en base) : les tests
# restent en garde-fou.

def test_r7_force_brute_sur_login_bloquee(client, locataire, monkeypatch):
    # La limitation se juge au nombre d'essais, pas au mot de passe : on évite
    # 30 vérifications scrypt (~3 s) qui n'apprendraient rien de plus.
    monkeypatch.setattr("app.routes.auth.check_password_hash", lambda *_: False)
    codes = [
        client.post("/api/auth/login",
                    json={"email": locataire.email, "password": f"essai-{i}"}).status_code
        for i in range(30)
    ]

    assert 429 in codes, "aucune limitation de débit sur /auth/login"


def test_r7_inscriptions_en_boucle_bloquees(client):
    codes = [
        client.post("/api/auth/register", json={
            "email": f"robot{i}@exemple.test", "password": "motdepasse-robot",
            "full_name": f"Robot {i}", "role": "tenant",
        }).status_code
        for i in range(6)
    ]

    assert codes[:5] == [201] * 5
    assert codes[5] == 429, "inscriptions illimitées depuis une même IP"
    assert User.query.count() == 5


def _vieillir_envois(phone):
    """Recule les envois de 2 min : l'anti-spam de 60 s par compte ne doit
    pas masquer le quota quotidien, qui est l'objet du test."""
    from datetime import timedelta

    from app import db
    from app.models import OTPCode

    for otp in OTPCode.query.filter_by(phone=phone).all():
        otp.created_at -= timedelta(minutes=2)
    db.session.commit()


def test_r7_send_otp_plafonne_par_numero(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    user = fabrique.locataire(niveau=0)
    en_tetes = entetes(user)

    codes = []
    for _ in range(6):
        codes.append(client.post("/api/auth/send-otp", headers=en_tetes, json={}).status_code)
        _vieillir_envois(user.phone)

    assert codes == [200] * 5 + [429], "SMS illimités vers un même numéro"
    assert len(sms) == 5


def test_r7_send_otp_plafond_partage_entre_comptes(app, client, fabrique, entetes, sms):
    # Changer de compte (ou libérer le numéro puis le reprendre) ne remet
    # pas le compteur à zéro : chaque SMS est facturé au même numéro.
    app.config["AT_API_KEY"] = "cle-at-de-test"
    numero = "+224620000123"
    premier = fabrique.locataire(niveau=0, phone=None, phone_verified=False)
    second = fabrique.locataire(niveau=0, phone=None, phone_verified=False)

    for _ in range(3):
        assert client.post("/api/auth/send-otp", headers=entetes(premier),
                           json={"phone": numero}).status_code == 200
        _vieillir_envois(numero)
    # Le premier compte passe à un autre numéro : celui-ci redevient libre.
    assert client.post("/api/auth/send-otp", headers=entetes(premier),
                       json={"phone": "+224620000999"}).status_code == 200
    _vieillir_envois("+224620000999")

    codes = []
    for _ in range(3):
        codes.append(client.post("/api/auth/send-otp", headers=entetes(second),
                                 json={"phone": numero}).status_code)
        _vieillir_envois(numero)

    assert codes == [200, 200, 429], "quota du numéro remis à zéro par un second compte"
    assert len([s for s in sms if s["destinataires"] == [numero]]) == 5


# ─── R8 · N+1 sur la recherche ───────────────────────────────

SEUIL_REQUETES_RECHERCHE = 10


@faille("R8", "3.1", "nb_candidatures, nb_avis, note_moyenne et landlord relus par annonce")
def test_r8_recherche_en_nombre_de_requetes_borne(client, fabrique, locataire, entetes,
                                                  compteur_sql):
    # 12 annonces de 12 bailleurs différents, chacun avec un avis et une
    # candidature : la configuration qui fait exploser le N+1.
    auteur = fabrique.locataire()
    for _ in range(12):
        proprietaire = fabrique.bailleur()
        annonce = fabrique.annonce(proprietaire)
        fabrique.avis(auteur, proprietaire, note=4)
        fabrique.match(fabrique.locataire(), annonce)
    en_tetes = entetes(locataire)

    with compteur_sql() as requetes:
        reponse = client.get("/api/listings/?per_page=12", headers=en_tetes)

    assert reponse.status_code == 200
    assert len(reponse.get_json()["listings"]) == 12
    assert len(requetes) <= SEUIL_REQUETES_RECHERCHE, (
        f"{len(requetes)} requêtes SQL pour une page de 12 annonces "
        f"(seuil : {SEUIL_REQUETES_RECHERCHE})"
    )


# ─── R9 · URL d'image externe acceptée ───────────────────────
# Corrigée au lot 1.2 (schémas de app/schemas) : le test reste en garde-fou.

def test_r9_image_externe_refusee(client, annonce, bailleur, entetes):
    avant = annonce.images_urls

    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
               json={"images": ["https://evil.example/track.gif"]})

    assert Listing.query.get(annonce.id).images_urls == avant, "URL externe enregistrée"
