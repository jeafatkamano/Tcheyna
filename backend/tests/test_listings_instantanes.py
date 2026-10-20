"""
tests/test_listings_instantanes.py — Réponses figées de la recherche d'annonces.

Le lot 3.1 réécrit la façon dont `GET /api/listings/` lit la base (agrégats en
une requête, bailleurs préchargés) sans rien changer à ce qu'elle répond. Ces
tests figent donc la réponse COMPLÈTE (contenu, types, ordre) sur un jeu de
données déterministe : identifiants, dates et noms fixés, plusieurs bailleurs,
des candidatures et des avis notés. Le moindre écart casse le test.

Les réponses attendues vivent dans `instantanes/recherche_annonces.json`. Elles
ont été produites par le code d'AVANT le lot 3.1. Pour les régénérer après un
changement de réponse VOULU (et relu dans le diff) :
    TCHEYNA_REGENERER_INSTANTANES=1 python -m pytest tests/test_listings_instantanes.py

Comparaison par `json.dumps(..., sort_keys=True)` : elle distingue 4 de 4.0
et True de 1, qu'une égalité de dictionnaires Python confondrait.
"""
import json
import os
from datetime import date, datetime
from pathlib import Path

import pytest

from app import db
from app.models import Favorite

FICHIER = Path(__file__).parent / "instantanes" / "recherche_annonces.json"
REGENERER = os.environ.get("TCHEYNA_REGENERER_INSTANTANES") == "1"

# Mise en avant : l'une court jusqu'en 2099, l'autre a expiré en 2001. Le
# test ne dépend donc pas de la date du jour.
PREMIUM_ACTIF = datetime(2099, 1, 1)
PREMIUM_EXPIRE = datetime(2001, 1, 1)


def _id(prefixe, n):
    """Identifiant fixe, au format UUID comme ceux de `generate_uuid`."""
    return f"00000000-0000-4000-{prefixe}-{n:012d}"


def _jour(n):
    """Dates de création distinctes : le tri « recent » n'a aucun ex aequo."""
    return datetime(2026, 3, 1, 9, 0, 0).replace(day=n)


# ─── Jeu de données ──────────────────────────────────────────

