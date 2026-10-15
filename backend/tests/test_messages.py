"""Blueprint messages : fil d'une candidature acceptée."""
from app.models import Message, Notification


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
