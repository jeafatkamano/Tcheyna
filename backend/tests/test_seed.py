"""seed.py — le jeu de démonstration du README s'exécute de bout en bout.

Il a déjà cassé une fois en silence (colonne renommée dans le modèle, oubliée
dans le seed) : ce test l'exécute sur la base de test. Les photos de
démonstration sont des URL Unsplash enregistrées telles quelles, rien n'est
téléchargé : le garde-fou réseau ferait échouer le test sinon.
"""
import importlib

from app.models import Conversation, Listing, Match, Review, User


def test_seed_peuple_la_base_sans_reseau(app, monkeypatch, reseau, capsys):
    # `seed` importe `run`, qui construit son application selon FLASK_ENV ;
    # sans cela, la configuration de production refuserait de démarrer.
    monkeypatch.setenv("FLASK_ENV", "testing")
    seed = importlib.import_module("seed")
    # Le seed s'exécute dans l'application et la base du test.
    monkeypatch.setattr(seed, "app", app)

    seed.seed()

    assert "Base peuplée" in capsys.readouterr().out
    assert reseau.appels == []
    assert User.query.filter_by(role="admin").count() == 1
    assert Listing.query.count() >= 5
    assert Listing.query.filter(Listing.documents_urls.isnot(None)).count() >= 1
    assert Match.query.count() == 3
    assert Conversation.query.count() == 1
    assert Review.query.count() == 2