def construire_jeu(fabrique):
    """Bailleurs notés différemment, annonces variées, candidatures et
    favoris. Renvoie les comptes qui consultent la recherche."""
    def personne(role, n, nom, **champs):
        fabrique_role = {"landlord": fabrique.bailleur, "agency": fabrique.agence,
                         "admin": fabrique.admin}.get(role)
        valeurs = {"id": _id("8000", n), "full_name": nom,
                   "email": f"instantane{n}@exemple.test",
                   "created_at": datetime(2025, 1, n, 8, 0, 0)}
        valeurs.update(champs)
        if fabrique_role:
            return fabrique_role(**valeurs)
        valeurs["phone"] = f"+2246209{n:05d}"
        return fabrique.locataire(**valeurs)

    # Bailleurs : moyenne arrondie (4,25 → 4,2), moyenne entière, aucun avis.
    b1 = personne("landlord", 1, "Mamadou Barry", bio="Propriétaire à Kipé",
                  trust_level=2, phone_verified=True, cni_verified=True)
    b2 = personne("landlord", 2, "Aïssatou Camara", ville="Kindia")
    b3 = personne("landlord", 3, "Ibrahima Sow")
    agence = personne("agency", 4, "Agence du Port", avatar_url="/uploads/agence.webp")
    admin = personne("admin", 5, "Admin Tcheyna")

    # Locataire qui consulte : passeport complet, critères précis.
    lecteur = personne("tenant", 10, "Fatoumata Diallo", niveau=2, passeport=False)
    fabrique.passeport(lecteur, budget_min=1_000_000, budget_max=3_000_000,
                       ville_souhaitee="Conakry", quartiers_souhaites="Kipé, Ratoma",
                       type_bien_souhaite="appartement", nb_pieces_min=3)
    autres = [personne("tenant", 11 + i, f"Candidat {i}") for i in range(4)]

    for auteur, note in zip(autres, (5, 4, 4, 4), strict=True):
        fabrique.avis(auteur, b1, note=note)
    for auteur, note in zip(autres[:2], (3, 2), strict=True):
        fabrique.avis(auteur, b2, note=note)
    for auteur, note in zip(autres[:3], (5, 1, 3), strict=True):
        fabrique.avis(auteur, agence, note=note)
    # Un avis donné PAR un bailleur ne compte pas dans SA note.
    fabrique.avis(b3, lecteur, note=2, type_avis="landlord_to_tenant")

    def annonce(n, bailleur, **champs):
        valeurs = {"id": _id("9000", n), "title_fr": f"Annonce {n}",
                   "adresse": f"Rue KA-{n:03d}", "created_at": _jour(n),
                   "updated_at": _jour(n)}
        valeurs.update(champs)
        return fabrique.annonce(bailleur, **valeurs)

    a = {}
    a[1] = annonce(1, b1, quartier="Kipé", prix=2_500_000, superficie=85.0,
                   has_water=True, has_generator=True, certification_status="certified",
                   certified_at=datetime(2026, 2, 10, 14, 30), documents_urls="/d/1.pdf,/d/2.pdf",
                   title_en="Bright flat in Kipé", description_en="Three rooms, running water.")
    a[2] = annonce(2, b1, quartier="Ratoma", prix=1_800_000, superficie=60.5, has_wifi=True,
                   is_premium=True, premium_until=PREMIUM_ACTIF, images_urls="/u/a.webp,/u/b.webp")
    a[3] = annonce(3, b2, ville="Kindia", quartier="Centre", prix=900_000, type_bien="studio",
                   nb_pieces=1, superficie=None, meuble=True, adresse=None)
    a[4] = annonce(4, b2, quartier="Kaloum", prix=3_200_000, superficie=120.0,
                   is_premium=True, premium_until=PREMIUM_EXPIRE, has_ac=True, is_secured=True)
    a[5] = annonce(5, agence, quartier="Kipé", type_bien="villa", nb_pieces=6, prix=6_500_000,
                   charges=300_000, caution=13_000_000, superficie=300.0, has_parking=True,
                   etage=0, disponible_a_partir=date(2026, 6, 1),
                   description_fr="Villa lumineuse avec jardin.")
    a[6] = annonce(6, agence, quartier="Dixinn", type_bien="terrain", type_transaction="vente",
                   prix=450_000_000, charges=0, caution=None, nb_pieces=None, superficie=500.0,
                   images_urls=None)
    a[7] = annonce(7, b3, quartier="Ratoma", prix=2_100_000, superficie=None, nb_pieces=4,
                   certification_status="certified", certified_at=datetime(2026, 1, 5))
    a[8] = annonce(8, b3, quartier="Kipé", prix=1_200_000, type_bien="chambre", nb_pieces=1,
                   superficie=18.0, certification_status="pending")
    a[9] = annonce(9, b1, quartier="Lambanyi", prix=2_900_000, superficie=95.0,
                   type_transaction="vente", type_bien="maison", caution=None)
    a[10] = annonce(10, b2, quartier="Kipé", prix=2_000_000, superficie=70.0, has_water=True,
                    certification_status="certified", certified_at=datetime(2026, 2, 1))
    a[11] = annonce(11, agence, quartier="Kaloum", prix=1_500_000, superficie=45.0,
                    type_bien="studio", nb_pieces=1, title_en="Studio near the port")
    a[12] = annonce(12, b3, quartier="Ratoma", prix=3_000_000, superficie=110.0, nb_pieces=5,
                    has_water=True, has_generator=True, has_wifi=True)
    a[13] = annonce(13, b1, quartier="Kipé", prix=2_700_000, superficie=88.0, etage=2)
    a[14] = annonce(14, agence, quartier="Matam", prix=1_100_000, superficie=40.0, nb_pieces=2)
    # Hors recherche : retirée, ou close.
    annonce(15, b1, status="closed", is_visible=False)
    annonce(16, b2, status="matched")

    # Candidatures : celles du lecteur ouvrent (ou non) l'adresse exacte.
    fabrique.match(lecteur, a[1], status="accepted")
    fabrique.match(lecteur, a[7], status="pending")
    fabrique.match(lecteur, a[12], status="rejected")
    for i, autre in enumerate(autres):
        for n in (1, 2, 5, 10)[: i + 1]:
            fabrique.match(autre, a[n], status=("pending", "accepted", "cancelled")[i % 3])

    for n in (2, 10, 6):
        db.session.add(Favorite(user_id=lecteur.id, listing_id=a[n].id))
    db.session.add(Favorite(user_id=b1.id, listing_id=a[11].id))
    db.session.commit()

    return {"anonyme": None, "locataire": lecteur, "bailleur": b1, "agence": agence,
            "admin": admin, "candidat": autres[0]}


# ─── Scénarios ───────────────────────────────────────────────

