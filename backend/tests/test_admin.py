"""Blueprint admin : back-office de vérification."""
from tests.conftest import SUPABASE_URL_TEST


def test_back_office_refuse_aux_non_admins(client, locataire, bailleur, entetes):
    for user in (locataire, bailleur):
        assert client.get("/api/admin/stats", headers=entetes(user)).status_code == 403
        assert client.put(f"/api/admin/verify-cni/{locataire.id}", headers=entetes(user),
                          json={"approuve": True}).status_code == 403
    assert locataire.cni_verified is False


def test_statistiques(client, admin, annonce, locataire, entetes):
    reponse = client.get("/api/admin/stats", headers=entetes(admin))

    assert reponse.status_code == 200
    assert reponse.get_json()["annonces"]["actives"] == 1


def test_diagnostic_sans_supabase_ne_sort_pas_sur_le_reseau(client, admin, entetes, reseau):
    corps = client.get("/api/admin/diagnostic", headers=entetes(admin)).get_json()

    assert corps["stockage"]["operationnel"] is False
    assert reseau.appels == []


def test_diagnostic_avec_supabase_simule(client, admin, entetes, supabase):
    corps = client.get("/api/admin/diagnostic", headers=entetes(admin)).get_json()
    assert corps["stockage"]["operationnel"] is True


def test_file_cni_avec_liens_signes(client, fabrique, admin, entetes, supabase):
    candidat = fabrique.locataire(niveau=1, cni_uploaded=True, passeport=False)
    fabrique.passeport(candidat, cni_recto_url="supabase://documents/cni-recto.png",
                       docs_uploaded=True)

    file = client.get("/api/admin/cni-pending", headers=entetes(admin)).get_json()

    assert len(file) == 1
    assert file[0]["pieces"]["cni_recto"].startswith(f"{SUPABASE_URL_TEST}/storage/v1/")


def test_validation_explicite_d_une_cni_deposee(client, fabrique, admin, entetes):
    candidat = fabrique.locataire(niveau=1, cni_uploaded=True, passeport=False)
    fabrique.passeport(candidat, cni_recto_url="/uploads/cni.png", docs_uploaded=True)

    reponse = client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
                         json={"approuve": True})

    assert reponse.status_code == 200
    assert candidat.trust_level == 2


def test_refus_de_certification_exige_un_motif(client, fabrique, admin, entetes):
    annonce = fabrique.annonce(certification_status="pending")
    reponse = client.put(f"/api/admin/certifier/{annonce.id}", headers=entetes(admin),
                         json={"approuve": False})

    assert reponse.status_code == 400
    assert annonce.certification_status == "pending"


def test_un_admin_ne_se_desactive_pas_lui_meme(client, admin, entetes):
    reponse = client.put(f"/api/admin/users/{admin.id}/statut", headers=entetes(admin),
                         json={"is_active": False})
    assert reponse.status_code == 400


def test_liste_des_utilisateurs_filtree(client, admin, locataire, bailleur, entetes):
    corps = client.get("/api/admin/users?role=tenant", headers=entetes(admin)).get_json()
    assert [u["id"] for u in corps["users"]] == [locataire.id]
