"""Lot 2.10 : un justificatif de revenus vaut 3 mois, relance à J-7 (décision D12)."""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models import Notification, TenantPassport, User, Verification
from app.services import donnees_personnelles as dp
from tests.conftest import SUPABASE_URL_TEST

PRIVE = f"{SUPABASE_URL_TEST}/storage/v1/object/tcheyna-documents/"
MAINTENANT = datetime(2026, 10, 21, 3, 0)


def _solvable(fabrique, depose_il_y_a=None, **champs):
    """Locataire niveau 3 dont le justificatif, validé, a été déposé il y a
    `depose_il_y_a` jours (avant MAINTENANT)."""
    user = fabrique.locataire(niveau=3, passeport=False)
    if depose_il_y_a is not None:
        champs["revenus_deposes_le"] = MAINTENANT - timedelta(days=depose_il_y_a)
    fabrique.passeport(user, income_verified=True, **champs)
    return user


def _journal(user, decision):
    return Verification.query.filter_by(cible_id=user.id, objet="revenus",
                                        decision=decision).all()


def _notifications(user, titre):
    return Notification.query.filter_by(user_id=user.id, titre=titre).all()


def _appliquer(jours_apres=0):
    return dp.appliquer_validite_revenus(MAINTENANT + timedelta(days=jours_apres))


EXPIRE = "Justificatif de revenus expiré"
RELANCE = "Justificatif de revenus à renouveler"


# ─── Expiration ──────────────────────────────────────────────

def test_justificatif_de_plus_de_3_mois_expire(fabrique):
    user = _solvable(fabrique, depose_il_y_a=91)
    score_avant = user.passport.score

    assert _appliquer() == (1, 0)

    user = User.query.get(user.id)
    assert user.income_verified is False and user.passport.income_verified is False
    assert user.trust_level == 2
    assert user.passport.score == score_avant - 25
    assert user.passport.revenus_deposes_le is None
    [ligne] = _journal(user, "expiree")
    assert ligne.acteur_id is None
    assert "90 jours" in ligne.motif
    [notif] = _notifications(user, EXPIRE)
    assert (notif.type, notif.lien) == ("niveau_confiance", "/tenant/profile")
    # Plus rien à examiner : le locataire n'entre pas dans la file de l'admin.
    assert TenantPassport.query.filter(TenantPassport.income_doc_url.isnot(None)).count() == 0


@pytest.mark.parametrize("jours, expire", [(89, False), (90, True), (91, True)])
def test_echeance_au_90e_jour(fabrique, jours, expire):
    user = _solvable(fabrique, depose_il_y_a=jours)

    expires, _ = _appliquer()

    assert expires == int(expire)
    user = User.query.get(user.id)
    assert user.income_verified is not expire
    assert user.trust_level == (2 if expire else 3)


def test_justificatif_de_moins_de_3_mois_inchange(fabrique):
    user = _solvable(fabrique, depose_il_y_a=89)
    score_avant = user.passport.score

    _appliquer()

    user = User.query.get(user.id)
    assert user.income_verified and user.passport.income_verified
    assert (user.trust_level, user.passport.score) == (3, score_avant)
    assert _journal(user, "expiree") == []
    assert _notifications(user, EXPIRE) == []


def test_commande_idempotente(app, fabrique):
    # La commande prend l'heure courante.
    user = _solvable(fabrique, revenus_deposes_le=datetime.utcnow() - timedelta(days=120))
    runner = app.test_cli_runner()

    premier = runner.invoke(args=["donnees", "expirer-revenus"])
    second = runner.invoke(args=["donnees", "expirer-revenus"])

    assert premier.exit_code == 0, premier.output
    assert "1 justificatif(s) de revenus expiré(s), 0 relance(s)" in premier.output
    assert second.exit_code == 0, second.output
    assert "0 justificatif(s) de revenus expiré(s), 0 relance(s)" in second.output
    assert len(_journal(user, "expiree")) == 1
    assert len(_notifications(user, EXPIRE)) == 1
    assert User.query.get(user.id).trust_level == 2


# ─── Relance à J-7 ───────────────────────────────────────────

