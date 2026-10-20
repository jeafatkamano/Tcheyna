"""
tests/conftest.py — Socle commun des tests de l'API.

Trois garanties, valables pour chaque test :
  • une base SQLite en mémoire, recréée à chaque test : aucun état ne fuit
    d'un test à l'autre, et l'ordre d'exécution n'a pas d'importance ;
  • aucun appel réseau : `requests` et les sockets sont bloqués. Supabase et
    CinetPay se simulent par les fixtures `supabase` et `cinetpay`, qui
    déclarent les seules réponses autorisées ;
  • aucun SMS : le module `africastalking` est remplacé par un faux qui
    consigne les envois (fixture `sms`).

Les clés externes sont vidées explicitement : `config.py` lit le fichier
.env à l'import, et un poste de développeur qui y a mis de vraies clés ne
doit pas déclencher de vrais appels depuis les tests.
"""
import itertools
import json
import socket
import sys
import types
from datetime import datetime

import pytest
import requests
from flask import request_tearing_down
from flask_jwt_extended import create_access_token
from werkzeug.security import generate_password_hash

from app import create_app, db
from app.models import (
    Conversation,
    Listing,
    Match,
    Payment,
    Review,
    TenantPassport,
    User,
)
from config import TestingConfig

MOT_DE_PASSE = "motdepasse-test"
# Le hachage scrypt coûte ~0,1 s : calculé une fois, il sert à tous les comptes.
HASH_MOT_DE_PASSE = generate_password_hash(MOT_DE_PASSE)

SUPABASE_URL_TEST = "https://supabase.test"


# ─── Réseau ──────────────────────────────────────────────────

class ReseauBloque(RuntimeError):
    """Levée par toute tentative de sortie réseau non déclarée par un test."""


def _reponse(status=200, json_data=None, texte=None, url=""):
    """Construit une vraie `requests.Response`, pour que le code testé la
    manipule exactement comme une réponse distante."""
    reponse = requests.Response()
    reponse.status_code = status
    reponse.url = url
    if json_data is not None:
        reponse._content = json.dumps(json_data).encode()
        reponse.headers["Content-Type"] = "application/json"
    else:
        reponse._content = (texte or "").encode()
    return reponse


class FauxReseau:
    """Remplace `requests.Session.request` : seules les routes déclarées
    répondent, toute autre requête lève `ReseauBloque`.

    `requests.get/post/delete` passent tous par `Session.request` : un seul
    point d'interception couvre donc Supabase et CinetPay.
    """

    def __init__(self):
        self.routes = []
        self.appels = []

    def repondre(self, methode, debut_url, status=200, json=None, texte=None, exception=None):
        """Déclare une réponse. La dernière déclaration correspondante gagne,
        ce qui permet à un test de surcharger le comportement d'une fixture."""
        self.routes.append((methode.upper(), debut_url, status, json, texte, exception))

    def __call__(self, _session, method, url, *args, **kwargs):
        self.appels.append({"methode": method.upper(), "url": url,
                            "json": kwargs.get("json"), "headers": kwargs.get("headers")})
        for methode, debut, status, json_data, texte, exception in reversed(self.routes):
            if methode == method.upper() and url.startswith(debut):
                if exception is not None:
                    raise exception
                return _reponse(status, json_data, texte, url)
        raise ReseauBloque(f"Appel réseau non simulé pendant un test : {method} {url}")

    def appels_vers(self, debut_url):
        return [a for a in self.appels if a["url"].startswith(debut_url)]


