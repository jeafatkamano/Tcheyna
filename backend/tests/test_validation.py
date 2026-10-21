"""
tests/test_validation.py — Validation des corps de requête (lot 1.2).

Trois familles :
  • le format commun (422 lisible, 400 JSON, champ inconnu refusé…) ;
  • les refus propres à chaque route (types, bornes, listes fermées) ;
  • le contrat avec le front : chaque corps RÉELLEMENT envoyé par
    frontend/src (relevé appel par appel) est accepté. `extra="forbid"` ne
    doit casser aucun écran.
"""
import pytest
from flask import request

from app import db
from app.models import Listing, Match, Payment, Review, TenantPassport, User
from app.schemas.listings import LOYER_MAX, PRIX_MAX
from tests.conftest import MOT_DE_PASSE

# Corps envoyé par OwnerListingForm.donnees() pour une location complète.
ANNONCE_FRONT = {
    "title_fr": "Appartement 3 pièces à Kipé",
    "description_fr": "Lumineux, eau courante, groupe électrogène.",
    "pays": "Guinée",
    "ville": "Conakry",
    "quartier": "Kipé",
    "adresse": "Rue KA-012, porte bleue",
    "type_transaction": "location",
    "type_bien": "appartement",
    "prix": 2_500_000,
    "charges": 100_000,
    "caution": 5_000_000,
    "nb_pieces": 3,
    "superficie": 85,
    "etage": 2,
    "meuble": False,
    "disponible_a_partir": "2026-11-01",
    "has_generator": True,
    "has_water": True,
    "has_wifi": False,
    "is_secured": True,
    "has_parking": False,
    "has_ac": False,
}


def erreur(reponse, statut=422):
    """Vérifie le format d'erreur commun et renvoie les champs en cause."""
    assert reponse.status_code == statut, reponse.get_json()
    corps = reponse.get_json()
    assert isinstance(corps["error"], str) and corps["error"]
    assert isinstance(corps["details"], list)
    for detail in corps["details"]:
        assert set(detail) == {"champ", "code", "message"}
    return {d["champ"]: d["code"] for d in corps["details"]}


# ─── Format commun ───────────────────────────────────────────

def test_champ_manquant_message_en_francais(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), json={})

    champs = erreur(reponse)
    assert {"title_fr", "description_fr", "pays", "ville", "type_bien", "prix"} <= set(champs)
    assert reponse.get_json()["error"].startswith("Champ requis : ")


def test_json_illisible_400_en_json(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), data="{",
                          content_type="application/json")

    assert erreur(reponse, 400) == {}


def test_mauvais_content_type_400_en_json(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), data='{"prix": 1}',
                          content_type="text/plain")

    erreur(reponse, 400)


@pytest.mark.parametrize("brut", ['"abc"', "[1]", "null", "42"])
def test_corps_qui_n_est_pas_un_objet(client, bailleur, entetes, brut):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), data=brut,
                          content_type="application/json")

    assert erreur(reponse) == {"__root__": "model_type"}


def test_champ_inconnu_refuse_et_nomme(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur),
                          json={**ANNONCE_FRONT, "prixx": 1})

    assert erreur(reponse) == {"prixx": "extra_forbidden"}
    assert Listing.query.count() == 0


def test_authentification_avant_validation(client):
    # Un anonyme apprend qu'il doit se connecter, pas la forme du schéma.
    reponse = client.post("/api/listings/", json={"n_importe": "quoi"})
    assert reponse.status_code == 401


def test_405_et_415_en_json(app, client):
    # Une route qui lirait encore le JSON à la main : Flask lève 415. (Elle
    # doit être déclarée avant la première requête.)
    app.add_url_rule("/test-415", "test_415", lambda: request.get_json(), methods=["POST"])

    assert client.patch("/api/listings/").get_json() == {"error": "Méthode non autorisée", "details": []}
    reponse = client.post("/test-415", data="x", content_type="text/plain")
    assert reponse.status_code == 415
    assert "error" in reponse.get_json()


# ─── R4 · Pays et devise ─────────────────────────────────────

@pytest.mark.parametrize("pays", ["Mars", "Sénégal"])  # inconnu ; connu mais fermé
def test_annonce_hors_marche_ouvert(client, bailleur, entetes, pays):
    reponse = client.post("/api/listings/", headers=entetes(bailleur),
                          json={**ANNONCE_FRONT, "pays": pays})

    assert erreur(reponse) == {"pays": "choix_invalide"}