def test_relance_a_j_moins_7_une_seule_fois(fabrique):
    user = _solvable(fabrique, depose_il_y_a=83)   # échéance dans 7 jours

    assert _appliquer() == (0, 1)
    assert _appliquer() == (0, 0)                  # commande rejouée le même jour
    assert _appliquer(jours_apres=1) == (0, 0)     # et les jours suivants
    assert _appliquer(jours_apres=6) == (0, 0)

    [ligne] = _journal(user, "relancee")
    assert ligne.acteur_id is None
    [notif] = _notifications(user, RELANCE)
    echeance = MAINTENANT - timedelta(days=83) + timedelta(days=90)
    assert f"{echeance:%d/%m/%Y}" in notif.contenu
    assert User.query.get(user.id).income_verified is True


def test_pas_de_relance_avant_j_moins_7(fabrique):
    user = _solvable(fabrique, depose_il_y_a=82)   # échéance dans 8 jours

    assert _appliquer() == (0, 0)
    assert _notifications(user, RELANCE) == []


def test_relance_envoyee_malgre_un_jour_manque(fabrique):
    # La commande n'a pas tourné à J-7 : la relance part à J-6.
    user = _solvable(fabrique, depose_il_y_a=82)

    assert _appliquer(jours_apres=2) == (0, 1)
    assert len(_notifications(user, RELANCE)) == 1


def test_relance_non_renvoyee_si_le_locataire_supprime_la_notification(client, fabrique,
                                                                       entetes):
    user = _solvable(fabrique, depose_il_y_a=84)
    _appliquer()
    [notif] = _notifications(user, RELANCE)

    assert client.delete(f"/api/notifications/{notif.id}",
                         headers=entetes(user)).status_code == 200
    assert _appliquer(jours_apres=1) == (0, 0)
    assert _notifications(user, RELANCE) == []


def test_pas_de_relance_ni_d_expiration_sans_validation(fabrique):
    # Justificatif en attente de décision : la purge D5 s'en charge, pas D12.
    for jours in (85, 120):
        user = fabrique.locataire(niveau=2, passeport=False)
        fabrique.passeport(user, income_doc_url=f"supabase://documents/paie-{jours}.pdf",
                           revenus_deposes_le=MAINTENANT - timedelta(days=jours))

    assert _appliquer() == (0, 0)
    assert Verification.query.count() == 0
    assert Notification.query.count() == 0
    assert TenantPassport.query.filter(TenantPassport.income_doc_url.isnot(None)).count() == 2


# ─── Point de départ des 3 mois ──────────────────────────────

def test_validation_garde_la_date_de_depot(client, fabrique, admin, entetes, supabase):
    depot = datetime.utcnow() - timedelta(days=5)
    user = fabrique.locataire(niveau=2, passeport=False)
    fabrique.passeport(user, income_doc_url="supabase://documents/paie.pdf",
                       revenus_deposes_le=depot)

    reponse = client.put(f"/api/admin/verify-revenus/{user.id}", headers=entetes(admin),
                         json={"approuve": True})

    assert reponse.status_code == 200
    assert user.passport.income_doc_url is None       # supprimé à la décision (lot 1.5)
    assert user.passport.revenus_deposes_le == depot  # mais la date reste
    # Validé à J+5 du dépôt : la validité court quand même depuis le dépôt.
    assert dp.appliquer_validite_revenus(depot + timedelta(days=90)) == (1, 0)


def test_refus_efface_la_date_de_depot(client, fabrique, admin, entetes, supabase):
    user = fabrique.locataire(niveau=2, passeport=False)
    fabrique.passeport(user, income_doc_url="supabase://documents/paie.pdf",
                       revenus_deposes_le=datetime.utcnow())

    client.put(f"/api/admin/verify-revenus/{user.id}", headers=entetes(admin),
               json={"approuve": False})

    assert user.passport.revenus_deposes_le is None


@pytest.mark.parametrize("valide_il_y_a, expire", [(30, False), (91, True)])
def test_validation_anterieure_comptee_depuis_le_journal(fabrique, admin, valide_il_y_a,
                                                         expire):
    # Validé entre les lots 1.5 et 2.10 : la date de dépôt a été effacée à la
    # décision, la date de validation au journal la remplace.
    user = _solvable(fabrique)
    ligne = dp.consigner(admin, user.id, "revenus", "approuvee")
    ligne.created_at = MAINTENANT - timedelta(days=valide_il_y_a)
    db.session.commit()

    assert _appliquer()[0] == int(expire)
    assert User.query.get(user.id).income_verified is not expire


