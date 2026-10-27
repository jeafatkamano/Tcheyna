"""Blueprint reviews : avis croisés après une location conclue."""
import pytest

from app import db
from app.models import Review, moyenne_des_notes


def test_avis_du_locataire_apres_conclusion(client, fabrique, locataire, annonce, bailleur, entetes):
    conclu = fabrique.match(locataire, annonce, status="completed")

    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": 5, "commentaire": "Très sérieux"})

    assert reponse.status_code == 201
    publics = client.get(f"/api/reviews/user/{bailleur.id}").get_json()
    assert publics["total"] == 1 and publics["moyenne"] == 5


def test_avis_impossible_avant_conclusion(client, match, locataire, entetes):
    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": match.id, "note": 4})
    assert reponse.status_code == 400


def test_avis_refuse_a_un_tiers(client, fabrique, locataire, annonce, entetes):
    conclu = fabrique.match(locataire, annonce, status="completed")
    tiers = fabrique.locataire()

    reponse = client.post("/api/reviews/", headers=entetes(tiers),
                          json={"match_id": conclu.id, "note": 1})

    assert reponse.status_code == 403
    assert Review.query.count() == 0


def test_avis_a_donner(client, fabrique, locataire, annonce, bailleur, entetes):
    fabrique.match(locataire, annonce, status="completed")
    reponse = client.get("/api/reviews/a-donner", headers=entetes(bailleur))
    assert reponse.get_json()["total"] == 1


# ─── Lot 1.15 : un auteur, une voix ──────────────────────────

def _noter(client, entetes, auteur, match, note):
    reponse = client.post("/api/reviews/", headers=entetes(auteur),
                          json={"match_id": match.id, "note": note})
    assert reponse.status_code == 201, reponse.get_json()


def _locations_conclues(fabrique, locataire, bailleur, nombre):
    """`nombre` locations conclues entre les deux mêmes personnes : une
    annonce par location, la candidature étant unique par annonce. C'est
    ainsi qu'un même auteur peut noter plusieurs fois la même cible."""
    return [fabrique.match(locataire, fabrique.annonce(bailleur), status="completed")
            for _ in range(nombre)]


def _etape_avis(client, entetes, locataire):
    etapes = client.get("/api/passport/", headers=entetes(locataire)).get_json()["etapes"]
    return next(e for e in etapes if e["niveau"] == 4)


def test_trois_avis_du_meme_bailleur_ne_font_pas_le_niveau_4(client, fabrique, entetes):
    locataire = fabrique.locataire(niveau=3)
    bailleur = fabrique.bailleur()
    for conclu in _locations_conclues(fabrique, locataire, bailleur, 3):
        _noter(client, entetes, bailleur, conclu, 5)

    db.session.refresh(locataire)
    assert locataire.reviews_received.count() == 3
    assert locataire.nb_auteurs_positifs() == 1
    assert locataire.trust_level == 3
    etape = _etape_avis(client, entetes, locataire)
    assert etape["fait"] is False
    assert etape["detail"] == "1/3 avis positifs de bailleurs différents"


def test_trois_bailleurs_distincts_font_le_niveau_4(client, fabrique, entetes):
    locataire = fabrique.locataire(niveau=3)
    for _ in range(3):
        (conclu,) = _locations_conclues(fabrique, locataire, fabrique.bailleur(), 1)
        _noter(client, entetes, conclu.listing.landlord, conclu, 4)

    db.session.refresh(locataire)
    assert locataire.trust_level == 4
    etape = _etape_avis(client, entetes, locataire)
    assert etape["fait"] is True
    assert etape["detail"] == "3/3 avis positifs de bailleurs différents"


def test_un_avis_non_positif_ne_compte_pas_pour_le_niveau_4(fabrique):
    locataire = fabrique.locataire(niveau=3)
    for note in (5, 5, 3):
        fabrique.avis(fabrique.bailleur(), locataire, note=note, type_avis="landlord_to_tenant")
    assert locataire.nb_auteurs_positifs() == 2
    assert locataire.update_trust_level() == 3


def test_moyenne_une_voix_par_auteur(client, fabrique, entetes):
    """A note 5 puis 1 (moyenne 3), B note 5 : (3 + 5) / 2 = 4, et non
    (5 + 1 + 5) / 3 = 3,67 comme une moyenne des avis."""
    bailleur = fabrique.bailleur()
    locataire_a, locataire_b = fabrique.locataire(), fabrique.locataire()
    premiere, seconde = _locations_conclues(fabrique, locataire_a, bailleur, 2)
    _noter(client, entetes, locataire_a, premiere, 5)
    _noter(client, entetes, locataire_a, seconde, 1)
    (autre,) = _locations_conclues(fabrique, locataire_b, bailleur, 1)
    _noter(client, entetes, locataire_b, autre, 5)

    publics = client.get(f"/api/reviews/user/{bailleur.id}").get_json()
    assert publics["moyenne"] == 4.0
    # Le nombre d'avis reste un nombre d'avis ; `auteurs` s'y ajoute.
    assert publics["total"] == 3 and publics["auteurs"] == 2
    assert publics["positifs"] == 2
    assert publics["repartition"] == {"1": 1, "2": 0, "3": 0, "4": 0, "5": 2}

    # Même note partout où elle est servie : profil public, annonce seule,
    # recherche (agrégats lus pour toute la page).
    profil = client.get(f"/api/users/{bailleur.id}").get_json()
    assert (profil["note_moyenne"], profil["nb_avis"]) == (4.0, 3)
    detail = client.get(f"/api/listings/{premiere.listing_id}").get_json()
    assert (detail["landlord"]["note_moyenne"], detail["landlord"]["nb_avis"]) == (4.0, 3)
    recherche = client.get("/api/listings/?per_page=50").get_json()["listings"]
    notes = [(a["landlord"]["note_moyenne"], a["landlord"]["nb_avis"])
             for a in recherche if a["landlord"]["id"] == bailleur.id]
    assert notes == [(4.0, 3)] * 3