@pytest.fixture(autouse=True)
def reseau(monkeypatch):
    """Garde-fou actif dans tous les tests : rien ne sort de la machine."""
    faux = FauxReseau()

    def request(session, method, url, *args, **kwargs):
        return faux(session, method, url, *args, **kwargs)

    monkeypatch.setattr(requests.Session, "request", request)

    # Filet sous `requests` : un client HTTP qui le contournerait (urllib,
    # SDK tiers) bute sur la résolution DNS ou sur l'ouverture de socket.
    # Les sockets Unix (ex. PostgreSQL local) restent permis. Python sous
    # Windows n'a pas `socket.AF_UNIX` : là, tout socket est bloqué.
    af_unix = getattr(socket, "AF_UNIX", None)

    def bloquer_resolution(hote, *_args, **_kwargs):
        raise ReseauBloque(f"Résolution DNS interdite pendant un test : {hote!r}")

    def bloquer_si_reseau(origine):
        def connecter(sock, adresse):
            if af_unix is not None and sock.family == af_unix:
                return origine(sock, adresse)
            raise ReseauBloque(f"Connexion réseau interdite pendant un test : {adresse!r}")
        return connecter

    monkeypatch.setattr(socket, "getaddrinfo", bloquer_resolution)
    monkeypatch.setattr(socket.socket, "connect", bloquer_si_reseau(socket.socket.connect))
    monkeypatch.setattr(socket.socket, "connect_ex", bloquer_si_reseau(socket.socket.connect_ex))
    return faux


@pytest.fixture(autouse=True)
def sms(monkeypatch):
    """Faux module `africastalking` : consigne les SMS au lieu de les envoyer.

    `auth.send_sms_otp` importe le module à l'appel : le remplacer dans
    `sys.modules` suffit. Les SMS ne partent que si AT_API_KEY est renseignée,
    ce que la configuration de test laisse vide par défaut.
    """
    envoyes = []

    def send(message, destinataires, sender_id=None):
        envoyes.append({"message": message, "destinataires": list(destinataires),
                        "sender_id": sender_id})
        return {"SMSMessageData": {"Recipients": [{"status": "Success"}]}}

    faux = types.ModuleType("africastalking")
    faux.initialize = lambda username, api_key: None
    faux.SMS = types.SimpleNamespace(send=send)
    monkeypatch.setitem(sys.modules, "africastalking", faux)
    return envoyes


# ─── Application et base ─────────────────────────────────────

@pytest.fixture
def app(tmp_path):
    class ConfigTest(TestingConfig):
        UPLOAD_FOLDER = str(tmp_path / "uploads")
        DEBUG = False
        SECRET_KEY = "secret-de-test"
        JWT_SECRET_KEY = "jwt-secret-de-test-assez-long-pour-hs256"
        # Aucune intégration externe par défaut : chaque test qui en a besoin
        # passe par la fixture dédiée.
        SUPABASE_URL = ""
        SUPABASE_SERVICE_KEY = ""
        AT_API_KEY = ""
        CINETPAY_API_KEY = ""
        CINETPAY_SITE_ID = ""
        CINETPAY_NOTIFY_URL = ""
        CINETPAY_RETURN_URL = ""

    application = create_app(ConfigTest)

    # Le client de test réutilise le contexte d'application du test, donc la
    # même session SQLAlchemy : sans précaution, un test verrait les écritures
    # qu'une route a faites sans les valider (commit oublié), et croirait à tort
    # qu'elles sont en base. En production, la session meurt avec la requête ;
    # ici, on annule ce qui n'est pas validé et on expire tous les objets, que
    # le test relit donc depuis la base. (`remove` détacherait les objets des
    # fixtures, inutilisables ensuite.)
    def fin_de_requete(_sender, **_kwargs):
        db.session.rollback()

    request_tearing_down.connect(fin_de_requete, application)

    with application.app_context():
        db.create_all()
        yield application
        request_tearing_down.disconnect(fin_de_requete, application)
        db.session.remove()
        db.drop_all()
        # La base en mémoire tient dans une connexion unique (StaticPool) :
        # sans fermeture explicite, chaque test laisserait une connexion SQLite
        # ouverte, signalée en ResourceWarning.
        db.engine.dispose()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def compteur_sql(app):
    """Compte les requêtes SQL émises dans un bloc `with compteur_sql() as c:`."""
    from contextlib import contextmanager

    from sqlalchemy import event

    @contextmanager
    def compter():
        requetes = []

        def enregistrer(_conn, _cursor, statement, *_args):
            requetes.append(statement)

        event.listen(db.engine, "before_cursor_execute", enregistrer)
        try:
            yield requetes
        finally:
            event.remove(db.engine, "before_cursor_execute", enregistrer)

    return compter


