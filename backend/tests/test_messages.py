"""Blueprint messages : fil d'une candidature acceptée."""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models import Conversation, Match, Message, Notification


def test_envoi_de_message_entre_les_parties(client, match, locataire, bailleur, entetes):
    conversation = match.conversation
    reponse = client.post(f"/api/messages/conversations/{conversation.id}",
                          headers=entetes(locataire), json={"contenu": "Bonjour, visite samedi ?"})

    assert reponse.status_code == 201
    assert Notification.query.filter_by(user_id=bailleur.id, type="nouveau_message").count() == 1
    non_lus = client.get("/api/messages/non-lus", headers=entetes(bailleur)).get_json()
    assert non_lus["non_lus"] == 1


def test_lecture_du_fil_marque_les_messages_lus(client, match, locataire, bailleur, entetes):
    conversation = match.conversation
    client.post(f"/api/messages/conversations/{conversation.id}",
                headers=entetes(locataire), json={"contenu": "Bonjour"})

    reponse = client.get(f"/api/messages/par-match/{match.id}", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert Message.query.filter(Message.read_at.is_(None)).count() == 0


def test_fil_illisible_par_un_tiers(client, fabrique, match, entetes):
    tiers = fabrique.bailleur()
    conversation = match.conversation

    assert client.get(f"/api/messages/conversations/{conversation.id}",
                      headers=entetes(tiers)).status_code == 403
    assert client.post(f"/api/messages/conversations/{conversation.id}",
                       headers=entetes(tiers), json={"contenu": "spam"}).status_code == 403


def test_message_vide_refuse(client, match, locataire, entetes):
    reponse = client.post(f"/api/messages/conversations/{match.conversation.id}",
                          headers=entetes(locataire), json={"contenu": "   "})
    assert reponse.status_code == 422


# ─── Lot 2.8 : écriture fermée après refus ou retrait ────────

def _envoyer(client, entetes, auteur, conversation_id, contenu="Bonjour"):
    return client.post(f"/api/messages/conversations/{conversation_id}",
                       headers=entetes(auteur), json={"contenu": contenu})


def _refuser(client, entetes, bailleur, match_id):
    reponse = client.put(f"/api/matches/{match_id}/statut", headers=entetes(bailleur),
                         json={"statut": "rejected"})
    assert reponse.status_code == 200


def _retirer(client, entetes, locataire, match_id):
    reponse = client.delete(f"/api/matches/{match_id}", headers=entetes(locataire))
    assert reponse.status_code == 200


@pytest.mark.parametrize("auteur", ["locataire", "bailleur"])
def test_envoi_refuse_apres_refus_de_la_candidature(client, match, locataire, bailleur,
                                                     entetes, auteur):
    conversation_id = match.conversation.id
    _refuser(client, entetes, bailleur, match.id)

    expediteur = locataire if auteur == "locataire" else bailleur
    reponse = _envoyer(client, entetes, expediteur, conversation_id)

    assert reponse.status_code == 409
    corps = reponse.get_json()
    assert corps["motif"] == "candidature_refusee"
    assert "refusée" in corps["error"]
    assert Message.query.count() == 0
    # Aucune notification « nouveau message » pour un envoi refusé.
    assert Notification.query.filter_by(type="nouveau_message").count() == 0


@pytest.mark.parametrize("auteur", ["locataire", "bailleur"])
def test_envoi_refuse_apres_retrait_de_la_candidature(client, match, locataire, bailleur,
                                                      entetes, auteur):
    conversation_id = match.conversation.id
    _retirer(client, entetes, locataire, match.id)

    expediteur = locataire if auteur == "locataire" else bailleur
    reponse = _envoyer(client, entetes, expediteur, conversation_id)

    assert reponse.status_code == 409
    assert reponse.get_json()["motif"] == "candidature_retiree"
    assert Message.query.count() == 0


def test_autres_candidats_fermes_quand_la_location_est_conclue(client, fabrique, annonce,
                                                               bailleur, entetes):
    """Conclure une location refuse les autres candidatures acceptées : leurs
    conversations se ferment avec elles, celle du locataire retenu reste ouverte."""
    retenu_locataire = fabrique.locataire()
    retenu = fabrique.match(retenu_locataire, annonce, status="accepted")
    ecarte_locataire = fabrique.locataire()
    ecarte = fabrique.match(ecarte_locataire, annonce, status="accepted")
    assert client.put(f"/api/matches/{retenu.id}/conclure",
                      headers=entetes(bailleur)).status_code == 200

    reponse = _envoyer(client, entetes, ecarte_locataire, ecarte.conversation.id)
    assert reponse.status_code == 409
    assert reponse.get_json()["motif"] == "candidature_refusee"
    assert _envoyer(client, entetes, retenu_locataire,
                    retenu.conversation.id).status_code == 201


@pytest.mark.parametrize("statut", ["pending", "accepted", "completed"])
@pytest.mark.parametrize("auteur", ["locataire", "bailleur"])
def test_envoi_autorise_tant_que_la_candidature_est_ouverte(client, fabrique, locataire,
                                                            bailleur, annonce, entetes,
                                                            statut, auteur):
    match = fabrique.match(locataire, annonce, status="accepted")
    # `pending` n'a normalement pas de conversation : elle reste ouverte pour
    # ne pas couper un échange si une candidature revenait en attente.
    match.status = statut
    db.session.commit()

    expediteur = locataire if auteur == "locataire" else bailleur
    reponse = _envoyer(client, entetes, expediteur, match.conversation.id)

    assert reponse.status_code == 201


def test_statut_inconnu_ferme_l_ecriture(client, match, locataire, entetes):
    """Liste blanche : un statut que personne n'a classé ferme l'écriture."""
    match.status = "statut_futur"
    db.session.commit()

    reponse = _envoyer(client, entetes, locataire, match.conversation.id)

    assert reponse.status_code == 409
    assert reponse.get_json()["motif"] == "candidature_close"


def test_l_envoi_relit_le_statut_en_base(client, match, locataire, entetes):
    """Le contrôle lit le statut en base au moment de l'envoi : un refus écrit
    sans passer par l'objet chargé ferme bien l'écriture. (La concurrence
    réelle, verrou compris, se vérifie sur PostgreSQL : SQLite ignore
    `FOR UPDATE`.)"""
    conversation_id = match.conversation.id
    assert match.status == "accepted"  # chargé dans la session
    db.session.execute(db.update(Match).where(Match.id == match.id)
                       .values(status="rejected")
                       .execution_options(synchronize_session=False))
    db.session.commit()

    assert _envoyer(client, entetes, locataire, conversation_id).status_code == 409


@pytest.mark.parametrize("fermeture", ["refus", "retrait"])
def test_historique_lisible_apres_fermeture(client, match, locataire, bailleur, entetes,
                                            fermeture):
    conversation_id = match.conversation.id
    assert _envoyer(client, entetes, locataire, conversation_id, "Avant").status_code == 201
    if fermeture == "refus":
        _refuser(client, entetes, bailleur, match.id)
    else:
        _retirer(client, entetes, locataire, match.id)

    for lecteur in (locataire, bailleur):
        for url in (f"/api/messages/conversations/{conversation_id}",
                    f"/api/messages/par-match/{match.id}",
                    f"/api/messages/par-match/{match.id}?limite=10"):
            reponse = client.get(url, headers=entetes(lecteur))
            assert reponse.status_code == 200
            corps = reponse.get_json()
            assert [m["contenu"] for m in corps["messages"]] == ["Avant"]
            assert corps["ecriture_fermee"] is True


def test_indicateur_ecriture_fermee(client, match, locataire, bailleur, entetes):
    ouvert = client.get(f"/api/messages/par-match/{match.id}",
                        headers=entetes(locataire)).get_json()
    assert ouvert["ecriture_fermee"] is False
    assert ouvert["motif_fermeture"] is None

    _refuser(client, entetes, bailleur, match.id)

    fil = client.get(f"/api/messages/par-match/{match.id}", headers=entetes(locataire)).get_json()
    assert fil["ecriture_fermee"] is True
    assert fil["motif_fermeture"] == "candidature_refusee"

    for parametres in ("", "?page=1"):
        liste = client.get(f"/api/messages/conversations{parametres}",
                           headers=entetes(bailleur)).get_json()
        assert liste["conversations"][0]["ecriture_fermee"] is True
        assert liste["conversations"][0]["motif_fermeture"] == "candidature_refusee"


def test_tiers_refuse_apres_fermeture(client, fabrique, match, bailleur, entetes):
    """Le contrôle d'accès passe avant celui de la fermeture : un tiers reçoit
    403, pas le motif de fermeture d'une conversation qui n'est pas la sienne."""
    _refuser(client, entetes, bailleur, match.id)
    tiers = fabrique.locataire()

    reponse = _envoyer(client, entetes, tiers, match.conversation.id)
    assert reponse.status_code == 403
    assert "motif" not in reponse.get_json()


# ─── Lot 2.8 : pagination du fil ─────────────────────────────

def _fil_de(conversation, auteurs, debut=datetime(2026, 9, 1, 8, 0)):
    """Crée un message par auteur, à une minute d'écart, du plus ancien au
    plus récent ; renvoie leurs identifiants dans cet ordre."""
    ids = []
    for i, auteur in enumerate(auteurs):
        message = Message(conversation_id=conversation.id, sender_id=auteur.id,
                          contenu=f"m{i}", created_at=debut + timedelta(minutes=i))
        db.session.add(message)
        db.session.flush()
        ids.append(message.id)
    db.session.commit()
    return ids


def test_fil_sans_parametre_inchange(client, match, locataire, bailleur, entetes):
    """Rétrocompatibilité : le web actuel lit tout le fil, sans `pagination`."""
    ids = _fil_de(match.conversation, [locataire, bailleur] * 40)

    corps = client.get(f"/api/messages/par-match/{match.id}",
                       headers=entetes(locataire)).get_json()

    assert [m["id"] for m in corps["messages"]] == ids
    assert "pagination" not in corps


def test_fil_pagine_par_curseur(client, match, locataire, bailleur, entetes):
    ids = _fil_de(match.conversation, [locataire, bailleur] * 6)  # 12 messages
    url = f"/api/messages/conversations/{match.conversation.id}"

    page1 = client.get(f"{url}?limite=5", headers=entetes(locataire)).get_json()
    assert [m["id"] for m in page1["messages"]] == ids[7:]  # les plus récents, dans l'ordre
    assert page1["pagination"] == {"limite": 5, "plus_anciens": True, "curseur": ids[7]}

    page2 = client.get(f"{url}?limite=5&avant={page1['pagination']['curseur']}",
                       headers=entetes(locataire)).get_json()
    assert [m["id"] for m in page2["messages"]] == ids[2:7]
    assert page2["pagination"]["plus_anciens"] is True

    page3 = client.get(f"{url}?limite=5&avant={page2['pagination']['curseur']}",
                       headers=entetes(locataire)).get_json()
    assert [m["id"] for m in page3["messages"]] == ids[:2]
    assert page3["pagination"] == {"limite": 5, "plus_anciens": False, "curseur": None}
    # Le reste de la réponse est celui d'une conversation.
    assert page3["id"] == match.conversation.id
    assert page3["ecriture_fermee"] is False


def test_page_exacte_sans_plus_anciens(client, match, locataire, entetes):
    _fil_de(match.conversation, [locataire] * 5)

    corps = client.get(f"/api/messages/par-match/{match.id}?limite=5",
                       headers=entetes(locataire)).get_json()

    assert len(corps["messages"]) == 5
    assert corps["pagination"] == {"limite": 5, "plus_anciens": False, "curseur": None}


def test_pagination_ex_aequo_sans_perte_ni_doublon(client, match, locataire, entetes):
    """Messages de même horodatage : l'identifiant départage."""
    instant = datetime(2026, 9, 1, 8, 0)
    for i in range(7):
        db.session.add(Message(conversation_id=match.conversation.id,
                               sender_id=locataire.id, contenu=f"m{i}", created_at=instant))
    db.session.commit()
    url = f"/api/messages/par-match/{match.id}"

    vus, avant = [], None
    while True:
        suffixe = f"&avant={avant}" if avant else ""
        corps = client.get(f"{url}?limite=3{suffixe}", headers=entetes(locataire)).get_json()
        vus = [m["id"] for m in corps["messages"]] + vus
        avant = corps["pagination"]["curseur"]
        if not corps["pagination"]["plus_anciens"]:
            break

    assert len(vus) == 7 and len(set(vus)) == 7
    assert vus == sorted(vus)


def test_avant_sans_limite_utilise_la_limite_par_defaut(client, match, locataire, entetes):
    from app.schemas.messages import LIMITE_MESSAGES_DEFAUT

    ids = _fil_de(match.conversation, [locataire] * (LIMITE_MESSAGES_DEFAUT + 5))

    corps = client.get(f"/api/messages/par-match/{match.id}?avant={ids[-1]}",
                       headers=entetes(locataire)).get_json()

    assert corps["pagination"]["limite"] == LIMITE_MESSAGES_DEFAUT
    assert [m["id"] for m in corps["messages"]] == ids[4:-1]


def test_page_marque_lus_seulement_ses_messages(client, match, locataire, bailleur, entetes):
    ids = _fil_de(match.conversation, [locataire] * 4)

    client.get(f"/api/messages/par-match/{match.id}?limite=2", headers=entetes(bailleur))

    lus = {m.id for m in Message.query.filter(Message.read_at.isnot(None))}
    assert lus == set(ids[2:])


@pytest.mark.parametrize("requete, champ", [
    ("limite=0", "limite"),
    ("limite=101", "limite"),
    ("limite=abc", "limite"),
    ("limite=", "limite"),
    ("limite=-3", "limite"),
    ("avant=", "avant"),
    ("avant=" + "x" * 37, "avant"),
    ("avant=inconnu", "avant"),
])
def test_parametres_de_pagination_invalides(client, match, locataire, entetes, requete, champ):
    reponse = client.get(f"/api/messages/par-match/{match.id}?{requete}",
                         headers=entetes(locataire))

    assert reponse.status_code == 422
    corps = reponse.get_json()
    assert corps["error"]
    assert corps["details"][0]["champ"] == champ


def test_curseur_d_une_autre_conversation_refuse(client, fabrique, match, locataire, entetes):
    autre = fabrique.match(status="accepted")
    (etranger,) = _fil_de(autre.conversation, [autre.tenant])

    reponse = client.get(f"/api/messages/par-match/{match.id}?avant={etranger}",
                         headers=entetes(locataire))

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["code"] == "curseur_inconnu"


def test_parametre_inconnu_ignore(client, match, locataire, entetes):
    reponse = client.get(f"/api/messages/par-match/{match.id}?_=123",
                         headers=entetes(locataire))
    assert reponse.status_code == 200
    assert "pagination" not in reponse.get_json()


def test_pagination_illisible_par_un_tiers(client, fabrique, match, locataire, entetes):
    (premier,) = _fil_de(match.conversation, [locataire])
    tiers = fabrique.locataire()

    for url in (f"/api/messages/conversations/{match.conversation.id}?limite=5",
                f"/api/messages/par-match/{match.id}?limite=5&avant={premier}",
                # Paramètres invalides : le tiers reçoit 403, pas la validation.
                f"/api/messages/par-match/{match.id}?limite=0"):
        assert client.get(url, headers=entetes(tiers)).status_code == 403
    # Rien n'a été marqué lu par le tiers.
    assert Message.query.filter(Message.read_at.isnot(None)).count() == 0


# ─── Lot 2.8 : pagination de la liste des conversations ──────

def _conversations(fabrique, bailleur, nombre):
    """`nombre` conversations du bailleur ; identifiants, la plus récente en premier."""
    ids = []
    for i in range(nombre):
        match = fabrique.match(annonce=fabrique.annonce(bailleur), status="accepted")
        match.conversation.last_message_at = datetime(2026, 9, 1) + timedelta(hours=i)
        ids.append(match.conversation.id)
    db.session.commit()
    return list(reversed(ids))


def test_liste_sans_parametre_inchangee(client, fabrique, bailleur, entetes):
    ids = _conversations(fabrique, bailleur, 25)

    corps = client.get("/api/messages/conversations", headers=entetes(bailleur)).get_json()

    assert [c["id"] for c in corps["conversations"]] == ids
    assert corps["total"] == 25
    assert "page" not in corps


def test_liste_paginee(client, fabrique, bailleur, entetes):
    ids = _conversations(fabrique, bailleur, 5)
    # Un message non lu dans la conversation la plus ANCIENNE (hors page 1).
    plus_ancienne = db.session.get(Conversation, ids[-1])
    _fil_de(plus_ancienne, [plus_ancienne.tenant], debut=datetime(2026, 8, 1))

    page1 = client.get("/api/messages/conversations?per_page=2",
                       headers=entetes(bailleur)).get_json()
    page3 = client.get("/api/messages/conversations?page=3&per_page=2",
                       headers=entetes(bailleur)).get_json()
    vide = client.get("/api/messages/conversations?page=9&per_page=2",
                      headers=entetes(bailleur)).get_json()

    assert [c["id"] for c in page1["conversations"]] == ids[:2]
    assert (page1["page"], page1["per_page"], page1["pages"], page1["total"]) == (1, 2, 3, 5)
    # La pastille compte TOUTES les conversations, pas la seule page.
    assert page1["non_lus"] == 1
    assert [c["id"] for c in page3["conversations"]] == ids[4:]
    assert vide["conversations"] == []


def test_liste_paginee_par_defaut(client, fabrique, bailleur, entetes):
    from app.schemas.messages import CONVERSATIONS_PAR_PAGE_DEFAUT

    _conversations(fabrique, bailleur, CONVERSATIONS_PAR_PAGE_DEFAUT + 1)

    corps = client.get("/api/messages/conversations?page=1",
                       headers=entetes(bailleur)).get_json()

    assert len(corps["conversations"]) == CONVERSATIONS_PAR_PAGE_DEFAUT
    assert corps["per_page"] == CONVERSATIONS_PAR_PAGE_DEFAUT


def test_liste_paginee_ne_montre_que_ses_conversations(client, fabrique, bailleur, entetes):
    _conversations(fabrique, bailleur, 2)
    tiers = fabrique.bailleur()

    corps = client.get("/api/messages/conversations?page=1",
                       headers=entetes(tiers)).get_json()

    assert corps["conversations"] == [] and corps["total"] == 0


@pytest.mark.parametrize("requete, champ", [
    ("page=0", "page"), ("page=x", "page"), ("per_page=0", "per_page"),
    ("per_page=51", "per_page"), ("per_page=1.5", "per_page"),
])
def test_liste_parametres_invalides(client, bailleur, entetes, requete, champ):
    reponse = client.get(f"/api/messages/conversations?{requete}", headers=entetes(bailleur))

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["champ"] == champ


# ─── Lot 2.8 : modèles de messages ───────────────────────────

def test_modeles_du_locataire(client, locataire, entetes):
    from app.routes.messages import MODELES_MESSAGES

    corps = client.get("/api/messages/modeles", headers=entetes(locataire)).get_json()

    assert corps["cote"] == "locataire"
    assert corps["modeles"] == MODELES_MESSAGES["locataire"]
    assert all(set(m) == {"id", "texte"} for m in corps["modeles"])


@pytest.mark.parametrize("role", ["bailleur", "agence"])
def test_modeles_du_bailleur(client, fabrique, entetes, role):
    from app.routes.messages import MODELES_MESSAGES

    utilisateur = getattr(fabrique, role)()

    corps = client.get("/api/messages/modeles", headers=entetes(utilisateur)).get_json()

    assert corps["cote"] == "bailleur"
    assert corps["modeles"] == MODELES_MESSAGES["bailleur"]
    assert corps["modeles"] != MODELES_MESSAGES["locataire"]


def test_modeles_de_l_admin(client, admin, entetes):
    corps = client.get("/api/messages/modeles", headers=entetes(admin)).get_json()
    assert corps == {"cote": None, "modeles": []}


def test_modeles_exigent_une_connexion(client):
    assert client.get("/api/messages/modeles").status_code == 401


def test_modeles_ids_uniques_et_envoyables():
    from app.routes.messages import MODELES_MESSAGES
    from app.schemas.messages import LONGUEUR_MAX

    for modeles in MODELES_MESSAGES.values():
        ids = [m["id"] for m in modeles]
        assert len(ids) == len(set(ids))
        # Un modèle doit pouvoir être envoyé tel quel.
        assert all(0 < len(m["texte"]) <= LONGUEUR_MAX for m in modeles)
