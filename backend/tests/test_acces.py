"""
tests/test_acces.py — Matrice d'accès rôle × ressource (lot 1.6).

Chaque test parcourt les lecteurs possibles d'une ressource sensible :
anonyme, locataire tiers, locataire candidat (par statut), bailleur sans
lien, bailleur ayant reçu une candidature (par statut), propriétaire, admin.
Les règles testées vivent dans app/services/acces.py.
"""
import pytest

from app import create_app, db
from app.models import Conversation, Listing
from app.services.acces import (
    STATUTS_OUVRANT_ADRESSE,
    STATUTS_OUVRANT_PASSEPORT,
    nom_reduit,
)

STATUTS = ("pending", "accepted", "rejected", "completed", "cancelled")


# ─── Passeport ───────────────────────────────────────────────

LECTEURS_PASSEPORT = (
    ["anonyme", "locataire_tiers", "lui_meme", "bailleur_sans_lien",
     "bailleur_candidature_ailleurs", "admin"]
    + [f"bailleur_candidature_{s}" for s in STATUTS]
)


def _niveau_attendu(lecteur):
    if lecteur in ("lui_meme", "admin"):
        return "complet"
    if lecteur.startswith("bailleur_candidature_"):
        statut = lecteur.removeprefix("bailleur_candidature_")
        if statut in STATUTS_OUVRANT_PASSEPORT:
            return "public"
    return None


@pytest.fixture
def lecteur_passeport(fabrique, locataire):
    """`lecteur_passeport(nom)` → l'utilisateur qui lit le passeport de
    `locataire` (None pour l'anonyme), avec le lien éventuel en base."""
    def fabriquer(nom):
        if nom == "anonyme":
            return None
        if nom == "locataire_tiers":
            return fabrique.locataire()
        if nom == "lui_meme":
            return locataire
        if nom == "admin":
            return fabrique.admin()
        bailleur = fabrique.bailleur()
        if nom == "bailleur_sans_lien":
            fabrique.annonce(bailleur)
        elif nom == "bailleur_candidature_ailleurs":
            # Le locataire a candidaté, mais chez un autre bailleur.
            fabrique.annonce(bailleur)
            fabrique.match(locataire, fabrique.annonce(), status="pending")
        else:
            statut = nom.removeprefix("bailleur_candidature_")
            fabrique.match(locataire, fabrique.annonce(bailleur), status=statut)
        return bailleur
    return fabriquer


@pytest.mark.parametrize("lecteur", LECTEURS_PASSEPORT)
def test_passeport_par_id(client, locataire, lecteur_passeport, entetes, lecteur):
    user = lecteur_passeport(lecteur)
    reponse = client.get(f"/api/passport/{locataire.id}",
                         headers=entetes(user) if user else {})

    attendu = _niveau_attendu(lecteur)
    if user is None:
        assert reponse.status_code == 401
    elif attendu is None:
        assert reponse.status_code == 404
    else:
        assert reponse.status_code == 200
        corps = reponse.get_json()
        assert corps["budget_max"] == 3_000_000
        assert ("revenu_mensuel" in corps) is (attendu == "complet")


@pytest.mark.parametrize("lecteur", LECTEURS_PASSEPORT)
def test_passeport_dans_le_profil(client, locataire, lecteur_passeport, entetes, lecteur):
    user = lecteur_passeport(lecteur)
    reponse = client.get(f"/api/users/{locataire.id}", headers=entetes(user) if user else {})

    assert reponse.status_code == 200
    corps = reponse.get_json()
    attendu = _niveau_attendu(lecteur)
    if attendu is None:
        assert "passeport" not in corps
    else:
        assert corps["passeport"]["budget_max"] == 3_000_000
        assert ("revenu_mensuel" in corps["passeport"]) is (attendu == "complet")
    assert "email" not in corps and "phone" not in corps