# ─── Fabriques ───────────────────────────────────────────────

class Fabrique:
    """Crée des objets valides avec des valeurs par défaut réalistes.

    Chaque méthode accepte des surcharges nommées, transmises telles quelles
    au modèle : un test ne précise que ce qui compte pour lui.
    """

    _seq = itertools.count(1)

    def _n(self):
        return next(self._seq)

    def utilisateur(self, role="tenant", **champs):
        n = self._n()
        valeurs = {
            "email": f"{role}{n}@exemple.test",
            "password_hash": HASH_MOT_DE_PASSE,
            "full_name": f"{role.capitalize()} {n}",
            "role": role,
            "pays": "Guinée",
            "ville": "Conakry",
            "trust_level": 0,
            "is_active": True,
        }
        valeurs.update(champs)
        user = User(**valeurs)
        db.session.add(user)
        db.session.commit()
        return user

    def admin(self, **champs):
        return self.utilisateur("admin", **champs)

    def bailleur(self, **champs):
        return self.utilisateur("landlord", **champs)

    def agence(self, **champs):
        return self.utilisateur("agency", **champs)

    def locataire(self, niveau=1, passeport=True, **champs):
        """Locataire au niveau de confiance demandé (0 à 3), avec passeport.

        Les drapeaux de vérification sont posés de façon cohérente avec le
        niveau : `update_trust_level` les relit, il ne faut pas qu'il
        redescende le niveau au premier appel.
        """
        n = self._n()
        drapeaux = {
            "phone": f"+22462{n:07d}",
            "phone_verified": niveau >= 1,
            "cni_uploaded": niveau >= 2,
            "cni_verified": niveau >= 2,
            "income_verified": niveau >= 3,
            "trust_level": niveau,
        }
        drapeaux.update(champs)
        user = self.utilisateur("tenant", **drapeaux)
        if passeport:
            self.passeport(user)
        return user

    def passeport(self, locataire, **champs):
        valeurs = {
            "tenant_id": locataire.id,
            "devise": "GNF",
            "budget_min": 1_000_000,
            "budget_max": 3_000_000,
            "ville_souhaitee": "Conakry",
            "situation_pro": "salarié",
            "revenu_mensuel": 6_000_000,
        }
        valeurs.update(champs)
        passeport = TenantPassport(**valeurs)
        db.session.add(passeport)
        db.session.flush()
        passeport.calculate_score()
        db.session.commit()
        return passeport

    def annonce(self, bailleur=None, **champs):
        bailleur = bailleur or self.bailleur()
        n = self._n()
        valeurs = {
            "landlord_id": bailleur.id,
            "title_fr": f"Appartement {n} à Kipé",
            "description_fr": "Trois pièces lumineuses, eau courante et groupe électrogène.",
            "pays": "Guinée",
            "ville": "Conakry",
            "quartier": "Kipé",
            "adresse": f"Rue KA-{n:03d}, porte bleue",
            "type_transaction": "location",
            "type_bien": "appartement",
            "prix": 2_000_000,
            "charges": 100_000,
            "caution": 4_000_000,
            "devise": "GNF",
            "nb_pieces": 3,
            "status": "active",
            "is_visible": True,
            "images_urls": "/uploads/photo-1.jpg",
        }
        valeurs.update(champs)
        annonce = Listing(**valeurs)
        db.session.add(annonce)
        db.session.commit()
        return annonce

    def match(self, locataire=None, annonce=None, status="pending", **champs):
        """Candidature ; une conversation est ouverte dès qu'elle est acceptée,
        comme le fait `PUT /matches/<id>/statut`."""
        locataire = locataire or self.locataire()
        annonce = annonce or self.annonce()
        match = Match(tenant_id=locataire.id, listing_id=annonce.id, status=status,
                      score_compatibilite=70, **champs)
        db.session.add(match)
        db.session.flush()
        if status in ("accepted", "completed"):
            db.session.add(Conversation(match_id=match.id, tenant_id=locataire.id,
                                        landlord_id=annonce.landlord_id))
        if status == "completed":
            match.completed_at = datetime.utcnow()
        db.session.commit()
        return match

    def avis(self, auteur, cible, note=5, match=None, **champs):
        review = Review(reviewer_id=auteur.id, target_id=cible.id,
                        match_id=match.id if match else None, note=note,
                        type_avis=champs.pop("type_avis", "tenant_to_landlord"),
                        is_positive=note >= 4, **champs)
        db.session.add(review)
        db.session.commit()
        return review

    def paiement(self, user, **champs):
        n = self._n()
        valeurs = {
            "user_id": user.id,
            "reference": f"TCH-TEST{n:04d}",
            "type_paiement": "certification",
            "montant": 250_000,
            "devise": "GNF",
            "statut": "pending",
            "cinetpay_transaction_id": f"TRANSTEST{n:06d}",
        }
        valeurs.update(champs)
        paiement = Payment(**valeurs)
        db.session.add(paiement)
        db.session.commit()
        return paiement


