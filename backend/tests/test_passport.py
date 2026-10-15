"""Blueprint passport : dossier locataire, critères, pièces justificatives."""


def test_passeport_du_locataire_avec_etapes(client, locataire, entetes):
    reponse = client.get("/api/passport/", headers=entetes(locataire))

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["trust_level"] == 1
    assert [e["niveau"] for e in corps["etapes"]] == [1, 2, 3, 4]


def test_passeport_reserve_aux_locataires(client, bailleur, entetes):
    assert client.get("/api/passport/", headers=entetes(bailleur)).status_code == 403


def test_preferences_enregistrees(client, locataire, entetes):
    reponse = client.put("/api/passport/preferences", headers=entetes(locataire),
                         json={"budget_min": 500_000, "budget_max": 1_500_000,
                               "quartiers_souhaites": ["Kipé", " Nongo "]})

    assert reponse.status_code == 200
    assert reponse.get_json()["passport"]["quartiers_souhaites"] == ["Kipé", "Nongo"]


def test_preferences_budget_incoherent_refuse(client, locataire, entetes):
    reponse = client.put("/api/passport/preferences", headers=entetes(locataire),
                         json={"budget_min": 3_000_000, "budget_max": 1_000_000})
    assert reponse.status_code == 422


def test_cni_deposee_dans_le_compartiment_prive(client, locataire, entetes, supabase, fichier_image):
    reponse = client.post("/api/passport/upload/cni_recto", headers=entetes(locataire),
                          data={"file": fichier_image("cni.png")},
                          content_type="multipart/form-data")

    assert reponse.status_code == 200
    # Référence interne, jamais une URL publique.
    assert reponse.get_json()["url"].startswith("supabase://documents/")
    assert locataire.cni_uploaded is True and locataire.cni_verified is False


def test_type_de_piece_inconnu_refuse(client, locataire, entetes, fichier_image):
    reponse = client.post("/api/passport/upload/selfie", headers=entetes(locataire),
                          data={"file": fichier_image()}, content_type="multipart/form-data")
    assert reponse.status_code == 400


def test_admin_voit_le_passeport_complet(client, admin, locataire, entetes):
    reponse = client.get(f"/api/passport/{locataire.id}", headers=entetes(admin))

    assert reponse.status_code == 200
    assert reponse.get_json()["revenu_mensuel"] == 6_000_000


def test_vue_bailleur_sans_donnees_financieres(client, bailleur, match, locataire, entetes):
    reponse = client.get(f"/api/passport/{locataire.id}", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert "revenu_mensuel" not in reponse.get_json()


def test_un_locataire_ne_lit_pas_le_passeport_d_un_autre(client, fabrique, locataire, entetes):
    autre = fabrique.locataire()
    assert client.get(f"/api/passport/{autre.id}", headers=entetes(locataire)).status_code == 403