def test_profil_avec_jeton_invalide_traite_comme_anonyme(client, locataire, fabrique):
    bailleur = fabrique.bailleur()
    fabrique.match(locataire, fabrique.annonce(bailleur), status="pending")

    reponse = client.get(f"/api/users/{locataire.id}",
                         headers={"Authorization": "Bearer jeton-invalide"})

    assert reponse.status_code == 200
    assert "passeport" not in reponse.get_json()


def test_profil_lu_par_un_compte_desactive_sans_passeport(client, locataire, fabrique, entetes):
    bailleur = fabrique.bailleur()
    fabrique.match(locataire, fabrique.annonce(bailleur), status="pending")
    en_tetes = entetes(bailleur)
    bailleur.is_active = False
    db.session.commit()

    corps = client.get(f"/api/users/{locataire.id}", headers=en_tetes).get_json()
    assert "passeport" not in corps


@pytest.mark.parametrize("statut", STATUTS)
def test_passeport_dans_mes_demandes(client, fabrique, bailleur, annonce, entetes, statut):
    candidat = fabrique.locataire()
    fabrique.match(candidat, annonce, status=statut)

    demandes = client.get("/api/matches/mes-demandes", headers=entetes(bailleur)).get_json()

    (demande,) = demandes["matches"]
    if statut in STATUTS_OUVRANT_PASSEPORT:
        assert demande["passeport"]["situation_pro"] == "salarié"
        assert "revenu_mensuel" not in demande["passeport"]
    else:
        assert demande["passeport"] is None


@pytest.mark.parametrize("statut", STATUTS)
def test_passeport_dans_le_detail_de_candidature(client, fabrique, bailleur, annonce, entetes,
                                                 statut):
    candidat = fabrique.locataire()
    match = fabrique.match(candidat, annonce, status=statut)

    vu_bailleur = client.get(f"/api/matches/{match.id}", headers=entetes(bailleur)).get_json()
    vu_candidat = client.get(f"/api/matches/{match.id}", headers=entetes(candidat)).get_json()

    assert ("passeport" in vu_bailleur) is (statut in STATUTS_OUVRANT_PASSEPORT)
    assert vu_candidat["passeport"]["revenu_mensuel"] == 6_000_000


# ─── Suggestions de candidats : version réduite ──────────────

def test_suggestions_en_version_reduite(client, fabrique, bailleur, annonce, entetes):
    # Le passeport par défaut correspond à l'annonce (Conakry, budget).
    suggere = fabrique.locataire(full_name="Mariama Bah Diallo")
    suggere.passport.quartiers_souhaites = "Kipé"
    suggere.passport.employeur = "Banque Centrale"
    db.session.commit()

    reponse = client.get(f"/api/matches/candidats-suggeres?listing_id={annonce.id}",
                         headers=entetes(bailleur))

    assert reponse.status_code == 200
    (candidat,) = reponse.get_json()["candidats"]
    assert set(candidat) == {"tenant", "score_compatibilite", "details_compatibilite",
                             "abonne_passeport"}
    assert candidat["tenant"] == {"id": suggere.id, "role": "tenant",
                                  "full_name": "Mariama D.", "trust_level": 1}
    texte = repr(candidat)
    for fuite in ("3000000", "Kipé", "salarié", "Banque Centrale", "6000000", "Diallo"):
        assert fuite not in texte, f"{fuite} servi dans une suggestion"


def test_suggestion_n_ouvre_pas_le_dossier(client, fabrique, bailleur, annonce, entetes):
    suggere = fabrique.locataire()

    assert client.get(f"/api/passport/{suggere.id}", headers=entetes(bailleur)).status_code == 404
    assert "passeport" not in client.get(f"/api/users/{suggere.id}",
                                         headers=entetes(bailleur)).get_json()


