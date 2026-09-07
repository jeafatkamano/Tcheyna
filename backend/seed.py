"""
seed.py — Jeu de données de démonstration (Conakry).

Usage : python seed.py

Crée un administrateur, des locataires à différents niveaux de confiance, des
propriétaires, des annonces certifiées ou non, des candidatures, une
conversation et des avis — de quoi parcourir toute l'application.
"""
import sys
from datetime import date, datetime, timedelta

from dotenv import load_dotenv

# La console Windows utilise cp1252 par défaut et rejette les emojis.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()

from werkzeug.security import generate_password_hash  # noqa: E402

from app import db  # noqa: E402
from app.models import (  # noqa: E402
    Conversation,
    Favorite,
    Listing,
    Match,
    Message,
    Review,
    TenantPassport,
    User,
)
from app.services import notifications as notify  # noqa: E402
from run import app  # noqa: E402

MDP = "tcheyna2026"

PHOTOS = {
    "villa": [
        "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1080&q=80",
        "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1080&q=80",
    ],
    "appartement": [
        "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1080&q=80",
        "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1080&q=80",
    ],
    "studio": [
        "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1080&q=80",
        "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1080&q=80",
    ],
    "maison": [
        "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1080&q=80",
        "https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1080&q=80",
    ],
}


BASES_LOCALES = ("sqlite", "localhost", "127.0.0.1", "::1")


def verifier_base_locale():
    """Refuse de s'exécuter sur une base distante.

    Ce script supprime *toutes* les annonces, candidatures, conversations,
    avis et favoris — pas seulement ceux qu'il a créés — et crée un compte
    administrateur dont le mot de passe est publié dans le README. Lancé par
    mégarde sur la production, il détruirait les données réelles et ouvrirait
    le back-office à quiconque lit le dépôt.
    """
    uri = app.config["SQLALCHEMY_DATABASE_URI"]
    if any(marqueur in uri for marqueur in BASES_LOCALES):
        return

    hote = uri.split("@")[-1].split("/")[0] if "@" in uri else uri[:40]
    print(f"""
⛔ Base de données distante détectée : {hote}

   seed.py est réservé au développement local. Il efface toutes les données
   existantes et crée un administrateur au mot de passe public.

   Pour peupler une base distante, insérez les données vous-même, sans le
   compte administrateur et avec un mot de passe qui ne soit pas celui
   documenté dans le README.
""")
    sys.exit(1)


def creer_utilisateur(email, nom, role, phone, quartier, **kwargs):
    return User(
        email=email,
        password_hash=generate_password_hash(MDP),
        full_name=nom,
        role=role,
        phone=phone,
        pays="Guinée",
        ville="Conakry",
        quartier=quartier,
        preferred_lang="fr",
        **kwargs,
    )


