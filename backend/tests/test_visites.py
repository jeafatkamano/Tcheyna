"""Visites (lot 2.7) : date à venir, rappel la veille.

La confirmation par l'autre partie attend une migration (voir la PR du lot) :
les deux parties fixent toujours la date librement.
"""
from datetime import datetime, timedelta

import pytest

from app.models import Match, Notification
from app.services import notifications as notify

# Heure du cron : 03:00 UTC, celle de la purge nocturne (lot 1.19).
MAINTENANT = datetime(2030, 3, 10, 3, 0)


def _url(match):
    return f"/api/matches/{match.id}/visite"


def _iso(moment):
    return f"{moment:%Y-%m-%dT%H:%M}"


def _rappels(user=None):
    requete = Notification.query.filter_by(type=notify.TYPE_RAPPEL_VISITE)
    if user is not None:
        requete = requete.filter_by(user_id=user.id)
    return requete.all()


# ─── PUT /api/matches/<id>/visite ────────────────────────────

@pytest.mark.parametrize("decalage", [timedelta(days=-1), timedelta(minutes=-1), timedelta(0)])
def test_visite_passee_ou_immediate_refusee(client, match, locataire, entetes, decalage):
    moment = datetime.utcnow() + decalage
    reponse = client.put(_url(match), headers=entetes(locataire),
                         json={"visite_date": _iso(moment)})

    assert reponse.status_code == 422
    corps = reponse.get_json()
    assert corps["error"] == "La visite doit être fixée à une date future"
    assert corps["details"] == [{"champ": "visite_date", "code": "date_passee",
                                 "message": "La visite doit être fixée à une date future"}]
    assert Match.query.get(match.id).visite_date is None
    assert Notification.query.count() == 0


def test_visite_future_acceptee_et_annoncee(client, match, locataire, bailleur, entetes):
    moment = (datetime.utcnow() + timedelta(days=3)).replace(second=0, microsecond=0)
    reponse = client.put(_url(match), headers=entetes(locataire),
                         json={"visite_date": _iso(moment)})

    assert reponse.status_code == 200
    assert Match.query.get(match.id).visite_date == moment
    assert reponse.get_json()["match"]["visite_date"] == moment.isoformat()
    assert Notification.query.filter_by(user_id=bailleur.id).count() == 1


def test_les_deux_parties_proposent_toujours_une_date(client, match, locataire, bailleur, entetes):
    # Droit inchangé tant que la confirmation n'existe pas : le dernier qui
    # propose fixe la date.
    for partie, jours in ((locataire, 2), (bailleur, 4)):
        moment = (datetime.utcnow() + timedelta(days=jours)).replace(second=0, microsecond=0)
        assert client.put(_url(match), headers=entetes(partie),
                          json={"visite_date": _iso(moment)}).status_code == 200
    # `moment` : la dernière date envoyée, celle du bailleur.
    assert Match.query.get(match.id).visite_date == moment


def test_visite_au_dela_d_un_an_refusee(client, match, bailleur, entetes):
    trop_loin = datetime.utcnow() + timedelta(days=366)
    reponse = client.put(_url(match), headers=entetes(bailleur),
                         json={"visite_date": _iso(trop_loin)})

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["code"] == "date_trop_lointaine"
    assert reponse.get_json()["error"] == "La visite doit être fixée dans les 365 prochains jours"

    dans_onze_mois = datetime.utcnow() + timedelta(days=330)
    assert client.put(_url(match), headers=entetes(bailleur),
                      json={"visite_date": _iso(dans_onze_mois)}).status_code == 200


def test_date_avec_fuseau_ramenee_en_utc(client, match, locataire, entetes):
    moment = (datetime.utcnow() + timedelta(days=5)).replace(hour=14, minute=30, second=0, microsecond=0)

    client.put(_url(match), headers=entetes(locataire),
               json={"visite_date": f"{_iso(moment)}:00+01:00"})
    assert Match.query.get(match.id).visite_date == moment - timedelta(hours=1)

    client.put(_url(match), headers=entetes(locataire),
               json={"visite_date": f"{_iso(moment)}:00Z"})
    assert Match.query.get(match.id).visite_date == moment


def test_date_avec_fuseau_deja_passee_en_utc_refusee(client, match, locataire, entetes):
    # Dans 30 minutes à UTC+2 = il y a 1 h 30 en UTC.
    moment = datetime.utcnow() + timedelta(minutes=30)
    reponse = client.put(_url(match), headers=entetes(locataire),
                         json={"visite_date": f"{_iso(moment)}:00+02:00"})
    assert reponse.status_code == 422


def test_visite_d_un_tiers_refusee(client, fabrique, match, entetes):
    moment = datetime.utcnow() + timedelta(days=2)
    for tiers in (fabrique.locataire(), fabrique.bailleur()):
        assert client.put(_url(match), headers=entetes(tiers),
                          json={"visite_date": _iso(moment)}).status_code == 403
    assert Match.query.get(match.id).visite_date is None


def test_visite_d_une_candidature_inconnue(client, locataire, entetes):
    moment = datetime.utcnow() + timedelta(days=2)
    reponse = client.put("/api/matches/inconnue/visite", headers=entetes(locataire),
                         json={"visite_date": _iso(moment)})
    assert reponse.status_code == 404