def test_devise_derivee_du_pays_tolere_seulement_si_egale(client, bailleur, entetes):
    refus = client.post("/api/listings/", headers=entetes(bailleur),
                        json={**ANNONCE_FRONT, "devise": "XOF"})
    assert erreur(refus) == {"devise": "devise_incoherente"}
    assert Listing.query.count() == 0

    for corps in (ANNONCE_FRONT, {**ANNONCE_FRONT, "devise": "GNF"}):
        reponse = client.post("/api/listings/", headers=entetes(bailleur), json=corps)
        assert reponse.status_code == 201
        assert reponse.get_json()["listing"]["devise"] == "GNF"


def test_put_recalcule_la_devise(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, devise="XOF")
    url, en_tetes = f"/api/listings/{annonce.id}", entetes(bailleur)

    # Comparée à la devise du pays final (Guinée), pas à celle stockée.
    assert erreur(client.put(url, headers=en_tetes, json={"devise": "XOF"})) == {
        "devise": "devise_incoherente"}
    assert Listing.query.get(annonce.id).devise == "XOF"

    assert client.put(url, headers=en_tetes, json={"devise": "GNF"}).status_code == 200
    assert client.put(url, headers=en_tetes, json={"title_fr": "Nouveau titre"}).status_code == 200
    assert Listing.query.get(annonce.id).devise == "GNF"


def test_ville_hors_du_pays(client, bailleur, annonce, entetes):
    creation = client.post("/api/listings/", headers=entetes(bailleur),
                           json={**ANNONCE_FRONT, "ville": "Dakar"})
    assert erreur(creation) == {"ville": "lieu_invalide"}

    # En mise à jour, la ville seule est confrontée au pays déjà enregistré.
    maj = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                     json={"ville": "Atlantis"})
    assert erreur(maj) == {"ville": "lieu_invalide"}
    assert Listing.query.get(annonce.id).ville == "Conakry"


def test_abonnement_passeport_en_devise_du_serveur(client, locataire, entetes):
    refus = client.post("/api/payments/initier", headers=entetes(locataire),
                        json={"type_paiement": "abonnement_passeport", "devise": "XOF"})
    assert erreur(refus) == {"devise": "extra_forbidden"}
    assert Payment.query.count() == 0

    reponse = client.post("/api/payments/initier", headers=entetes(locataire),
                          json={"type_paiement": "abonnement_passeport", "methode": "orange_money"})
    assert reponse.status_code == 200
    assert reponse.get_json()["paiement"]["devise"] == "GNF"


# ─── R5 · Statut, visibilité, images ─────────────────────────

@pytest.mark.parametrize("corps", [{"status": "closed"}, {"is_visible": False},
                                   {"images": ["https://evil.example/track.gif"]}],
                         ids=["status", "is_visible", "images"])
def test_put_refuse_les_champs_du_cycle_de_vie(client, annonce, bailleur, entetes, corps):
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur), json=corps)

    assert erreur(reponse) == {next(iter(corps)): "extra_forbidden"}
    relue = Listing.query.get(annonce.id)
    assert (relue.status, relue.is_visible, relue.images_urls) == (
        "active", True, "/uploads/photo-1.jpg")


def test_creation_refuse_les_images_en_json(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur),
                          json={**ANNONCE_FRONT, "images": ["https://evil.example/track.gif"]})

    assert erreur(reponse) == {"images": "extra_forbidden"}
    assert Listing.query.count() == 0


def test_retrait_toujours_possible(client, annonce, bailleur, entetes):
    assert client.delete(f"/api/listings/{annonce.id}", headers=entetes(bailleur)).status_code == 200
    relue = Listing.query.get(annonce.id)
    assert (relue.status, relue.is_visible) == ("closed", False)


# ─── R6 · Types et bornes ────────────────────────────────────

@pytest.mark.parametrize("prix, code", [
    ("abc", "int_parsing"), (12.5, "int_from_float"), (True, "int_type"),
    (0, "greater_than_equal"), (-1, "greater_than_equal"), (None, "int_type"),
    (PRIX_MAX + 1, "less_than_equal"),
])
def test_prix_invalide(client, annonce, bailleur, entetes, prix, code):
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"prix": prix})

    assert erreur(reponse) == {"prix": code}
    assert Listing.query.get(annonce.id).prix == 2_000_000
    assert client.get(f"/api/listings/{annonce.id}").status_code == 200