@pytest.fixture
def fabrique(app):
    return Fabrique()


@pytest.fixture
def admin(fabrique):
    return fabrique.admin()


@pytest.fixture
def bailleur(fabrique):
    return fabrique.bailleur()


@pytest.fixture
def agence(fabrique):
    return fabrique.agence()


@pytest.fixture
def locataire(fabrique):
    """Locataire « Basique » (téléphone vérifié) avec passeport : le profil
    minimal pour candidater."""
    return fabrique.locataire(niveau=1)


@pytest.fixture
def annonce(fabrique, bailleur):
    return fabrique.annonce(bailleur)


@pytest.fixture
def match(fabrique, locataire, annonce):
    """Candidature acceptée, conversation ouverte."""
    return fabrique.match(locataire, annonce, status="accepted")


# ─── Authentification ────────────────────────────────────────

@pytest.fixture
def entetes(app):
    """`entetes(user)` → en-têtes portant un jeton d'accès valide.

    Le jeton est émis comme le fait `auth.emettre_tokens` (identité = id de
    l'utilisateur, claim `tv` = version actuelle de ses jetons). Le parcours
    de connexion réel est testé à part, dans test_auth.py : inutile de payer
    un `check_password_hash` par test.
    """
    def fabriquer(user, refresh=False):
        claims = {"tv": user.token_version}
        if refresh:
            from flask_jwt_extended import create_refresh_token
            jeton = create_refresh_token(identity=user.id, additional_claims=claims)
        else:
            jeton = create_access_token(identity=user.id, additional_claims=claims)
        return {"Authorization": f"Bearer {jeton}"}

    return fabriquer


@pytest.fixture
def codes_otp(monkeypatch):
    """Codes OTP générés pendant le test, dans l'ordre. La base n'en garde
    qu'une empreinte (lot 1.4) : c'est le seul moyen de les connaître sans
    passer par le faux SMS."""
    from app.routes import auth

    generes = []
    generer = auth.generate_otp

    def espion(*args, **kwargs):
        code = generer(*args, **kwargs)
        generes.append(code)
        return code

    monkeypatch.setattr(auth, "generate_otp", espion)
    return generes


# ─── Intégrations simulées ───────────────────────────────────