def seed():
    with app.app_context():
        verifier_base_locale()

        print("🗄️  Création des tables…")
        db.create_all()

        print("🧹 Nettoyage des données de démonstration…")
        for modele in (Message, Conversation, Review, Favorite, Match,
                       TenantPassport, Listing):
            modele.query.delete()
        User.query.filter(User.email.like("%@tcheyna.test")).delete(synchronize_session=False)
        db.session.commit()

        # ─── Administrateur ─────────────────────────────────
        admin = User.query.filter_by(role="admin").first()
        if not admin:
            admin = creer_utilisateur(
                "admin@tcheyna.test", "Admin Tcheyna", "admin",
                "+224620000000", "Kaloum Centre",
                trust_level=4, phone_verified=True, cni_verified=True,
                income_verified=True,
            )
            db.session.add(admin)

        # ─── Locataires ─────────────────────────────────────
        print("👤 Locataires…")

        # Niveau 4 — dossier complet, plusieurs avis positifs
        aminata = creer_utilisateur(
            "aminata@tcheyna.test", "Aminata Diallo", "tenant",
            "+224622000001", "Ratoma",
            trust_level=3, phone_verified=True, cni_uploaded=True,
            cni_verified=True, income_verified=True,
            bio="Comptable dans une société de la place, je cherche un logement "
                "calme et sécurisé pour ma famille.",
        )

        # Niveau 2 — identité vérifiée, revenus en attente
        mamadou = creer_utilisateur(
            "mamadou.t@tcheyna.test", "Mamadou Camara", "tenant",
            "+224622000002", "Matam",
            trust_level=2, phone_verified=True, cni_uploaded=True, cni_verified=True,
            bio="Ingénieur télécom, célibataire, non fumeur.",
        )

        # Niveau 1 — vient de vérifier son téléphone
        fatoumata = creer_utilisateur(
            "fatoumata@tcheyna.test", "Fatoumata Bah", "tenant",
            "+224622000003", "Dixinn",
            trust_level=1, phone_verified=True,
            bio="Étudiante en master, budget serré mais dossier propre.",
        )

        # ─── Propriétaires ──────────────────────────────────
        print("🏠 Propriétaires…")
        ibrahima = creer_utilisateur(
            "ibrahima@tcheyna.test", "Ibrahima Sow", "landlord",
            "+224621000001", "Kipé",
            trust_level=2, phone_verified=True, cni_uploaded=True, cni_verified=True,
            bio="Propriétaire de plusieurs biens à Ratoma. Réponse sous 24 h.",
        )
        mariama = creer_utilisateur(
            "mariama@tcheyna.test", "Mariama Barry", "landlord",
            "+224621000002", "Kaloum Centre",
            trust_level=1, phone_verified=True,
            bio="Je loue l'appartement familial de Kaloum.",
        )

        db.session.add_all([aminata, mamadou, fatoumata, ibrahima, mariama])
        db.session.flush()

        # ─── Passeports locataires ──────────────────────────
        print("🛂 Passeports locataires…")
        p_aminata = TenantPassport(
            tenant_id=aminata.id,
            cni_recto_url="/uploads/demo_cni_recto.jpg",
            cni_verso_url="/uploads/demo_cni_verso.jpg",
            income_doc_url="/uploads/demo_revenus.pdf",
            docs_uploaded=True, income_verified=True,
            revenu_mensuel=4_500_000, devise="GNF",
            employeur="SOGUIPAH", situation_pro="salarié",
            a_un_garant=True, garant_nom="Sékou Diallo", garant_revenu=6_000_000,
            budget_min=1_500_000, budget_max=3_500_000,
            ville_souhaitee="Conakry",
            quartiers_souhaites="Ratoma,Kipé,Nongo,Taouyah",
            type_bien_souhaite="appartement", nb_pieces_min=3, nb_occupants=4,
            date_emmenagement=date.today() + timedelta(days=30),
        )
        p_mamadou = TenantPassport(
            tenant_id=mamadou.id,
            cni_recto_url="/uploads/demo_cni_recto.jpg",
            docs_uploaded=True,
            income_doc_url="/uploads/demo_revenus.pdf",
            revenu_mensuel=3_000_000, devise="GNF",
            employeur="Orange Guinée", situation_pro="salarié",
            budget_min=1_000_000, budget_max=2_000_000,
            ville_souhaitee="Conakry", quartiers_souhaites="Matam,Coléah,Madina",
            type_bien_souhaite="appartement", nb_pieces_min=2, nb_occupants=1,
            date_emmenagement=date.today() + timedelta(days=15),
        )
        p_fatoumata = TenantPassport(
            tenant_id=fatoumata.id,
            revenu_mensuel=1_200_000, devise="GNF", situation_pro="étudiant",
            a_un_garant=True, garant_nom="Alpha Bah", garant_revenu=3_500_000,
            budget_min=500_000, budget_max=1_200_000,
            ville_souhaitee="Conakry", quartiers_souhaites="Dixinn,Bellevue,Hafia",
            type_bien_souhaite="studio", nb_pieces_min=1, nb_occupants=1,
        )
        for passeport in (p_aminata, p_mamadou, p_fatoumata):
            passeport.calculate_score()
            db.session.add(passeport)

        # ─── Annonces ───────────────────────────────────────
        print("📋 Annonces…")
        maintenant = datetime.utcnow()

        annonces = [
            Listing(
                landlord_id=ibrahima.id,
                title_fr="Appartement 3 chambres avec groupe électrogène — Kipé",
                description_fr=(
                    "Bel appartement de 3 chambres au 2ᵉ étage d'un immeuble récent à Kipé. "
                    "Salon spacieux, cuisine équipée, deux salles d'eau. Groupe électrogène "
                    "de secours, forage avec château d'eau, gardien 24 h/24 et parking clos. "
                    "À 5 minutes de la route Le Prince."
                ),
                pays="Guinée", ville="Conakry", quartier="Kipé",
                adresse="Cité Kipé, immeuble Bhoye, 2ᵉ étage",
                type_bien="appartement", prix=2_800_000, charges=200_000,
                caution=5_600_000, devise="GNF",
                nb_pieces=4, superficie=110, etage=2, meuble=False,
                disponible_a_partir=date.today() + timedelta(days=15),
                has_generator=True, has_water=True, has_wifi=True,
                is_secured=True, has_parking=True, has_ac=True,
                certification_status="certified", certified_at=maintenant - timedelta(days=5),
                propriete_doc_url="/uploads/demo_titre_foncier.pdf",
                is_premium=True, premium_until=maintenant + timedelta(days=25),
                images_urls=",".join(PHOTOS["appartement"]),
                views_count=142,
            ),
            Listing(
                landlord_id=ibrahima.id,
                title_fr="Villa 4 chambres avec cour — Nongo",
                description_fr=(
                    "Villa individuelle sur une parcelle clôturée à Nongo. Quatre chambres "
                    "dont une suite parentale, grand séjour, cuisine séparée, cour permettant "
                    "de garer deux véhicules. Quartier calme et résidentiel."
                ),
                pays="Guinée", ville="Conakry", quartier="Nongo",
                adresse="Nongo, derrière la mosquée centrale",
                type_bien="villa", prix=5_000_000, charges=300_000,
                caution=10_000_000, devise="GNF",
                nb_pieces=6, superficie=220, etage=0, meuble=False,
                disponible_a_partir=date.today() + timedelta(days=45),
                has_generator=True, has_water=True, has_wifi=False,
                is_secured=True, has_parking=True, has_ac=True,
                certification_status="certified", certified_at=maintenant - timedelta(days=12),
                propriete_doc_url="/uploads/demo_titre_foncier.pdf",
                images_urls=",".join(PHOTOS["villa"]),
                views_count=87,
            ),
            Listing(
                landlord_id=mariama.id,
                title_fr="Appartement 2 chambres vue mer — Kaloum",
                description_fr=(
                    "Appartement lumineux au cœur de Kaloum, à deux pas des ministères et "
                    "du port. Deux chambres, séjour donnant sur un balcon avec vue mer, "
                    "cuisine américaine. Idéal pour un cadre travaillant en centre-ville."
                ),
                pays="Guinée", ville="Conakry", quartier="Kaloum Centre",
                adresse="Avenue de la République, immeuble Kaloum Plaza",
                type_bien="appartement", prix=3_500_000, charges=250_000,
                caution=7_000_000, devise="GNF",
                nb_pieces=3, superficie=85, etage=4, meuble=True,
                disponible_a_partir=date.today() + timedelta(days=7),
                has_generator=True, has_water=True, has_wifi=True,
                is_secured=True, has_parking=False, has_ac=True,
                certification_status="pending",
                certification_requested_at=maintenant - timedelta(days=2),
                propriete_doc_url="/uploads/demo_titre_foncier.pdf",
                images_urls=",".join(PHOTOS["appartement"]),
                views_count=63,
            ),
            Listing(
                landlord_id=mariama.id,
                title_fr="Studio meublé pour étudiant — Dixinn",
                description_fr=(
                    "Studio meublé de 32 m² proche de l'Université Gamal Abdel Nasser. "
                    "Lit, bureau, kitchenette et salle d'eau privative. Eau et électricité "
                    "incluses dans les charges. Parfait pour un étudiant ou un jeune actif."
                ),
                pays="Guinée", ville="Conakry", quartier="Dixinn",
                adresse="Dixinn Port, près de l'université",
                type_bien="studio", prix=900_000, charges=150_000,
                caution=1_800_000, devise="GNF",
                nb_pieces=1, superficie=32, etage=1, meuble=True,
                disponible_a_partir=date.today(),
                has_generator=False, has_water=True, has_wifi=True,
                is_secured=True, has_parking=False, has_ac=False,
                images_urls=",".join(PHOTOS["studio"]),
                views_count=201,
            ),
            Listing(
                landlord_id=ibrahima.id,
                title_fr="Maison 3 chambres à Matam",
                description_fr=(
                    "Maison de plain-pied à Matam, trois chambres, salon, cuisine et "
                    "terrasse. Quartier vivant, proche du marché et des transports."
                ),
                pays="Guinée", ville="Conakry", quartier="Matam",
                adresse="Matam Lido, rue 12",
                type_bien="maison", prix=1_800_000, charges=100_000,
                caution=3_600_000, devise="GNF",
                nb_pieces=4, superficie=95, etage=0, meuble=False,
                disponible_a_partir=date.today() + timedelta(days=20),
                has_generator=False, has_water=True, has_wifi=False,
                is_secured=False, has_parking=True, has_ac=False,
                images_urls=",".join(PHOTOS["maison"]),
                views_count=45,
            ),
        ]
        db.session.add_all(annonces)
        db.session.flush()

        # ─── Candidatures et mises en relation ──────────────
        print("🤝 Candidatures…")
        from app.services.matching import score_compatibilite

        candidature_acceptee = Match(
            tenant_id=aminata.id, listing_id=annonces[0].id, status="accepted",
            message="Bonjour, votre appartement correspond exactement à ma recherche. "
                    "Je suis disponible pour une visite dès cette semaine.",
            score_compatibilite=score_compatibilite(p_aminata, annonces[0], aminata)[0],
            visite_date=maintenant + timedelta(days=3),
        )
        candidature_attente = Match(
            tenant_id=mamadou.id, listing_id=annonces[2].id, status="pending",
            message="Bonjour, je travaille à Kaloum et cherche à me rapprocher du bureau. "
                    "Mon dossier est complet.",
            score_compatibilite=score_compatibilite(p_mamadou, annonces[2], mamadou)[0],
        )
        candidature_conclue = Match(
            tenant_id=fatoumata.id, listing_id=annonces[3].id, status="completed",
            message="Bonjour, le studio m'intéresse pour la rentrée universitaire.",
            score_compatibilite=score_compatibilite(p_fatoumata, annonces[3], fatoumata)[0],
            completed_at=maintenant - timedelta(days=20),
        )
        db.session.add_all([candidature_acceptee, candidature_attente, candidature_conclue])
        db.session.flush()

        # ─── Conversation ───────────────────────────────────
        print("💬 Messagerie…")
        conversation = Conversation(
            match_id=candidature_acceptee.id,
            tenant_id=aminata.id,
            landlord_id=ibrahima.id,
            last_message_at=maintenant - timedelta(hours=2),
        )
        db.session.add(conversation)
        db.session.flush()

        echanges = [
            (ibrahima.id, "Bonjour Madame Diallo, merci pour votre candidature. "
                          "Votre dossier est très complet.", 26),
            (aminata.id, "Bonjour Monsieur Sow, merci à vous. Quand puis-je visiter ?", 25),
            (ibrahima.id, "Samedi matin vers 10 h, cela vous convient ?", 24),
            (aminata.id, "Parfait, je note samedi 10 h. Le groupe électrogène "
                         "couvre-t-il tout l'appartement ?", 3),
            (ibrahima.id, "Oui, il alimente l'ensemble de l'appartement, "
                          "climatiseurs compris.", 2),
        ]
        for expediteur, contenu, heures in echanges:
            db.session.add(Message(
                conversation_id=conversation.id,
                sender_id=expediteur,
                contenu=contenu,
                created_at=maintenant - timedelta(hours=heures),
                read_at=maintenant - timedelta(hours=heures - 1) if heures > 3 else None,
            ))

        # ─── Avis croisés ───────────────────────────────────
        print("⭐ Avis…")
        db.session.add_all([
            Review(reviewer_id=fatoumata.id, target_id=mariama.id,
                   match_id=candidature_conclue.id, note=5,
                   commentaire="Propriétaire très réactive, le studio correspondait "
                               "exactement aux photos. Remise des clés sans souci.",
                   type_avis="tenant_to_landlord", is_positive=True),
            Review(reviewer_id=mariama.id, target_id=fatoumata.id,
                   match_id=candidature_conclue.id, note=5,
                   commentaire="Locataire sérieuse et ponctuelle. Je recommande.",
                   type_avis="landlord_to_tenant", is_positive=True),
        ])

        # ─── Favoris ────────────────────────────────────────
        db.session.add_all([
            Favorite(user_id=aminata.id, listing_id=annonces[1].id),
            Favorite(user_id=mamadou.id, listing_id=annonces[0].id),
        ])

        # ─── Notifications d'exemple ────────────────────────
        notify.nouvelle_candidature(mariama.id, mamadou.full_name,
                                    annonces[2].title_fr, candidature_attente.id)
        notify.candidature_traitee(aminata.id, True, annonces[0].title_fr,
                                   candidature_acceptee.id)

        db.session.commit()

        # Le niveau 4 se mérite : il découle des avis reçus.
        for locataire in (aminata, mamadou, fatoumata):
            locataire.update_trust_level()
        db.session.commit()

        print(f"""
✅ Base peuplée.

   Comptes de démonstration — mot de passe : {MDP}

   Administrateur   admin@tcheyna.test
   Locataire niv.3  aminata@tcheyna.test      (dossier complet, solvable)
   Locataire niv.2  mamadou.t@tcheyna.test    (identité vérifiée)
   Locataire niv.1  fatoumata@tcheyna.test    (téléphone vérifié)
   Propriétaire     ibrahima@tcheyna.test     (3 annonces, 2 certifiées)
   Propriétaire     mariama@tcheyna.test      (2 annonces, 1 en attente)

   {len(annonces)} annonces · 3 candidatures · 1 conversation · 2 avis

   Ces comptes sont réservés au développement local : leur mot de passe
   est publié dans le README.
""")


if __name__ == "__main__":
    seed()