def test_prix_numerique_en_texte_accepte(client, annonce, bailleur, entetes):
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"prix": "2800000"})

    assert reponse.status_code == 200
    assert Listing.query.get(annonce.id).prix == 2_800_000


def test_prix_de_vente_au_dela_d_un_int32(client, bailleur, entetes):
    # Une villa à 3 milliards GNF : impossible tant que `prix` était INTEGER.
    reponse = client.post("/api/listings/", headers=entetes(bailleur), json={
        **ANNONCE_FRONT, "type_transaction": "vente", "type_bien": "villa",
        "prix": 3_000_000_000, "charges": 0, "caution": None,
    })

    assert reponse.status_code == 201
    assert Listing.query.one().prix == 3_000_000_000


def test_loyer_borne_par_les_paiements(client, annonce, bailleur, entetes):
    # Borne historique (premier loyer en `payments.montant`), conservée.
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"prix": LOYER_MAX + 1})

    assert erreur(reponse) == {"prix": "montant_trop_eleve"}


def test_superficie_nan_refusee(client, annonce, bailleur, entetes):
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         data='{"superficie": NaN}', content_type="application/json")

    assert set(erreur(reponse)) == {"superficie"}


def test_booleen_en_texte_converti(client, annonce, bailleur, entetes):
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"has_wifi": "false", "has_water": "true"})

    assert reponse.status_code == 200
    relue = Listing.query.get(annonce.id)
    assert (relue.has_wifi, relue.has_water) == (False, True)


def test_dates(client, annonce, bailleur, entetes):
    url, en_tetes = f"/api/listings/{annonce.id}", entetes(bailleur)

    assert erreur(client.put(url, headers=en_tetes,
                             json={"disponible_a_partir": "31/12/2026"})) == {
        "disponible_a_partir": "date_from_datetime_parsing"}
    assert erreur(client.put(url, headers=en_tetes, json={"disponible_a_partir": 123})) == {
        "disponible_a_partir": "date_type"}
    assert client.put(url, headers=en_tetes, json={"disponible_a_partir": ""}).status_code == 200
    assert Listing.query.get(annonce.id).disponible_a_partir is None


def test_null_absent_et_effacement(client, annonce, bailleur, entetes):
    url, en_tetes = f"/api/listings/{annonce.id}", entetes(bailleur)

    # NOT NULL : `null` refusé au lieu d'un IntegrityError (500).
    assert erreur(client.put(url, headers=en_tetes, json={"title_fr": None})) == {
        "title_fr": "string_type"}
    # Facultatif : `null` efface ; un champ absent reste inchangé.
    reponse = client.put(url, headers=en_tetes, json={"adresse": None, "quartier": None})
    assert reponse.status_code == 200
    relue = Listing.query.get(annonce.id)
    assert (relue.adresse, relue.quartier, relue.prix) == (None, None, 2_000_000)


def test_espaces_de_bord_retires_et_texte_vide_refuse(client, annonce, bailleur, entetes):
    url, en_tetes = f"/api/listings/{annonce.id}", entetes(bailleur)

    assert client.put(url, headers=en_tetes, json={"quartier": "  Nongo  "}).status_code == 200
    assert Listing.query.get(annonce.id).quartier == "Nongo"
    assert erreur(client.put(url, headers=en_tetes, json={"title_fr": "   "})) == {
        "title_fr": "string_too_short"}


@pytest.mark.parametrize("champ, longueur", [("title_fr", 200), ("adresse", 300),
                                             ("quartier", 100), ("description_fr", 5000)])
def test_longueurs_des_colonnes(client, annonce, bailleur, entetes, champ, longueur):
    url, en_tetes = f"/api/listings/{annonce.id}", entetes(bailleur)

    assert erreur(client.put(url, headers=en_tetes, json={champ: "x" * (longueur + 1)})) == {
        champ: "string_too_long"}
    # La borne compte des caractères, comme VARCHAR(n) : 200 « é » passent.
    assert client.put(url, headers=en_tetes, json={champ: "é" * longueur}).status_code == 200


@pytest.mark.parametrize("route, champ", [
    ("/api/users/me", "full_name"),
    ("/api/messages", "contenu"),
    ("/api/listings", "title_fr"),
])
def test_caractere_nul_refuse(client, match, locataire, bailleur, entetes, route, champ):
    if route == "/api/messages":
        reponse = client.post(f"/api/messages/conversations/{match.conversation.id}",
                              headers=entetes(locataire), json={champ: "a\x00b"})
    elif route == "/api/listings":
        reponse = client.put(f"/api/listings/{match.listing_id}", headers=entetes(bailleur),
                             json={champ: "a\x00b"})
    else:
        reponse = client.put(route, headers=entetes(locataire), json={champ: "a\x00b"})

    assert erreur(reponse) == {champ: "caractere_interdit"}