class FauxSupabase:
    """Stockage Supabase simulé : téléversement, signature, suppression et
    liste des compartiments répondent comme le service réel."""

    def __init__(self, reseau):
        self.reseau = reseau
        base = f"{SUPABASE_URL_TEST}/storage/v1"
        reseau.repondre("GET", f"{base}/bucket", json=[{"id": "tcheyna-photos"},
                                                       {"id": "tcheyna-documents"}])
        # La plus spécifique en dernier : c'est la dernière déclaration qui gagne.
        reseau.repondre("POST", f"{base}/object/", status=200, json={"Key": "ok"})
        reseau.repondre("POST", f"{base}/object/sign/",
                        json={"signedURL": "/object/sign/tcheyna-documents/x?token=t"})
        reseau.repondre("DELETE", f"{base}/object/", status=200, json={})

    @property
    def televersements(self):
        return [a for a in self.reseau.appels_vers(f"{SUPABASE_URL_TEST}/storage/v1/object/")
                if a["methode"] == "POST" and "/sign/" not in a["url"]]

    @property
    def suppressions(self):
        return [a for a in self.reseau.appels if a["methode"] == "DELETE"]

    def panne(self):
        """Toute requête vers Supabase échoue comme sur une coupure réseau."""
        for methode in ("GET", "POST", "DELETE"):
            self.reseau.repondre(methode, SUPABASE_URL_TEST,
                                 exception=requests.ConnectionError("Supabase injoignable"))


@pytest.fixture
def supabase(app, reseau):
    app.config.update(SUPABASE_URL=SUPABASE_URL_TEST, SUPABASE_SERVICE_KEY="cle-service-de-test")
    return FauxSupabase(reseau)


class FauxCinetPay:
    """Passerelle CinetPay simulée. Par défaut : initiation acceptée,
    transaction « ACCEPTED » à la vérification, pour 250 000 GNF (le montant
    d'une certification, celui des paiements de la fabrique)."""

    def __init__(self, reseau):
        from app.routes.payments import CINETPAY_CHECK_URL, CINETPAY_INIT_URL

        self.reseau = reseau
        self.url_init = CINETPAY_INIT_URL
        self.url_check = CINETPAY_CHECK_URL
        reseau.repondre("POST", self.url_init, json={
            "code": "201",
            "data": {"payment_token": "jeton-test",
                     "payment_url": "https://checkout.cinetpay.test/paiement"},
        })
        self.statut("ACCEPTED", montant=250_000, devise="GNF")

    def statut(self, statut, code="00", montant=None, devise=None):
        """Réponse de `payment/check` pour toute transaction."""
        data = {"status": statut}
        if montant is not None:
            data["amount"] = str(montant)
        if devise is not None:
            data["currency"] = devise
        self.reseau.repondre("POST", self.url_check, json={"code": code, "data": data})

    def panne(self):
        """CinetPay injoignable (coupure réseau, délai dépassé)."""
        for url in (self.url_init, self.url_check):
            self.reseau.repondre("POST", url,
                                 exception=requests.ConnectionError("CinetPay injoignable"))

    @property
    def verifications(self):
        return self.reseau.appels_vers(self.url_check)


@pytest.fixture
def cinetpay(app, reseau):
    app.config.update(
        CINETPAY_API_KEY="cle-cinetpay-de-test",
        CINETPAY_SITE_ID="000000",
        CINETPAY_NOTIFY_URL="https://api.tcheyna.test/api/payments/callback",
        CINETPAY_RETURN_URL="https://tcheyna.test/paiements",
    )
    return FauxCinetPay(reseau)


@pytest.fixture
def fichier_image():
    """`fichier_image(nom)` → tuple (flux, nom) accepté par le client de test
    dans un envoi multipart.

    Une vraie petite image PNG (le serveur décode et ré-encode les photos),
    de couleur dérivée du nom : deux noms différents donnent deux images
    différentes, donc deux empreintes (cf. déduplication des photos).
    """
    import hashlib
    import io

    from PIL import Image

    def fabriquer(nom="photo.png"):
        couleur = tuple(hashlib.sha256(nom.encode()).digest()[:3])
        flux = io.BytesIO()
        Image.new("RGB", (8, 8), couleur).save(flux, "PNG")
        flux.seek(0)
        return (flux, nom)

    return fabriquer