@pytest.mark.parametrize(("nom", "attendu"), [
    ("Mariama Diallo", "Mariama D."),
    ("Mamadou Alpha Barry", "Mamadou B."),
    ("Fatou", "Fatou"),
    ("", "Locataire"),
    (None, "Locataire"),
])
def test_nom_reduit(nom, attendu):
    assert nom_reduit(nom) == attendu


# ─── Adresse exacte ──────────────────────────────────────────

LECTEURS_ANNONCE = (
    ["anonyme", "locataire_tiers", "bailleur_sans_lien", "proprietaire", "admin"]
    + [f"candidat_{s}" for s in STATUTS]
)


def _adresse_attendue(lecteur):
    if lecteur in ("proprietaire", "admin"):
        return True
    return lecteur.startswith("candidat_") and \
        lecteur.removeprefix("candidat_") in STATUTS_OUVRANT_ADRESSE


@pytest.fixture
def lecteur_annonce(fabrique, bailleur, annonce):
    """`lecteur_annonce(nom)` → l'utilisateur qui lit `annonce` (None pour
    l'anonyme), avec sa candidature éventuelle."""
    def fabriquer(nom):
        if nom == "anonyme":
            return None
        if nom == "locataire_tiers":
            return fabrique.locataire()
        if nom == "bailleur_sans_lien":
            return fabrique.bailleur()
        if nom == "proprietaire":
            return bailleur
        if nom == "admin":
            return fabrique.admin()
        candidat = fabrique.locataire()
        fabrique.match(candidat, annonce, status=nom.removeprefix("candidat_"))
        return candidat
    return fabriquer


def _verifier_adresse(donnees, annonce, visible):
    if visible:
        assert donnees["adresse"] == annonce.adresse
        assert donnees["adresse_masquee"] is False
    else:
        assert donnees["adresse"] is None
        assert donnees["adresse_masquee"] is True


@pytest.mark.parametrize("lecteur", LECTEURS_ANNONCE)
def test_adresse_dans_le_detail(client, annonce, lecteur_annonce, entetes, lecteur):
    user = lecteur_annonce(lecteur)
    corps = client.get(f"/api/listings/{annonce.id}",
                       headers=entetes(user) if user else {}).get_json()
    _verifier_adresse(corps, annonce, _adresse_attendue(lecteur))


@pytest.mark.parametrize("lecteur", LECTEURS_ANNONCE)
def test_adresse_dans_la_recherche(client, annonce, lecteur_annonce, entetes, lecteur):
    user = lecteur_annonce(lecteur)
    (resultat,) = client.get("/api/listings/",
                             headers=entetes(user) if user else {}).get_json()["listings"]
    _verifier_adresse(resultat, annonce, _adresse_attendue(lecteur))


@pytest.mark.parametrize("lecteur", LECTEURS_ANNONCE)
def test_adresse_dans_le_profil_du_bailleur(client, bailleur, annonce, lecteur_annonce, entetes,
                                            lecteur):
    user = lecteur_annonce(lecteur)
    corps = client.get(f"/api/users/{bailleur.id}",
                       headers=entetes(user) if user else {}).get_json()
    (resultat,) = corps["annonces"]
    _verifier_adresse(resultat, annonce, _adresse_attendue(lecteur))


@pytest.mark.parametrize("lecteur", [n for n in LECTEURS_ANNONCE if n != "anonyme"])
def test_adresse_dans_les_favoris(client, annonce, lecteur_annonce, entetes, lecteur):
    user = lecteur_annonce(lecteur)
    en_tetes = entetes(user)
    assert client.post(f"/api/favorites/{annonce.id}", headers=en_tetes).status_code == 201

    (resultat,) = client.get("/api/favorites/", headers=en_tetes).get_json()["listings"]
    _verifier_adresse(resultat, annonce, _adresse_attendue(lecteur))


def test_adresse_absente_des_recommandations(client, fabrique, annonce, entetes):
    # Les recommandations excluent les annonces où le locataire a candidaté :
    # il ne peut donc jamais y lire d'adresse.
    locataire = fabrique.locataire()
    (resultat,) = client.get("/api/listings/recommandations",
                             headers=entetes(locataire)).get_json()["listings"]
    _verifier_adresse(resultat, annonce, False)