def test_preferences(client, locataire, entetes):
    url, en_tetes = "/api/passport/preferences", entetes(locataire)

    assert erreur(client.put(url, headers=en_tetes, json={"budget_min": "abc"})) == {
        "budget_min": "int_parsing"}
    # Le minimum seul est confronté au maximum déjà enregistré (3 000 000).
    assert erreur(client.put(url, headers=en_tetes, json={"budget_min": 5_000_000})) == {
        "budget_min": "budget_incoherent"}
    assert set(erreur(client.put(url, headers=en_tetes,
                                 json={"quartiers_souhaites": [1, {}]}))) == {
        "quartiers_souhaites.0", "quartiers_souhaites.1"}
    assert erreur(client.put(url, headers=en_tetes,
                             json={"quartiers_souhaites": ["Kipé"] * 41})) == {
        "quartiers_souhaites": "too_long"}
    assert erreur(client.put(url, headers=en_tetes, json={"type_bien_souhaite": "chateau"})) == {
        "type_bien_souhaite": "choix_invalide"}

    # Compatibilité : une chaîne « a,b » reste acceptée.
    assert client.put(url, headers=en_tetes,
                      json={"quartiers_souhaites": "Kipé, Nongo,"}).status_code == 200
    passeport = TenantPassport.query.filter_by(tenant_id=locataire.id).one()
    assert passeport.quartiers_souhaites == "Kipé,Nongo"
    assert passeport.budget_min == 1_000_000


def test_passeport_situation_et_longueurs(client, locataire, entetes):
    url, en_tetes = "/api/passport/", entetes(locataire)

    assert erreur(client.post(url, headers=en_tetes, json={"situation_pro": "pdg"})) == {
        "situation_pro": "choix_invalide"}
    assert erreur(client.post(url, headers=en_tetes, json={"employeur": "x" * 101})) == {
        "employeur": "string_too_long"}
    assert erreur(client.post(url, headers=en_tetes, json={"devise": "XOF"})) == {
        "devise": "choix_invalide"}


def test_ordre_des_photos(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, images_urls="/uploads/a.jpg,/uploads/b.jpg")
    url, en_tetes = f"/api/listings/{annonce.id}/photos/ordre", entetes(bailleur)

    # Liste mixte : `sorted` levait un TypeError (500).
    assert erreur(client.put(url, headers=en_tetes, json={"images": [1, "a"]})) == {
        "images.0": "string_type"}
    assert client.put(url, headers=en_tetes,
                      json={"images": ["/uploads/a.jpg", "https://evil.example/x.gif"]}
                      ).status_code == 400
    assert client.put(url, headers=en_tetes,
                      json={"images": ["/uploads/b.jpg", "/uploads/a.jpg"]}).status_code == 200
    assert Listing.query.get(annonce.id).images_urls == "/uploads/b.jpg,/uploads/a.jpg"


@pytest.mark.parametrize("note", ["cinq", 0, 6, 4.5])
def test_note_d_avis_invalide(client, fabrique, locataire, annonce, entetes, note):
    conclu = fabrique.match(locataire, annonce, status="completed")
    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": note})

    assert set(erreur(reponse)) == {"note"}
    assert Review.query.count() == 0


def test_candidatures_et_visites(client, fabrique, match, locataire, bailleur, entetes):
    assert erreur(client.put(f"/api/matches/{match.id}/statut", headers=entetes(bailleur),
                             json={"statut": "completed"})) == {"statut": "choix_invalide"}
    assert erreur(client.put(f"/api/matches/{match.id}/visite", headers=entetes(locataire),
                             json={"visite_date": 123})) == {"visite_date": "datetime_type"}
    assert client.put(f"/api/matches/{match.id}/visite", headers=entetes(locataire),
                      json={"visite_date": "2026-09-15T14:30:00Z"}).status_code == 200
    # `Query.get(dict)` levait une exception (500).
    autre = fabrique.locataire()
    assert erreur(client.post("/api/matches/", headers=entetes(autre),
                              json={"listing_id": {"a": 1}})) == {"listing_id": "string_type"}