@pytest.mark.parametrize(("groupes", "attendu"), [
    ([], None),
    # Un avis par auteur : l'ancienne moyenne des avis, à l'identique.
    ([(1, 5), (1, 4), (1, 4), (1, 4)], 4.2),
    ([(1, 3), (1, 2)], 2.5),
    # Un auteur à trois avis (moyenne 4) et un autre à un avis (2).
    ([(3, 12), (1, 2)], 3.0),
])
def test_moyenne_des_notes(groupes, attendu):
    assert moyenne_des_notes(groupes) == attendu
    assert moyenne_des_notes(list(reversed(groupes))) == attendu


# ─── Lot 1.15 : identité de l'auteur masquée ─────────────────

def _auteur_de_l_avis(client, cible_id):
    (avis,) = client.get(f"/api/reviews/user/{cible_id}").get_json()["reviews"]
    return avis["reviewer"]


def _locataire_auteur(client, fabrique, entetes, bailleur, **champs):
    locataire = fabrique.locataire(avatar_url="/avatars/profil.webp", bio="Enseignante à Kipé",
                                   quartier="Kipé", **champs)
    (conclu,) = _locations_conclues(fabrique, locataire, bailleur, 1)
    _noter(client, entetes, locataire, conclu, 4)
    return locataire


def test_avis_public_auteur_locataire_reduit(client, fabrique, entetes):
    bailleur = fabrique.bailleur()
    _locataire_auteur(client, fabrique, entetes, bailleur, full_name="Mariama Diallo")

    vus = [_auteur_de_l_avis(client, bailleur.id),
           client.get(f"/api/users/{bailleur.id}").get_json()["avis"][0]["reviewer"]]
    for auteur in vus:
        assert auteur["full_name"] == "Mariama D."
        # Les clés restent, à null : même forme que `User.to_dict`.
        assert auteur["avatar_url"] is None and auteur["bio"] is None
        assert auteur["quartier"] is None
        assert {"email", "phone"}.isdisjoint(auteur)
        assert auteur["role"] == "tenant" and "trust_level" in auteur


def test_avis_publie_renvoye_avec_l_auteur_reduit(client, fabrique, entetes):
    bailleur = fabrique.bailleur()
    locataire = fabrique.locataire(full_name="Mariama Diallo", avatar_url="/avatars/m.webp")
    (conclu,) = _locations_conclues(fabrique, locataire, bailleur, 1)

    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": 5})

    auteur = reponse.get_json()["review"]["reviewer"]
    assert auteur["full_name"] == "Mariama D." and auteur["avatar_url"] is None


@pytest.mark.parametrize(("nom", "attendu"), [
    ("Fatou", "Fatou"),
    ("Mamadou   Saliou  Barry", "Mamadou B."),
    ("Marie-Claire Diallo-Bah", "Marie-Claire D."),
    ("Aïssatou élise", "Aïssatou É."),
    ("  ", "Locataire"),
])
def test_avis_public_noms_particuliers(client, fabrique, entetes, nom, attendu):
    bailleur = fabrique.bailleur()
    _locataire_auteur(client, fabrique, entetes, bailleur, full_name=nom)
    assert _auteur_de_l_avis(client, bailleur.id)["full_name"] == attendu


def test_avis_public_d_un_compte_supprime(client, fabrique, entetes):
    from app.services import donnees_personnelles as dp

    bailleur = fabrique.bailleur()
    locataire = _locataire_auteur(client, fabrique, entetes, bailleur,
                                  full_name="Mariama Diallo")
    dp.anonymiser_compte(locataire)
    db.session.commit()

    auteur = _auteur_de_l_avis(client, bailleur.id)
    # Ni « Compte S. », ni l'ancien nom.
    assert auteur["full_name"] == dp.NOM_COMPTE_SUPPRIME
    assert auteur["avatar_url"] is None and auteur["quartier"] is None


def test_avis_public_auteur_bailleur_en_clair(client, fabrique, entetes):
    """Un bailleur est public sur son profil et sur ses annonces : son avis
    sur un locataire n'a rien à masquer."""
    bailleur = fabrique.bailleur(full_name="Mamadou Barry", avatar_url="/avatars/b.webp",
                                 bio="Propriétaire à Kipé", quartier="Kipé")
    locataire = fabrique.locataire()
    (conclu,) = _locations_conclues(fabrique, locataire, bailleur, 1)
    _noter(client, entetes, bailleur, conclu, 5)

    auteur = _auteur_de_l_avis(client, locataire.id)
    assert auteur["full_name"] == "Mamadou Barry"
    assert (auteur["avatar_url"], auteur["bio"], auteur["quartier"]) == (
        "/avatars/b.webp", "Propriétaire à Kipé", "Kipé")


# ─── Refus d'accès inchangés ─────────────────────────────────

def test_avis_d_un_utilisateur_inconnu_introuvable(client):
    assert client.get("/api/reviews/user/inconnu").status_code == 404


def test_avis_sur_une_location_inconnue_introuvable(client, locataire, entetes):
    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": "inconnu", "note": 4})
    assert reponse.status_code == 404


def test_deuxieme_avis_sur_la_meme_location_refuse(client, fabrique, locataire, annonce, entetes):
    conclu = fabrique.match(locataire, annonce, status="completed")
    _noter(client, entetes, locataire, conclu, 5)

    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": 1})

    assert reponse.status_code == 409
    assert Review.query.count() == 1