# ─── Rappel la veille ────────────────────────────────────────

def test_rappel_aux_deux_parties(fabrique, locataire, bailleur, annonce):
    visite = fabrique.match(locataire, annonce, status="accepted",
                            visite_date=datetime(2030, 3, 11, 10, 0))

    assert notify.rappeler_visites(MAINTENANT) == 2

    rappel_locataire, = _rappels(locataire)
    rappel_bailleur, = _rappels(bailleur)
    assert rappel_locataire.titre == "Rappel : visite demain"
    assert rappel_locataire.contenu == (f"Visite de « {annonce.title_fr} » demain, le 11/03/2030 "
                                        f"à 10:00, avec {bailleur.full_name}.")
    assert rappel_bailleur.contenu.endswith(f"avec {locataire.full_name}.")
    assert rappel_locataire.lien == f"/messages/{visite.id}?visite=2030-03-11T10:00"


def test_rappel_une_seule_fois_si_la_commande_est_rejouee(fabrique):
    fabrique.match(status="accepted", visite_date=datetime(2030, 3, 11, 18, 0))

    assert notify.rappeler_visites(MAINTENANT) == 2
    assert notify.rappeler_visites(MAINTENANT) == 0
    # Lendemain matin : la visite est encore à venir, mais déjà rappelée.
    assert notify.rappeler_visites(datetime(2030, 3, 11, 3, 0)) == 0
    assert len(_rappels()) == 2


def test_rappel_par_la_commande_flask(app, fabrique):
    # Horloge réelle : une visite dans une heure est toujours dans la fenêtre.
    fabrique.match(status="accepted", visite_date=datetime.utcnow() + timedelta(hours=1))
    runner = app.test_cli_runner()

    premier = runner.invoke(args=["visites", "rappeler"])
    second = runner.invoke(args=["visites", "rappeler"])

    assert premier.exit_code == 0
    assert premier.output.strip() == "2 rappel(s) de visite envoyé(s)."
    assert second.output.strip() == "0 rappel(s) de visite envoyé(s)."
    assert len(_rappels()) == 2


@pytest.mark.parametrize("visite_date", [
    datetime(2030, 3, 10, 2, 59),   # déjà passée
    datetime(2030, 3, 12, 0, 0),    # après-demain, à minuit
    datetime(2030, 3, 12, 9, 0),    # après-demain
    datetime(2030, 3, 20, 9, 0),
    None,                            # aucune visite fixée
])
def test_pas_de_rappel_hors_fenetre(fabrique, visite_date):
    fabrique.match(status="accepted", visite_date=visite_date)

    assert notify.rappeler_visites(MAINTENANT) == 0
    assert _rappels() == []


def test_fenetre_couvre_demain_jusqu_a_minuit(fabrique):
    fabrique.match(status="accepted", visite_date=datetime(2030, 3, 11, 23, 59))
    assert notify.rappeler_visites(MAINTENANT) == 2


def test_rattrapage_d_une_visite_du_jour(fabrique, locataire):
    # Fixée après le passage d'hier (ou cron manqué) : rappelée le jour même.
    fabrique.match(locataire, status="accepted", visite_date=datetime(2030, 3, 10, 16, 0))

    assert notify.rappeler_visites(MAINTENANT) == 2
    assert _rappels(locataire)[0].titre == "Rappel : visite aujourd'hui"


@pytest.mark.parametrize("statut", ["pending", "rejected", "cancelled", "completed"])
def test_pas_de_rappel_pour_une_candidature_fermee(fabrique, statut):
    fabrique.match(status=statut, visite_date=datetime(2030, 3, 11, 10, 0))

    assert notify.rappeler_visites(MAINTENANT) == 0


def test_visite_deplacee_apres_le_rappel_recoit_un_nouveau_rappel(fabrique, locataire, bailleur):
    visite = fabrique.match(locataire, status="accepted", visite_date=datetime(2030, 3, 11, 10, 0))
    assert notify.rappeler_visites(MAINTENANT) == 2

    visite.visite_date = datetime(2030, 3, 11, 15, 30)
    assert notify.rappeler_visites(MAINTENANT) == 2
    assert notify.rappeler_visites(MAINTENANT) == 0

    liens = sorted(r.lien for r in _rappels(locataire))
    assert liens == [f"/messages/{visite.id}?visite=2030-03-11T10:00",
                     f"/messages/{visite.id}?visite=2030-03-11T15:30"]


def test_rappel_complete_la_partie_qui_ne_l_a_pas(fabrique, locataire, bailleur, annonce):
    visite = fabrique.match(locataire, annonce, status="accepted",
                            visite_date=datetime(2030, 3, 11, 10, 0))
    notify.notifier(bailleur.id, notify.TYPE_RAPPEL_VISITE, "Rappel : visite demain",
                    lien=notify.lien_rappel_visite(visite), commit=True)

    assert notify.rappeler_visites(MAINTENANT) == 1
    assert len(_rappels(locataire)) == 1
    assert len(_rappels(bailleur)) == 1


def test_rappels_de_plusieurs_visites(fabrique):
    for heure in (9, 11, 14):
        fabrique.match(status="accepted", visite_date=datetime(2030, 3, 11, heure, 0))

    assert notify.rappeler_visites(MAINTENANT) == 6