@pytest.mark.parametrize("statut", STATUTS)
def test_adresse_dans_les_candidatures_du_locataire(client, fabrique, annonce, entetes, statut):
    candidat = fabrique.locataire()
    match = fabrique.match(candidat, annonce, status=statut)
    en_tetes = entetes(candidat)
    visible = statut in STATUTS_OUVRANT_ADRESSE

    (liste,) = client.get("/api/matches/mes-candidatures", headers=en_tetes).get_json()["matches"]
    detail = client.get(f"/api/matches/{match.id}", headers=en_tetes).get_json()

    _verifier_adresse(liste["listing"], annonce, visible)
    _verifier_adresse(detail["listing"], annonce, visible)


@pytest.mark.parametrize("statut", STATUTS)
def test_adresse_toujours_servie_au_proprietaire_et_a_l_admin(client, fabrique, bailleur,
                                                              annonce, admin, entetes, statut):
    match = fabrique.match(fabrique.locataire(), annonce, status=statut)

    (demande,) = client.get("/api/matches/mes-demandes",
                            headers=entetes(bailleur)).get_json()["matches"]
    detail_bailleur = client.get(f"/api/matches/{match.id}", headers=entetes(bailleur)).get_json()
    detail_admin = client.get(f"/api/matches/{match.id}", headers=entetes(admin)).get_json()

    for donnees in (demande, detail_bailleur, detail_admin):
        _verifier_adresse(donnees["listing"], annonce, True)


def test_adresse_masquee_a_la_candidature_puis_ouverte_a_l_acceptation(client, fabrique,
                                                                       bailleur, annonce,
                                                                       entetes):
    candidat = fabrique.locataire()
    creee = client.post("/api/matches/", headers=entetes(candidat),
                        json={"listing_id": annonce.id}).get_json()["match"]
    _verifier_adresse(creee["listing"], annonce, False)

    decision = client.put(f"/api/matches/{creee['id']}/statut", headers=entetes(bailleur),
                          json={"statut": "accepted"}).get_json()["match"]
    _verifier_adresse(decision["listing"], annonce, True)

    (relue,) = client.get("/api/matches/mes-candidatures",
                          headers=entetes(candidat)).get_json()["matches"]
    _verifier_adresse(relue["listing"], annonce, True)


@pytest.mark.parametrize("statut_courant", ["accepted", "completed", "rejected", "cancelled"])
def test_adresse_dans_la_conversation_suit_le_statut_courant(client, fabrique, bailleur, annonce,
                                                             entetes, statut_courant):
    candidat = fabrique.locataire()
    match = fabrique.match(candidat, annonce, status="accepted")
    conversation = Conversation.query.filter_by(match_id=match.id).one()
    # Refus après acceptation (transition permise), retrait ou conclusion :
    # la conversation survit, l'adresse ne suit que le statut courant.
    match.status = statut_courant
    db.session.commit()
    visible = statut_courant in STATUTS_OUVRANT_ADRESSE

    for user, attendu in ((candidat, visible), (bailleur, True)):
        en_tetes = entetes(user)
        (liste,) = client.get("/api/messages/conversations",
                              headers=en_tetes).get_json()["conversations"]
        fil = client.get(f"/api/messages/conversations/{conversation.id}",
                         headers=en_tetes).get_json()
        par_match = client.get(f"/api/messages/par-match/{match.id}", headers=en_tetes).get_json()
        for donnees in (liste, fil, par_match):
            _verifier_adresse(donnees["listing"], annonce, attendu)


def test_adresse_dans_les_avis_a_donner(client, fabrique, bailleur, annonce, entetes):
    candidat = fabrique.locataire()
    fabrique.match(candidat, annonce, status="completed")

    for user in (candidat, bailleur):
        (a_donner,) = client.get("/api/reviews/a-donner", headers=entetes(user)).get_json()["a_donner"]
        _verifier_adresse(a_donner["listing"], annonce, True)