def test_auth(client, locataire, entetes):
    assert erreur(client.post("/api/auth/login", json={"email": 123, "password": "x"})) == {
        "email": "string_type"}
    assert erreur(client.post("/api/auth/verify-otp", headers=entetes(locataire),
                              json={"code": "12a456"})) == {"code": "code_invalide"}
    assert erreur(client.post("/api/auth/verify-otp", headers=entetes(locataire),
                              json={"code": 123456})) == {"code": "string_type"}


def test_inscription_bornes(client):
    base = {"email": "nouveau@exemple.test", "password": MOT_DE_PASSE, "role": "tenant"}

    assert erreur(client.post("/api/auth/register", json={**base, "full_name": "x" * 101})) == {
        "full_name": "string_too_long"}
    assert erreur(client.post("/api/auth/register",
                              json={**base, "full_name": "A", "email": "a" * 110 + "@exemple.test"}
                              )) == {"email": "string_too_long"}
    assert erreur(client.post("/api/auth/register",
                              json={**base, "full_name": "A", "preferred_lang": "francais"})) == {
        "preferred_lang": "choix_invalide"}
    assert User.query.count() == 0

    # 100 caractères, même hors ASCII : accepté.
    reponse = client.post("/api/auth/register", json={**base, "full_name": "é" * 100})
    assert reponse.status_code == 201


def test_profil(client, locataire, entetes):
    url, en_tetes = "/api/users/me", entetes(locataire)

    assert erreur(client.put(url, headers=en_tetes, json={"full_name": "   "})) == {
        "full_name": "string_too_short"}
    assert erreur(client.put(url, headers=en_tetes, json={"full_name": None})) == {
        "full_name": "string_type"}
    assert erreur(client.put(url, headers=en_tetes, json={"preferred_lang": "francais"})) == {
        "preferred_lang": "choix_invalide"}


def test_admin_booleens_stricts(client, fabrique, admin, entetes):
    cible = fabrique.locataire(niveau=1, cni_uploaded=True)
    reponse = client.put(f"/api/admin/verify-cni/{cible.id}", headers=entetes(admin),
                         json={"approuve": "oui"})
    assert erreur(reponse) == {"approuve": "bool_parsing"}
    assert User.query.get(cible.id).trust_level == 1

    # `bool("false")` valait True : le compte restait actif.
    assert client.put(f"/api/admin/users/{cible.id}/statut", headers=entetes(admin),
                      json={"is_active": "false"}).status_code == 200
    assert User.query.get(cible.id).is_active is False


# ─── Certification : seule une vraie modification l'annule ──

def test_sauvegarde_sans_changement_garde_la_certification(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, certification_status="certified", superficie=85.0)
    # Le formulaire renvoie toujours le lieu et la nature du bien.
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur), json={
        "title_fr": "Titre retouché", "ville": "Conakry", "quartier": "Kipé",
        "adresse": annonce.adresse, "type_bien": "appartement",
        "type_transaction": "location", "superficie": 85,
    })

    assert reponse.status_code == 200
    assert Listing.query.get(annonce.id).certification_status == "certified"


def test_changement_de_quartier_annule_la_certification(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, certification_status="certified")
    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
               json={"ville": "Conakry", "quartier": "Nongo"})

    relue = Listing.query.get(annonce.id)
    assert relue.certification_status == "none"
    assert relue.certification_note


# ─── Webhook CinetPay ────────────────────────────────────────

def test_callback_en_formulaire_avec_champs_supplementaires(client, fabrique, locataire):
    paiement = fabrique.paiement(locataire)
    reponse = client.post("/api/payments/callback", data={
        "cpm_trans_id": paiement.cinetpay_transaction_id,
        "cpm_site_id": "000000", "signature": "abc",
    })

    assert reponse.status_code == 200
    # Sans clé CinetPay, l'issue est inconnue : jamais de succès sur la foi du
    # corps, ni d'échec tant que CinetPay n'a pas refusé explicitement.
    assert Payment.query.get(paiement.id).statut == "pending"


def test_callback_sans_identifiant_ou_trop_long(client):
    assert erreur(client.post("/api/payments/callback", data={"cpm_site_id": "1"})) == {
        "cpm_trans_id": "missing"}
    assert erreur(client.post("/api/payments/callback", json={"cpm_trans_id": "x" * 101})) == {
        "cpm_trans_id": "string_too_long"}


# ─── Contrat avec le front ───────────────────────────────────
# Corps copiés des appels de frontend/src (api/index.ts et formulaires) :
# aucun ne doit être refusé.