SCENARIOS = {
    "anonyme_defaut":          ("anonyme", ""),
    "anonyme_tout":            ("anonyme", "?per_page=50"),
    "anonyme_page_1":          ("anonyme", "?per_page=5"),
    "anonyme_page_2":          ("anonyme", "?per_page=5&page=2"),
    "anonyme_page_3":          ("anonyme", "?per_page=5&page=3"),
    "anonyme_page_hors_limite": ("anonyme", "?per_page=5&page=9"),
    "anonyme_per_page_nul":    ("anonyme", "?per_page=0&page=0"),
    "anonyme_anglais":         ("anonyme", "?lang=en&per_page=6"),
    "filtre_ville_type":       ("anonyme", "?ville=Conakry&type=appartement"),
    "filtre_quartier":         ("anonyme", "?quartier=Kip%C3%A9&tri=prix_desc"),
    "filtre_prix_tri_asc":     ("anonyme", "?prix_min=1500000&prix_max=3000000&tri=prix_asc"),
    "filtre_pieces_surface":   ("anonyme", "?nb_pieces_min=3&surface_min=80"),
    "filtre_equipements":      ("anonyme", "?has_water=true&has_generator=1"),
    "filtre_certifiees":       ("anonyme", "?certified_only=yes"),
    "filtre_vente":            ("anonyme", "?transaction=vente"),
    "filtre_texte":            ("anonyme", "?q=jardin"),
    "filtre_texte_quartier":   ("anonyme", "?q=ratoma"),
    "filtre_sans_resultat":    ("anonyme", "?ville=Lab%C3%A9"),
    "tri_prix_desc":           ("anonyme", "?tri=prix_desc&per_page=7"),
    "tri_surface":             ("anonyme", "?tri=surface"),
    "tri_inconnu":             ("anonyme", "?tri=nimporte"),
    "anonyme_tri_match":       ("anonyme", "?tri=match"),
    "locataire_defaut":        ("locataire", ""),
    "locataire_page_2":        ("locataire", "?per_page=4&page=2"),
    # Tri « match » : toutes les annonces filtrées tiennent sur la page.
    "locataire_tri_match":     ("locataire", "?tri=match&per_page=50"),
    "locataire_tri_match_filtre": ("locataire", "?tri=match&ville=Conakry&per_page=50"),
    "locataire_candidat_match": ("candidat", "?tri=match&lang=en&per_page=20"),
    "bailleur_prix_asc":       ("bailleur", "?tri=prix_asc"),
    "bailleur_tri_match":      ("bailleur", "?tri=match&per_page=6"),
    "agence_defaut":           ("agence", "?per_page=8&page=2"),
    "admin_defaut":            ("admin", "?per_page=6"),
}


def _instantanes():
    if FICHIER.exists():
        return json.loads(FICHIER.read_text(encoding="utf-8"))
    return {}


def _canonique(valeur):
    return json.dumps(valeur, sort_keys=True, ensure_ascii=False, indent=1)


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_reponse_de_recherche_inchangee(scenario, client, fabrique, entetes):
    comptes = construire_jeu(fabrique)
    lecteur, parametres = SCENARIOS[scenario]
    compte = comptes[lecteur]

    reponse = client.get(f"/api/listings/{parametres}",
                         headers=entetes(compte) if compte else {})
    obtenu = {"status": reponse.status_code, "json": reponse.get_json()}

    if REGENERER:
        instantanes = _instantanes()
        instantanes[scenario] = obtenu
        FICHIER.parent.mkdir(exist_ok=True)
        # Un scénario par ligne : le fichier reste compact, et un diff montre
        # d'emblée quels scénarios ont changé.
        lignes = [f"{json.dumps(nom)}: {json.dumps(valeur, sort_keys=True, ensure_ascii=False)}"
                  for nom, valeur in sorted(instantanes.items())]
        FICHIER.write_text("{\n" + ",\n".join(lignes) + "\n}\n", encoding="utf-8")
        pytest.skip("instantané régénéré")

    attendu = _instantanes().get(scenario)
    assert attendu is not None, f"aucun instantané pour « {scenario} »"
    assert _canonique(obtenu) == _canonique(attendu)


def test_le_jeu_couvre_les_cas_qui_comptent(client, fabrique, entetes):
    """Garde-fou sur les instantanés eux-mêmes : s'ils ne contenaient ni
    candidatures, ni avis, ni score, ils ne protégeraient de rien."""
    attendu = _instantanes()
    assert set(attendu) == set(SCENARIOS)

    annonces = attendu["locataire_tri_match"]["json"]["listings"]
    assert len(annonces) == 14 and attendu["locataire_tri_match"]["json"]["pages"] == 1
    assert {a["nb_candidatures"] for a in annonces} >= {0, 1, 2, 3}
    notes = {a["landlord"]["full_name"]: (a["landlord"]["nb_avis"], a["landlord"]["note_moyenne"])
             for a in annonces}
    assert notes == {"Mamadou Barry": (4, 4.2), "Aïssatou Camara": (2, 2.5),
                     "Ibrahima Sow": (0, None), "Agence du Port": (3, 3.0)}
    scores = [a["score_compatibilite"] for a in annonces]
    assert scores == sorted(scores, reverse=True) and len(set(scores)) > 3
    assert any(a["adresse"] for a in annonces) and any(a["is_favorite"] for a in annonces)
    # Les pages 1 à 3 recouvrent exactement la page unique.
    pages = [a["id"] for p in (1, 2, 3) for a in attendu[f"anonyme_page_{p}"]["json"]["listings"]]
    assert pages == [a["id"] for a in attendu["anonyme_tout"]["json"]["listings"]]