@pytest.mark.parametrize("statut", STATUTS)
def test_adresse_dans_le_recu(client, fabrique, bailleur, annonce, admin, entetes, statut):
    candidat = fabrique.locataire()
    match = fabrique.match(candidat, annonce, status=statut)
    paiement = fabrique.paiement(candidat, type_paiement="caution", match_id=match.id,
                                 listing_id=annonce.id)

    for user, attendu in ((candidat, statut in STATUTS_OUVRANT_ADRESSE),
                          (bailleur, True), (admin, True)):
        recu = client.get(f"/api/payments/{paiement.id}", headers=entetes(user)).get_json()
        _verifier_adresse(recu["listing"], annonce, attendu)


def test_adresse_servie_au_proprietaire_sur_ses_routes(client, bailleur, annonce, entetes):
    en_tetes = entetes(bailleur)

    (mienne,) = client.get("/api/listings/mes-annonces", headers=en_tetes).get_json()["listings"]
    _verifier_adresse(mienne, annonce, True)

    creee = client.post("/api/listings/", headers=en_tetes, json={
        "title_fr": "Studio à Taouyah", "description_fr": "Studio meublé, calme et sécurisé.",
        "pays": "Guinée", "ville": "Conakry", "quartier": "Taouyah",
        "adresse": "Rue TA-12", "type_bien": "studio", "prix": 1_500_000,
    })
    assert creee.status_code == 201, creee.get_json()
    assert creee.get_json()["listing"]["adresse"] == "Rue TA-12"


def test_edition_par_le_proprietaire_conserve_l_adresse(client, bailleur, annonce, entetes):
    """Le formulaire d'édition pré-remplit l'adresse depuis GET /listings/<id>
    et renvoie le corps complet : l'adresse doit survivre à l'aller-retour."""
    en_tetes = entetes(bailleur)
    detail = client.get(f"/api/listings/{annonce.id}", headers=en_tetes).get_json()
    assert detail["adresse"] == annonce.adresse

    reponse = client.put(f"/api/listings/{annonce.id}", headers=en_tetes, json={
        "title_fr": "Nouveau titre", "description_fr": detail["description"],
        "pays": detail["pays"], "ville": detail["ville"], "quartier": detail["quartier"],
        "adresse": detail["adresse"], "type_bien": detail["type_bien"], "prix": detail["prix"],
    })

    assert reponse.status_code == 200, reponse.get_json()
    assert reponse.get_json()["listing"]["adresse"] == detail["adresse"]
    relue = Listing.query.get(annonce.id)
    assert relue.adresse == detail["adresse"] and relue.title_fr == "Nouveau titre"
    # Une édition sans le champ ne l'efface pas non plus.
    client.put(f"/api/listings/{annonce.id}", headers=en_tetes, json={"title_fr": "Autre titre"})
    assert Listing.query.get(annonce.id).adresse == detail["adresse"]


def test_adresse_servie_a_l_admin_en_certification(client, fabrique, annonce, admin, entetes):
    annonce.certification_status = "pending"
    db.session.commit()

    (en_attente,) = client.get("/api/admin/certifications-pending",
                               headers=entetes(admin)).get_json()
    _verifier_adresse(en_attente, annonce, True)


def test_to_dict_masque_l_adresse_par_defaut(fabrique):
    annonce = fabrique.annonce()
    donnees = annonce.to_dict()
    assert donnees["adresse"] is None and donnees["adresse_masquee"] is True

    sans_adresse = fabrique.annonce(adresse=None).to_dict()
    assert sans_adresse["adresse"] is None and sans_adresse["adresse_masquee"] is False


# ─── Annonce retirée ─────────────────────────────────────────