def test_front_inscription_et_compte(client, fabrique, entetes, codes_otp):
    # RegisterPage.soumettre : `...form`, `role`, phone et quartier facultatifs.
    reponse = client.post("/api/auth/register", json={
        "full_name": "Mariama Diallo", "email": "mariama@exemple.test", "phone": "622 52 92 52",
        "password": MOT_DE_PASSE, "pays": "Guinée", "ville": "Conakry", "quartier": "Kipé",
        "role": "tenant",
    })
    assert reponse.status_code == 201, reponse.get_json()
    assert client.post("/api/auth/register", json={
        "full_name": "Bailleur", "email": "b@exemple.test", "password": MOT_DE_PASSE,
        "pays": "Guinée", "ville": "Kindia", "role": "landlord",
    }).status_code == 201

    assert client.post("/api/auth/login", json={"email": "mariama@exemple.test",
                                                "password": MOT_DE_PASSE}).status_code == 200

    user = User.query.filter_by(email="mariama@exemple.test").one()
    changement = client.put("/api/auth/password", headers=entetes(user), json={
        "ancien_mot_de_passe": MOT_DE_PASSE, "nouveau_mot_de_passe": "nouveau-mdp-123",
    })
    assert changement.status_code == 200
    # ChangementMotDePasse stocke les nouveaux jetons : les anciens sont révoqués.
    en_tetes = {"Authorization": f"Bearer {changement.get_json()['access_token']}"}
    # PhoneVerification : `{}` ou `{phone}`, puis `{code}` (chaîne).
    assert client.post("/api/auth/send-otp", headers=en_tetes, json={}).status_code == 200
    code = codes_otp[-1]
    assert client.post("/api/auth/verify-otp", headers=en_tetes,
                       json={"code": code}).status_code == 200
    autre = fabrique.locataire(niveau=0, phone=None, phone_verified=False)
    assert client.post("/api/auth/send-otp", headers=entetes(autre),
                       json={"phone": "+224 620 00 00 01"}).status_code == 200

    # OwnerProfile.enregistrer
    assert client.put("/api/users/me", headers=en_tetes, json={
        "full_name": "Mariama Diallo", "bio": "Enseignante.", "ville": "Conakry",
        "quartier": "Kipé",
    }).status_code == 200


def test_front_annonce(client, fabrique, bailleur, entetes, supabase):
    en_tetes = entetes(bailleur)

    creation = client.post("/api/listings/", headers=en_tetes, json=ANNONCE_FRONT)
    assert creation.status_code == 201, creation.get_json()
    annonce_id = creation.get_json()["listing"]["id"]

    # Vente d'un terrain : pièces, étage et caution non envoyés.
    vente = {**ANNONCE_FRONT, "type_transaction": "vente", "type_bien": "terrain",
             "prix": 1_250_000_000, "charges": 0, "meuble": False}
    for champ in ("caution", "nb_pieces", "etage", "disponible_a_partir"):
        vente.pop(champ)
    assert client.post("/api/listings/", headers=en_tetes, json=vente).status_code == 201

    # Ancien bundle en cache (avant le lot 1.2) : même corps, avec `devise`.
    ancien = client.post("/api/listings/", headers=en_tetes,
                         json={**ANNONCE_FRONT, "devise": "GNF"})
    assert ancien.status_code == 201, ancien.get_json()
    assert client.put(f"/api/listings/{annonce_id}", headers=en_tetes,
                      json={**ANNONCE_FRONT, "devise": "GNF"}).status_code == 200

    # La modification renvoie le même corps complet.
    assert client.put(f"/api/listings/{annonce_id}", headers=en_tetes,
                      json={**ANNONCE_FRONT, "prix": 2_600_000}).status_code == 200

    # Photos et documents : `{url}` et `{images}`.
    annonce = fabrique.annonce(bailleur, images_urls="/uploads/a.jpg,/uploads/b.jpg",
                               documents_urls="/uploads/titre.pdf")
    assert client.put(f"/api/listings/{annonce.id}/photos/ordre", headers=en_tetes,
                      json={"images": ["/uploads/b.jpg", "/uploads/a.jpg"]}).status_code == 200
    assert client.delete(f"/api/listings/{annonce.id}/photos", headers=en_tetes,
                         json={"url": "/uploads/a.jpg"}).status_code == 200
    assert client.delete(f"/api/listings/{annonce.id}/documents", headers=en_tetes,
                         json={"url": "/uploads/titre.pdf"}).status_code == 200


