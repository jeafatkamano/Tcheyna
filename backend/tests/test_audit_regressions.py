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

@faille("R1", "1.4", "approuve vaut True par défaut, même sans pièce déposée")
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

@faille("R4", "1.2", "pays hors MARCHES_OUVERTS et devise libre acceptés à la création")
def test_r4_annonce_hors_marche_ouvert_refusee(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), json={
        "title_fr": "Villa martienne", "description_fr": "Vue sur Olympus Mons.",
        "pays": "Mars", "ville": "Conakry", "type_bien": "villa",
        "prix": 5_000_000, "devise": "XOF",
    })

    assert Listing.query.count() == 0, "annonce créée sur un marché non ouvert, en XOF"
    assert reponse.status_code in (400, 422)


# ─── R5 · Mass-assignment de status / is_visible ─────────────

@faille("R5", "1.2", "PUT /listings accepte status et is_visible tels quels")
def test_r5_put_listing_n_ecrit_pas_un_statut_arbitraire(client, annonce, bailleur, entetes):
    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
               json={"status": "n_importe_quoi"})

    assert Listing.query.get(annonce.id).status == "active", "statut arbitraire enregistré"


# ─── R6 · Types non validés → 500 ────────────────────────────

@faille("R6", "1.2", "prix non numérique enregistré puis 500 à chaque lecture")
def test_r6_prix_non_numerique_refuse_proprement(app, client, annonce, bailleur, entetes):
    # Comme en production : une exception devient un 500 JSON au lieu de
    # remonter dans le test.
    app.config["PROPAGATE_EXCEPTIONS"] = False

    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"prix": "abc"})

    assert reponse.status_code in (400, 422), f"{reponse.status_code} au lieu d'un refus"
    assert client.get(f"/api/listings/{annonce.id}").status_code == 200


@faille("R6", "1.2", "budget non numérique → int() lève une ValueError → 500")
def test_r6_budget_non_numerique_refuse_proprement(app, client, locataire, entetes):
    app.config["PROPAGATE_EXCEPTIONS"] = False

    reponse = client.put("/api/passport/preferences", headers=entetes(locataire),
                         json={"budget_min": "beaucoup", "budget_max": 2_000_000})

    assert reponse.status_code in (400, 422), f"{reponse.status_code} au lieu d'un refus"
    passeport = TenantPassport.query.filter_by(tenant_id=locataire.id).one()
    assert passeport.budget_min == 1_000_000


# ─── R7 · Aucune limitation de débit ─────────────────────────

@faille("R7", "1.4", "30 mauvais mots de passe d'affilée, aucun blocage")
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

@faille("R9", "1.2", "images acceptées en JSON, URL externe affichée comme photo")
def test_r9_image_externe_refusee(client, annonce, bailleur, entetes):
    avant = annonce.images_urls

    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
               json={"images": ["https://evil.example/track.gif"]})

    assert Listing.query.get(annonce.id).images_urls == avant, "URL externe enregistrée"