@pytest.mark.parametrize("lecteur", LECTEURS_ANNONCE)
def test_annonce_retiree(client, annonce, lecteur_annonce, entetes, lecteur):
    user = lecteur_annonce(lecteur)
    annonce.is_visible = False
    annonce.status = "closed"
    db.session.commit()

    reponse = client.get(f"/api/listings/{annonce.id}", headers=entetes(user) if user else {})

    if lecteur in ("anonyme", "locataire_tiers", "bailleur_sans_lien"):
        assert reponse.status_code == 404
    else:
        assert reponse.status_code == 200
        _verifier_adresse(reponse.get_json(), annonce, _adresse_attendue(lecteur))
    assert Listing.query.get(annonce.id).views_count == 0


def test_annonce_visible_compte_les_vues(client, annonce):
    client.get(f"/api/listings/{annonce.id}")
    assert Listing.query.get(annonce.id).views_count == 1


# ─── /uploads en développement ───────────────────────────────

@pytest.fixture
def fichiers_disque(app):
    import os

    dossier = app.config["UPLOAD_FOLDER"]
    os.makedirs(dossier, exist_ok=True)
    noms = ["annonce-abc-123.jpg", "profil-abc-123.png", "cni_recto-abc-123.jpg",
            "cni_verso-abc-123.jpg", "passport-abc-123.jpg", "income-abc-123.pdf",
            "propriete-abc-123.pdf", "demo_cni_recto.jpg", "photo-1.jpg"]
    for nom in noms:
        with open(os.path.join(dossier, nom), "wb") as f:
            f.write(b"contenu")
    return noms


@pytest.mark.parametrize(("nom", "servi"), [
    ("annonce-abc-123.jpg", True),
    ("profil-abc-123.png", True),
    ("cni_recto-abc-123.jpg", False),
    ("cni_verso-abc-123.jpg", False),
    ("passport-abc-123.jpg", False),
    ("income-abc-123.pdf", False),
    ("propriete-abc-123.pdf", False),
    ("demo_cni_recto.jpg", False),
    ("photo-1.jpg", False),
    ("annonce-x/../cni_recto-abc-123.jpg", False),
])
def test_uploads_ne_sert_que_les_photos(client, fichiers_disque, nom, servi):
    reponse = client.get(f"/uploads/{nom}")
    assert reponse.status_code == (200 if servi else 404)
    if servi:
        assert reponse.data == b"contenu"
    reponse.close()


def test_uploads_absent_hors_developpement(app, fichiers_disque):
    config = {k: v for k, v in app.config.items() if k.isupper()}
    config.update(DEBUG=False, TESTING=False)
    ConfigProd = type("ConfigProd", (), config)

    application = create_app(ConfigProd)

    assert not any(r.rule.startswith("/uploads") for r in application.url_map.iter_rules())
    with application.test_client() as client:
        assert client.get("/uploads/annonce-abc-123.jpg").status_code == 404


def test_pas_de_lien_vers_une_piece_privee_sur_disque(client, fabrique, bailleur, admin, entetes):
    annonce = fabrique.annonce(bailleur, documents_urls="/uploads/propriete-abc-123.pdf",
                               certification_status="pending")

    (piece,) = client.get(f"/api/listings/{annonce.id}/documents",
                          headers=entetes(bailleur)).get_json()["documents"]
    assert piece["url"] is None

    (certif,) = client.get("/api/admin/certifications-pending", headers=entetes(admin)).get_json()
    assert certif["documents"] == [None]


def test_pas_de_lien_vers_une_cni_sur_disque(client, fabrique, admin, entetes):
    candidat = fabrique.locataire(niveau=1, cni_uploaded=True)
    candidat.passport.cni_recto_url = "/uploads/cni_recto-abc-123.jpg"
    db.session.commit()

    (dossier,) = client.get("/api/admin/cni-pending", headers=entetes(admin)).get_json()
    assert dossier["pieces"] == {"cni_recto": None}