def test_front_passeport(client, locataire, entetes):
    en_tetes = entetes(locataire)

    # TenantProfile / OnboardingTenant : situation professionnelle.
    assert client.post("/api/passport/", headers=en_tetes, json={
        "situation_pro": "salarié", "employeur": "Orange Guinée", "revenu_mensuel": 6_000_000,
        "devise": "GNF", "a_un_garant": True, "garant_nom": "Alpha Barry",
        "garant_revenu": 9_000_000,
    }).status_code == 200
    assert client.post("/api/passport/", headers=en_tetes, json={
        "situation_pro": "étudiant", "devise": "GNF", "a_un_garant": False,
    }).status_code == 200

    # TenantProfile : critères complets ; OnboardingTenant : sans date.
    assert client.put("/api/passport/preferences", headers=en_tetes, json={
        "budget_min": 1_000_000, "budget_max": 3_000_000, "ville_souhaitee": "Conakry",
        "quartiers_souhaites": ["Kipé", "Nongo"], "type_bien_souhaite": "appartement",
        "nb_pieces_min": 2, "nb_occupants": 3, "date_emmenagement": "2026-12-01",
    }).status_code == 200
    assert client.put("/api/passport/preferences", headers=en_tetes, json={
        "budget_max": 2_000_000, "ville_souhaitee": "Conakry", "quartiers_souhaites": [],
        "type_bien_souhaite": "studio",
    }).status_code == 200


def test_front_mise_en_relation(client, fabrique, locataire, bailleur, annonce, admin, entetes,
                                cinetpay):
    # ListingDetail : candidature (message éventuellement vide).
    reponse = client.post("/api/matches/", headers=entetes(locataire),
                          json={"listing_id": annonce.id, "message": "Bonjour, disponible ?"})
    assert reponse.status_code == 201
    match_id = reponse.get_json()["match"]["id"]
    autre = fabrique.annonce(bailleur)
    assert client.post("/api/matches/", headers=entetes(locataire),
                       json={"listing_id": autre.id, "message": ""}).status_code == 201

    # OwnerMatches : décision, frais de mise en relation (D1, location), puis
    # visite (champ datetime-local, sans fuseau).
    assert client.put(f"/api/matches/{match_id}/statut", headers=entetes(bailleur),
                      json={"statut": "accepted"}).status_code == 402
    frais = client.post("/api/payments/initier", headers=entetes(bailleur), json={
        "type_paiement": "frais_mise_en_relation", "match_id": match_id, "methode": "mtn_momo",
    })
    assert frais.status_code == 200
    assert client.post("/api/payments/callback", json={
        "cpm_trans_id": frais.get_json()["transaction_id"]}).status_code == 200
    assert client.put(f"/api/matches/{match_id}/visite", headers=entetes(bailleur),
                      json={"visite_date": "2026-11-15T14:30"}).status_code == 200

    # ConversationPage
    conversation = Match.query.get(match_id).conversation
    assert client.post(f"/api/messages/conversations/{conversation.id}",
                       headers=entetes(locataire), json={"contenu": "Merci !"}).status_code == 201

    # TenantMatches : avis après une location conclue.
    conclu = fabrique.match(fabrique.locataire(), fabrique.annonce(bailleur), status="completed")
    assert client.post("/api/reviews/", headers=entetes(conclu.tenant), json={
        "match_id": conclu.id, "note": 5, "commentaire": "Propriétaire réactif.",
    }).status_code == 201

    # ModalePaiement : listing_id ou match_id, et une méthode.
    assert client.post("/api/payments/initier", headers=entetes(bailleur), json={
        "type_paiement": "certification", "listing_id": annonce.id, "methode": "orange_money",
    }).status_code == 200
    # La commission de 6 % n'est plus initiable (D1).
    assert client.post("/api/payments/initier", headers=entetes(bailleur), json={
        "type_paiement": "commission", "match_id": match_id, "methode": "mtn_momo",
    }).status_code == 422