def test_validation_sans_date_connue_consideree_echue(fabrique, supabase):
    # Validé avant le lot 1.5 et jamais rattrapé : ni date de dépôt ni ligne
    # au journal ; le fichier est encore là.
    user = _solvable(fabrique, income_doc_url="supabase://documents/ancien-paie.pdf")

    assert _appliquer() == (1, 0)

    user = User.query.get(user.id)
    assert user.income_verified is False and user.trust_level == 2
    [ligne] = _journal(user, "expiree")
    assert "inconnue" in ligne.motif
    # Supprimé, il ne revient pas dans la file d'attente de l'admin.
    assert user.passport.income_doc_url is None
    assert [a["url"] for a in supabase.suppressions] == [f"{PRIVE}documents/ancien-paie.pdf"]


def test_rattrapage_garde_la_date_des_justificatifs_valides(app, fabrique):
    user = _solvable(fabrique, depose_il_y_a=10)

    resultat = app.test_cli_runner().invoke(args=["donnees", "rattraper-pieces-decidees"])

    assert resultat.exit_code == 0, resultat.output
    assert user.passport.revenus_deposes_le == MAINTENANT - timedelta(days=10)


# ─── Re-dépôt ────────────────────────────────────────────────

def test_re_depot_remet_le_compteur(client, fabrique, admin, entetes, fichier_image):
    user = _solvable(fabrique, depose_il_y_a=84)
    _appliquer()                                    # relance envoyée
    assert len(_notifications(user, RELANCE)) == 1

    reponse = client.post("/api/passport/upload/income", headers=entetes(user),
                          data={"file": fichier_image("paie.png")},
                          content_type="multipart/form-data")
    assert reponse.status_code == 200
    # Comportement actuel : un nouveau dépôt repasse par la validation.
    assert User.query.get(user.id).income_verified is False
    nouveau_depot = user.passport.revenus_deposes_le
    assert nouveau_depot > MAINTENANT - timedelta(days=84)
    assert client.put(f"/api/admin/verify-revenus/{user.id}", headers=entetes(admin),
                      json={"approuve": True}).status_code == 200
    assert user.passport.revenus_deposes_le == nouveau_depot

    # L'ancienne échéance ne vaut plus : ni expiration ni nouvelle relance.
    assert dp.appliquer_validite_revenus(nouveau_depot + timedelta(days=1)) == (0, 0)
    # La relance du nouveau justificatif part à son propre J-7.
    assert dp.appliquer_validite_revenus(nouveau_depot + timedelta(days=83)) == (0, 1)
    assert len(_journal(user, "relancee")) == 2
    assert dp.appliquer_validite_revenus(nouveau_depot + timedelta(days=90)) == (1, 0)


def test_nouveau_revenu_declare_efface_la_date_du_justificatif_supprime(client, fabrique,
                                                                       entetes):
    user = _solvable(fabrique, depose_il_y_a=10)

    reponse = client.post("/api/passport/", headers=entetes(user),
                          json={"revenu_mensuel": 9_000_000})

    assert reponse.status_code == 200
    assert user.income_verified is False
    assert user.passport.revenus_deposes_le is None


# ─── Refus d'accès inchangés sur les routes touchées ─────────

def test_seul_l_admin_valide_les_revenus(client, fabrique, bailleur, entetes):
    cible = fabrique.locataire(niveau=2, passeport=False)
    depot = datetime.utcnow()
    fabrique.passeport(cible, income_doc_url="supabase://documents/paie.pdf",
                       revenus_deposes_le=depot)
    autre = fabrique.locataire(niveau=3)

    for intrus in (cible, autre, bailleur):
        reponse = client.put(f"/api/admin/verify-revenus/{cible.id}", headers=entetes(intrus),
                             json={"approuve": True})
        assert reponse.status_code == 403

    passeport = TenantPassport.query.filter_by(tenant_id=cible.id).one()
    assert passeport.income_doc_url and passeport.revenus_deposes_le == depot
    assert User.query.get(cible.id).income_verified is False


def test_passeport_reserve_au_locataire(client, bailleur, entetes):
    reponse = client.post("/api/passport/", headers=entetes(bailleur),
                          json={"revenu_mensuel": 9_000_000})

    assert reponse.status_code == 403