def test_front_administration(client, fabrique, admin, entetes):
    en_tetes = entetes(admin)
    # Pièces déposées : sans elles, la décision est refusée (R1, lot 1.4).
    cible = fabrique.locataire(niveau=1, cni_uploaded=True, passeport=False)
    fabrique.passeport(cible, cni_recto_url="/uploads/cni.png", docs_uploaded=True,
                       income_doc_url="/uploads/revenus.pdf")
    annonce = fabrique.annonce(certification_status="pending")

    # adminAPI : `{approuve, motif}` (motif absent quand on approuve).
    assert client.put(f"/api/admin/verify-cni/{cible.id}", headers=en_tetes,
                      json={"approuve": True}).status_code == 200
    assert client.put(f"/api/admin/verify-revenus/{cible.id}", headers=en_tetes,
                      json={"approuve": False, "motif": "Illisible"}).status_code == 200
    assert client.put(f"/api/admin/certifier/{annonce.id}", headers=en_tetes,
                      json={"approuve": False, "motif": "Titre foncier illisible"}
                      ).status_code == 200
    assert client.put(f"/api/admin/users/{cible.id}/statut", headers=en_tetes,
                      json={"is_active": False}).status_code == 200


# ─── Corrections de relecture ────────────────────────────────

def test_annonce_ancienne_modifiable_avec_le_corps_complet(client, fabrique, bailleur, entetes):
    # Créées avant les contrôles : ville hors référentiel, loyer > LOYER_MAX.
    # Le front renvoie ces valeurs inchangées : la sauvegarde doit passer.
    annonce = fabrique.annonce(bailleur, ville="Ratoma", prix=LOYER_MAX + 1)
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur), json={
        **ANNONCE_FRONT, "ville": "Ratoma", "prix": LOYER_MAX + 1, "title_fr": "Retouché",
    })

    assert reponse.status_code == 200, reponse.get_json()
    assert Listing.query.get(annonce.id).title_fr == "Retouché"
    # Changer réellement la ville la confronte au référentiel.
    assert erreur(client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                             json={"ville": "Atlantis"})) == {"ville": "lieu_invalide"}


def test_adresse_avec_espaces_en_base_ne_decertifie_pas(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, certification_status="certified",
                               adresse="  Rue KA-012  ")
    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
               json={"adresse": "  Rue KA-012  ", "quartier": "Kipé"})

    assert Listing.query.get(annonce.id).certification_status == "certified"


def test_passeport_garant_null_renvoye_par_le_front(client, fabrique, entetes):
    locataire = fabrique.locataire()
    # Passeport antérieur au lot : `a_un_garant` à NULL.
    TenantPassport.query.filter_by(tenant_id=locataire.id).update({"a_un_garant": None})
    db.session.commit()
    reponse = client.post("/api/passport/", headers=entetes(locataire),
                          json={"situation_pro": "salarié", "devise": "GNF", "a_un_garant": None})

    assert reponse.status_code == 200
    assert TenantPassport.query.filter_by(tenant_id=locataire.id).one().a_un_garant is False


def test_erreur_pydantic_interne_reste_un_500(app, client):
    # Seul un refus de validation du corps devient 422 ; une ValidationError
    # levée ailleurs est un bug à voir, pas une faute du client.
    from app.schemas.listings import CreationAnnonce

    app.config["PROPAGATE_EXCEPTIONS"] = False
    app.add_url_rule("/test-500", "test_500", lambda: CreationAnnonce.model_validate({}))

    assert client.get("/test-500").status_code == 500


def test_creation_et_maj_d_annonce_ont_les_memes_champs():
    from app.schemas.listings import CreationAnnonce, MajAnnonce

    # Différences voulues entre les deux schémas : aucune à ce jour. Un champ
    # ajouté à l'un sans l'autre serait soit inmodifiable, soit refusé à la
    # création.
    differences_voulues = set()
    assert set(CreationAnnonce.model_fields) ^ set(MajAnnonce.model_fields) == differences_voulues


def test_corps_absent_sans_content_type(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur))

    assert "prix" in erreur(reponse)


def test_webhook_json_avec_champs_en_trop(client, fabrique, locataire):
    paiement = fabrique.paiement(locataire)
    reponse = client.post("/api/payments/callback", json={
        "cpm_trans_id": paiement.cinetpay_transaction_id, "cpm_site_id": "000000",
        "cpm_amount": "250000", "signature": "abc",
    })

    assert reponse.status_code == 200
    assert Payment.query.get(paiement.id).statut == "pending"


def test_mot_de_passe_trop_long_a_l_inscription(client):
    reponse = client.post("/api/auth/register", json={
        "email": "long@exemple.test", "password": "x" * 129, "full_name": "A", "role": "tenant",
    })

    assert erreur(reponse) == {"password": "string_too_long"}
    assert User.query.count() == 0
