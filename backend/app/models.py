"""
models.py — Modèles de données Tcheyna

Le socle du produit est le système de confiance à deux faces décrit dans le
business plan :
  • Passeport Locataire — 4 niveaux de confiance croissants (User.trust_level)
  • Annonce Certifiée   — vérification des documents de propriété (Listing)

Marché initial : Conakry (Guinée). Extension prévue : Sénégal, Côte d'Ivoire,
Ghana, Nigeria — d'où les champs `pays` / `devise` sur les entités monétaires.
"""
import uuid
from collections import namedtuple
from datetime import datetime, timedelta

from app import db


def generate_uuid():
    return str(uuid.uuid4())


# ─────────────────────────────────────────────────────────────
# NIVEAUX DE CONFIANCE — Passeport Locataire (business plan §4)
# ─────────────────────────────────────────────────────────────

TRUST_LEVELS = {
    0: {
        "label": "Non vérifié",
        "critere": "Compte créé",
        "debloque": "Consultation des annonces",
    },
    1: {
        "label": "Basique",
        "critere": "Numéro vérifié par SMS (OTP)",
        "debloque": "Accès à la recherche et à la messagerie",
    },
    2: {
        "label": "Identifié",
        "critere": "Pièce d'identité (CNI) validée",
        "debloque": "Candidature aux annonces certifiées",
    },
    3: {
        "label": "Solvable",
        "critere": "Justificatifs de revenus validés",
        "debloque": "Mise en avant auprès des propriétaires",
    },
    4: {
        "label": "Recommandé",
        "critere": "Historique locatif et avis d'anciens bailleurs",
        "debloque": "Badge « Locataire de confiance »",
    },
}

# Niveau 4 « Recommandé » : avis positifs d'auteurs DISTINCTS (lot 1.15). Trois
# locations conclues avec la même personne ne valent qu'un avis : sinon un seul
# bailleur complaisant, avec trois annonces, suffirait à fabriquer le badge.
AUTEURS_POSITIFS_NIVEAU_4 = 3

# ─────────────────────────────────────────────────────────────
# USER — Locataire, propriétaire, agence ou admin
# ─────────────────────────────────────────────────────────────

class User(db.Model):
    __tablename__ = "users"

    id            = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    email         = db.Column(db.String(120), unique=True, nullable=False, index=True)
    phone         = db.Column(db.String(20),  unique=True, nullable=True, index=True)
    password_hash = db.Column(db.String(256), nullable=False)

    # Identité
    full_name     = db.Column(db.String(100), nullable=False)
    role          = db.Column(db.String(20),  nullable=False, index=True)  # tenant | landlord | agency | admin
    avatar_url    = db.Column(db.String(300), nullable=True)
    bio           = db.Column(db.Text, nullable=True)

    # Localisation
    pays          = db.Column(db.String(50),  nullable=True)
    ville         = db.Column(db.String(50),  nullable=True)
    quartier      = db.Column(db.String(100), nullable=True)

    preferred_lang = db.Column(db.String(5), default="fr")  # fr | en

    # ─── Système de confiance ───────────────────────────────
    trust_level     = db.Column(db.Integer, default=0, index=True)
    phone_verified  = db.Column(db.Boolean, default=False)
    cni_uploaded    = db.Column(db.Boolean, default=False)
    cni_verified    = db.Column(db.Boolean, default=False)
    income_verified = db.Column(db.Boolean, default=False)

    is_active     = db.Column(db.Boolean, default=True)
    last_login_at = db.Column(db.DateTime, nullable=True)
    # Version des jetons JWT du compte (claim `tv`). L'incrémenter révoque
    # tous les jetons déjà émis : changement de mot de passe, désactivation.
    # `server_default` : les comptes existants prennent 0 à la migration,
    # comme les jetons émis avant elle, qui n'ont pas de claim.
    token_version = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    # Renseignée quand le compte a été supprimé à la demande de son titulaire
    # (données anonymisées, voir services/donnees_personnelles.py). Distingue
    # une suppression, définitive, d'une simple désactivation.
    supprime_le   = db.Column(db.DateTime, nullable=True)

    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relations
    listings         = db.relationship("Listing", back_populates="landlord", lazy="dynamic")
    matches          = db.relationship("Match", back_populates="tenant", lazy="dynamic")
    passport         = db.relationship("TenantPassport", back_populates="tenant", uselist=False)
    favorites        = db.relationship("Favorite", back_populates="user", lazy="dynamic",
                                       cascade="all, delete-orphan")
    notifications    = db.relationship("Notification", back_populates="user", lazy="dynamic",
                                       cascade="all, delete-orphan")
    reviews_given    = db.relationship("Review", foreign_keys="Review.reviewer_id",
                                       back_populates="reviewer", lazy="dynamic")
    reviews_received = db.relationship("Review", foreign_keys="Review.target_id",
                                       back_populates="target", lazy="dynamic")

    # ─── Confiance ──────────────────────────────────────────

    @property
    def badge(self):
        return TRUST_LEVELS[self.trust_level or 0]["label"]

    @property
    def proprietaire_verifie(self):
        """Badge « Propriétaire vérifié » (D3, lot 2.1) : bailleur ou agence
        dont la pièce d'identité a été validée par un administrateur.

        Calculé, jamais stocké ni lu dans une requête : il suit `cni_verified`,
        que seule la décision admin (PUT /admin/verify-cni) met à vrai. Il ne
        conditionne pas la publication, qui exige le téléphone vérifié
        (`services.acces.peut_publier_annonce`)."""
        return self.role in ("landlord", "agency") and bool(self.cni_verified)

    def update_trust_level(self):
        """Recalcule le niveau à partir des vérifications acquises.

        Les niveaux sont cumulatifs : on ne peut pas être « Solvable » sans
        avoir d'abord une identité vérifiée.
        """
        level = 0
        if self.phone_verified:
            level = 1
        if level == 1 and self.cni_verified:
            level = 2
        if level == 2 and self.income_verified:
            level = 3
        if level == 3 and self.nb_auteurs_positifs() >= AUTEURS_POSITIFS_NIVEAU_4:
            level = 4
        self.trust_level = level
        return level

    def nb_auteurs_positifs(self):
        """Nombre d'auteurs DISTINCTS d'au moins un avis positif reçu."""
        return (db.session.query(db.func.count(db.distinct(Review.reviewer_id)))
                .filter(Review.target_id == self.id, Review.is_positive.is_(True))
                .scalar()) or 0

    @property
    def note_moyenne(self):
        return moyenne_des_notes(notes_par_auteur([self.id]).get(self.id, []))

    def revoquer_jetons(self):
        """Invalide tous les jetons déjà émis pour ce compte (tous appareils).

        Incrément en SQL (`token_version + 1`) et non en Python : deux
        révocations simultanées ne peuvent pas se neutraliser. La nouvelle
        valeur est relue de la base au premier accès après le commit.
        """
        self.token_version = type(self).token_version + 1

    def to_dict(self, public=True, avis=None):
        """`avis` : couple (nombre d'avis reçus, note moyenne) déjà lu par
        l'appelant (voir `agregats_annonces`). Sans lui, une requête.

        `nb_avis` compte les AVIS (chacun est une location conclue, et la
        liste les montre tous) ; `note_moyenne` donne une voix par AUTEUR
        (voir `moyenne_par_auteur`)."""
        if avis is None:
            groupes = notes_par_auteur([self.id]).get(self.id, [])
            nb_avis, note_moyenne = sum(n for n, _ in groupes), moyenne_des_notes(groupes)
        else:
            nb_avis, note_moyenne = avis
        data = {
            "id":             self.id,
            "full_name":      self.full_name,
            "role":           self.role,
            "pays":           self.pays,
            "ville":          self.ville,
            "quartier":       self.quartier,
            "bio":            self.bio,
            "trust_level":    self.trust_level or 0,
            "badge":          self.badge,
            "phone_verified": self.phone_verified,
            "cni_verified":   self.cni_verified,
            "income_verified": self.income_verified,
            "proprietaire_verifie": self.proprietaire_verifie,
            "avatar_url":     self.avatar_url,
            "preferred_lang": self.preferred_lang,
            "note_moyenne":   note_moyenne,
            "nb_avis":        nb_avis,
            "created_at":     self.created_at.isoformat() if self.created_at else None,
        }
        if not public:
            data["email"]        = self.email
            data["phone"]        = self.phone
            data["cni_uploaded"] = self.cni_uploaded
            data["is_active"]    = self.is_active
        return data

    def __repr__(self):
        return f"<User {self.full_name} [{self.role}] — Niveau {self.trust_level}>"


def moyenne_par_auteur(groupes):
    """Note moyenne où chaque auteur pèse UNE voix (lot 1.15), non arrondie,
    `None` sans avis. Seule formule de la note d'un utilisateur.

    `groupes` : un couple (nombre d'avis, somme de leurs notes) par auteur
    (voir `notes_par_auteur`). On prend la moyenne de chaque auteur, puis la
    moyenne de ces moyennes : un auteur qui a noté la même personne après
    trois locations ne pèse pas trois fois, et ses trois notes comptent
    toutes. Avec un avis par auteur, c'est exactement l'ancienne moyenne des
    avis. Moyennes triées avant la somme : le résultat ne dépend pas de
    l'ordre de lecture des lignes, au dernier bit près.
    """
    moyennes = sorted(somme / nombre for nombre, somme in groupes if nombre)
    return sum(moyennes) / len(moyennes) if moyennes else None


def moyenne_des_notes(groupes):
    """`moyenne_par_auteur` arrondie au dixième (champ `note_moyenne`)."""
    moyenne = moyenne_par_auteur(groupes)
    return round(moyenne, 1) if moyenne is not None else None


def notes_par_auteur(cible_ids):
    """{id de cible: [(nombre d'avis, somme des notes), un couple par auteur]}
    pour les utilisateurs de `cible_ids`, en UNE requête groupée. Une cible
    sans avis est absente du résultat."""
    ids = {cible_id for cible_id in cible_ids if cible_id}
    if not ids:
        return {}
    lignes = (db.session.query(Review.target_id, db.func.count(Review.id),
                               db.func.sum(Review.note))
              .filter(Review.target_id.in_(ids))
              .group_by(Review.target_id, Review.reviewer_id))
    groupes = {}
    for cible_id, nombre, somme in lignes:
        # int() : SUM d'un INTEGER est un BIGINT, voire un NUMERIC, selon le moteur.
        groupes.setdefault(cible_id, []).append((int(nombre), int(somme)))
    return groupes


# ─────────────────────────────────────────────────────────────
# OTP — Vérification téléphone (Africa's Talking)
# ─────────────────────────────────────────────────────────────

class OTPCode(db.Model):
    __tablename__ = "otp_codes"

    id         = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id    = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    # OBSOLÈTE : le code en clair n'est plus écrit (lot 1.4). La colonne reste
    # le temps du déploiement, l'ancien code y écrivant encore ; elle sera
    # vidée puis supprimée par une révision ultérieure.
    code       = db.Column(db.String(6),  nullable=True)
    # HMAC-SHA256 du code (hexadécimal) : une fuite de la base seule ne livre
    # aucun code, la clé vit hors base (OTP_HMAC_KEY ou SECRET_KEY).
    code_hash  = db.Column(db.String(64), nullable=True)
    # Numéro auquel le code a été envoyé : le quota quotidien de SMS se compte
    # par numéro, tous comptes confondus.
    phone      = db.Column(db.String(20), nullable=True, index=True)
    is_used    = db.Column(db.Boolean, default=False)
    attempts   = db.Column(db.Integer, default=0)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship("User")


# ─────────────────────────────────────────────────────────────
# LISTING — Annonce immobilière (et sa certification)
# ─────────────────────────────────────────────────────────────

CERTIFICATION_STATUSES = ("none", "pending", "certified", "rejected")

# Un propriétaire ne cherche pas toujours un locataire : il peut vouloir vendre.
TYPES_TRANSACTION = ("location", "vente")

# Types de biens. `terrain` et `hangar` n'ont ni pièces, ni étage, ni meubles :
# les traiter comme un appartement produirait des annonces absurdes.
TYPES_BIEN = ("appartement", "maison", "studio", "chambre", "villa", "hangar", "terrain")
TYPES_BIEN_SANS_PIECES = ("terrain", "hangar")


class Listing(db.Model):
    __tablename__ = "listings"

    id          = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    landlord_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    # Contenu bilingue
    title_fr       = db.Column(db.String(200), nullable=False)
    title_en       = db.Column(db.String(200), nullable=True)
    description_fr = db.Column(db.Text, nullable=False)
    description_en = db.Column(db.Text, nullable=True)

    # Localisation
    pays     = db.Column(db.String(50),  nullable=False, index=True)
    ville    = db.Column(db.String(50),  nullable=False, index=True)
    quartier = db.Column(db.String(100), nullable=True, index=True)
    adresse  = db.Column(db.String(300), nullable=True)

    # Caractéristiques
    # location : `prix` est un loyer mensuel. vente : `prix` est le prix de cession.
    type_transaction = db.Column(db.String(20), default="location", nullable=False, index=True)
    type_bien   = db.Column(db.String(30), nullable=False, index=True)
    # BIGINT : un prix de vente dépasse vite 2^31 GNF (≈ 250 000 $), plafond
    # d'un INTEGER sur PostgreSQL. Révision 3b8e2c41f7a9.
    prix        = db.Column(db.BigInteger, nullable=False, index=True)
    charges     = db.Column(db.Integer, default=0)                      # location seulement
    caution     = db.Column(db.Integer, nullable=True)                  # dépôt de garantie, location seulement
    devise      = db.Column(db.String(10), nullable=False)              # GNF | XOF | GHS | NGN
    nb_pieces   = db.Column(db.Integer, nullable=True)  # None pour un terrain, un hangar
    superficie  = db.Column(db.Float, nullable=True)                    # m²
    etage       = db.Column(db.Integer, nullable=True)
    meuble      = db.Column(db.Boolean, default=False)
    disponible_a_partir = db.Column(db.Date, nullable=True)

    # Équipements pertinents en Afrique de l'Ouest
    has_generator = db.Column(db.Boolean, default=False)  # Groupe électrogène
    has_water     = db.Column(db.Boolean, default=False)  # Eau courante
    has_wifi      = db.Column(db.Boolean, default=False)
    is_secured    = db.Column(db.Boolean, default=False)  # Gardien / clôture
    has_parking   = db.Column(db.Boolean, default=False)
    has_ac        = db.Column(db.Boolean, default=False)

    # ─── Annonce Certifiée (business plan §4) ───────────────
    certification_status = db.Column(db.String(20), default="none", index=True)
    certification_requested_at = db.Column(db.DateTime, nullable=True)
    certified_at   = db.Column(db.DateTime, nullable=True)
    certification_note = db.Column(db.Text, nullable=True)   # motif de refus / remarque admin
    # Pièces administratives : titre foncier, bail, quittance… Plusieurs
    # documents sont souvent nécessaires pour établir la propriété d'un bien.
    documents_urls = db.Column(db.Text, nullable=True)  # URLs séparées par des virgules

    # ─── Mise en avant (annonce premium) ────────────────────
    is_premium    = db.Column(db.Boolean, default=False)
    premium_until = db.Column(db.DateTime, nullable=True)

    # Statut
    status     = db.Column(db.String(20), default="active", index=True)  # active | matched | closed
    is_visible = db.Column(db.Boolean, default=True)
    views_count = db.Column(db.Integer, default=0)

    images_urls = db.Column(db.Text, nullable=True)  # URLs séparées par des virgules

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    landlord  = db.relationship("User", back_populates="listings")
    matches   = db.relationship("Match", back_populates="listing", lazy="dynamic")
    favorites = db.relationship("Favorite", back_populates="listing", lazy="dynamic",
                                cascade="all, delete-orphan")

    @property
    def documents(self):
        return [u for u in (self.documents_urls or "").split(",") if u]

    @property
    def is_certified(self):
        return self.certification_status == "certified"

    @property
    def premium_actif(self):
        return bool(self.is_premium and self.premium_until
                    and self.premium_until > datetime.utcnow())

    @property
    def est_vente(self):
        return self.type_transaction == "vente"

    @property
    def sans_pieces(self):
        """Un terrain ou un hangar ne se décrit pas en nombre de pièces."""
        return self.type_bien in TYPES_BIEN_SANS_PIECES

    @property
    def cout_entree(self):
        """Somme à débourser à l'entrée : premier loyer + charges + caution.

        Pour une vente, il n'y a pas de coût d'entrée au sens locatif : le prix
        annoncé est le prix du bien.
        """
        if self.est_vente:
            return self.prix or 0
        return (self.prix or 0) + (self.charges or 0) + (self.caution or 0)

    def to_dict(self, lang="fr", include_landlord=True, avec_adresse=False, agregats=None):
        """Sérialise l'annonce.

        L'adresse exacte est MASQUÉE par défaut : seul un appelant qui a
        vérifié le droit du lecteur (`services.acces.peut_voir_adresse` ou
        `visibilite_adresse`) passe `avec_adresse=True`. Un appelant oublié
        ne fuit donc pas l'adresse. Quartier et ville restent publics.

        `agregats` (un `AgregatsAnnonce`, voir `agregats_annonces`) : compteurs
        déjà lus pour toute une liste. Sans eux, l'annonce les relit, au prix
        de trois requêtes : acceptable pour une annonce, pas pour une page.
        """
        masquee = bool(self.adresse) and not avec_adresse
        data = {
            "id":          self.id,
            "title":       self.title_fr if lang == "fr" else (self.title_en or self.title_fr),
            "description": self.description_fr if lang == "fr" else (self.description_en or self.description_fr),
            "pays":        self.pays,
            "ville":       self.ville,
            "quartier":    self.quartier,
            "adresse":     self.adresse if avec_adresse else None,
            "adresse_masquee": masquee,
            "type_transaction": self.type_transaction or "location",
            "est_vente":   self.est_vente,
            "type_bien":   self.type_bien,
            "prix":        self.prix,
            "charges":     0 if self.est_vente else (self.charges or 0),
            "caution":     None if self.est_vente else self.caution,
            "cout_entree": self.cout_entree,
            "devise":      self.devise,
            "nb_pieces":   None if self.sans_pieces else self.nb_pieces,
            "superficie":  self.superficie,
            "etage":       self.etage,
            "meuble":      self.meuble,
            "disponible_a_partir": self.disponible_a_partir.isoformat() if self.disponible_a_partir else None,
            "equipements": {
                "generateur":    self.has_generator,
                "eau":           self.has_water,
                "wifi":          self.has_wifi,
                "securite":      self.is_secured,
                "parking":       self.has_parking,
                "climatisation": self.has_ac,
            },
            "certification_status": self.certification_status,
            "nb_documents": len(self.documents),
            "is_certified":  self.is_certified,
            "certified_at":  self.certified_at.isoformat() if self.certified_at else None,
            "is_premium":    self.premium_actif,
            "status":        self.status,
            "views_count":   self.views_count or 0,
            "nb_candidatures": (agregats.nb_candidatures if agregats
                                else self.matches.count()),
            "images":        self.images_urls.split(",") if self.images_urls else [],
            "created_at":    self.created_at.isoformat() if self.created_at else None,
        }
        if include_landlord:
            avis = (agregats.nb_avis_bailleur, agregats.note_moyenne_bailleur) if agregats else None
            data["landlord"] = self.landlord.to_dict(avis=avis) if self.landlord else None
        return data

    def __repr__(self):
        return f"<Listing {self.title_fr} — {self.ville}>"


# ─────────────────────────────────────────────────────────────
# MATCH — Mise en relation locataire ↔ annonce
# ─────────────────────────────────────────────────────────────

MATCH_STATUSES = ("pending", "accepted", "rejected", "completed", "cancelled")


class Match(db.Model):
    __tablename__ = "matches"
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "listing_id", name="uq_match_tenant_listing"),
    )

    id         = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    tenant_id  = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    listing_id = db.Column(db.String(36), db.ForeignKey("listings.id"), nullable=False, index=True)

    status  = db.Column(db.String(20), default="pending", index=True)
    message = db.Column(db.Text, nullable=True)   # message de candidature

    # Score de compatibilité au moment de la candidature (0–100)
    score_compatibilite = db.Column(db.Integer, nullable=True)

    visite_date  = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant       = db.relationship("User", back_populates="matches")
    listing      = db.relationship("Listing", back_populates="matches")
    conversation = db.relationship("Conversation", back_populates="match", uselist=False,
                                   cascade="all, delete-orphan")

    @property
    def commission(self):
        """Commission due sur cette candidature : toujours zéro.

        La commission de 6 % du premier loyer est remplacée par des frais
        fixes de mise en relation, payés à l'acceptation (décision D1,
        20/10/2026, `routes.payments`). Le champ reste servi pour les clients
        qui le lisent encore ; les commissions déjà payées se lisent dans
        les paiements.
        """
        return 0

    def to_dict(self, lang="fr", viewer=None):
        """`viewer` : l'utilisateur à qui la réponse est destinée. Il décide de
        l'adresse du bien (propriétaire, admin, ou candidature qui l'ouvre).
        Sans viewer, l'adresse est masquée : masquer par défaut."""
        from app.services.acces import peut_voir_adresse

        avec_adresse = (viewer is not None
                        and peut_voir_adresse(viewer, self.listing, candidature=self))
        return {
            "id":         self.id,
            "tenant":     self.tenant.to_dict() if self.tenant else None,
            "listing":    (self.listing.to_dict(lang=lang, avec_adresse=avec_adresse)
                           if self.listing else None),
            "status":     self.status,
            "message":    self.message,
            "score_compatibilite": self.score_compatibilite,
            "visite_date":  self.visite_date.isoformat() if self.visite_date else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "commission":   self.commission,
            "conversation_id": self.conversation.id if self.conversation else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Match {self.tenant_id} → {self.listing_id} [{self.status}]>"


# ─────────────────────────────────────────────────────────────
# TENANT PASSPORT — Dossier locataire vérifié + critères de recherche
# ─────────────────────────────────────────────────────────────

class TenantPassport(db.Model):
    __tablename__ = "tenant_passports"

    id        = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    tenant_id = db.Column(db.String(36), db.ForeignKey("users.id"), unique=True, nullable=False)

    # Documents
    cni_recto_url  = db.Column(db.String(300), nullable=True)
    cni_verso_url  = db.Column(db.String(300), nullable=True)
    passport_url   = db.Column(db.String(300), nullable=True)
    income_doc_url = db.Column(db.String(300), nullable=True)

    docs_uploaded   = db.Column(db.Boolean, default=False)
    income_verified = db.Column(db.Boolean, default=False)

    # Date du dernier dépôt de chaque catégorie de pièce : point de départ de
    # la durée de conservation d'une pièce restée sans décision (D5). Remise
    # à NULL quand la pièce est supprimée.
    identite_deposee_le = db.Column(db.DateTime, nullable=True)
    revenus_deposes_le  = db.Column(db.DateTime, nullable=True)

    # Situation professionnelle et financière
    revenu_mensuel = db.Column(db.Integer, nullable=True)
    devise         = db.Column(db.String(10), nullable=True)
    employeur      = db.Column(db.String(100), nullable=True)
    situation_pro  = db.Column(db.String(50), nullable=True)  # salarié | indépendant | étudiant | commerçant

    # Garant (rassure le propriétaire quand les revenus sont justes)
    a_un_garant     = db.Column(db.Boolean, default=False)
    garant_nom      = db.Column(db.String(100), nullable=True)
    garant_revenu   = db.Column(db.Integer, nullable=True)

    # ─── Critères de recherche (alimentent le matching) ─────
    budget_min          = db.Column(db.Integer, nullable=True)
    budget_max          = db.Column(db.Integer, nullable=True)
    ville_souhaitee     = db.Column(db.String(50), nullable=True)
    quartiers_souhaites = db.Column(db.Text, nullable=True)   # séparés par des virgules
    type_bien_souhaite  = db.Column(db.String(30), nullable=True)
    nb_pieces_min       = db.Column(db.Integer, nullable=True)
    date_emmenagement   = db.Column(db.Date, nullable=True)
    nb_occupants        = db.Column(db.Integer, default=1)

    score = db.Column(db.Integer, default=0)   # 0–100

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = db.relationship("User", back_populates="passport")

    @property
    def quartiers_list(self):
        return [q.strip() for q in (self.quartiers_souhaites or "").split(",") if q.strip()]

    def calculate_score(self):
        """Score du dossier sur 100 — ce que le propriétaire voit d'un coup d'œil."""
        score = 0
        if self.tenant and self.tenant.phone_verified:  score += 15
        # Une pièce validée est supprimée à la décision (lot 1.5) : le dépôt
        # reste compté grâce à `docs_uploaded` et `income_verified`.
        if self.cni_recto_url or self.passport_url or self.docs_uploaded:  score += 15
        if self.tenant and self.tenant.cni_verified:    score += 15
        if self.income_doc_url or self.income_verified: score += 10
        if self.income_verified:                        score += 15
        if self.revenu_mensuel:                         score += 10
        if self.situation_pro:                          score += 5
        if self.a_un_garant:                            score += 10
        if self.budget_max and self.ville_souhaitee:    score += 5
        self.score = min(score, 100)
        return self.score

    def to_dict(self, public=False):
        data = {
            "id":              self.id,
            "tenant_id":       self.tenant_id,
            "docs_uploaded":   self.docs_uploaded,
            "income_verified": self.income_verified,
            "score":           self.score,
            "situation_pro":   self.situation_pro,
            "a_un_garant":     self.a_un_garant,
            "budget_min":      self.budget_min,
            "budget_max":      self.budget_max,
            "ville_souhaitee": self.ville_souhaitee,
            "quartiers_souhaites": self.quartiers_list,
            "type_bien_souhaite":  self.type_bien_souhaite,
            "nb_pieces_min":   self.nb_pieces_min,
            "nb_occupants":    self.nb_occupants,
            "date_emmenagement": self.date_emmenagement.isoformat() if self.date_emmenagement else None,
            "created_at":      self.created_at.isoformat() if self.created_at else None,
        }
        if not public:
            # Données financières : visibles par le locataire et l'admin uniquement
            data.update({
                "revenu_mensuel": self.revenu_mensuel,
                "devise":         self.devise,
                "employeur":      self.employeur,
                "garant_nom":     self.garant_nom,
                "garant_revenu":  self.garant_revenu,
                "documents": {
                    "cni_recto": bool(self.cni_recto_url),
                    "cni_verso": bool(self.cni_verso_url),
                    "passport":  bool(self.passport_url),
                    "income":    bool(self.income_doc_url),
                },
            })
        return data


# ─────────────────────────────────────────────────────────────
# CONVERSATION & MESSAGE — Messagerie intégrée
# ─────────────────────────────────────────────────────────────

class Conversation(db.Model):
    __tablename__ = "conversations"

    id          = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    match_id    = db.Column(db.String(36), db.ForeignKey("matches.id"), unique=True, nullable=False)
    tenant_id   = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    landlord_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    last_message_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)

    match    = db.relationship("Match", back_populates="conversation")
    tenant   = db.relationship("User", foreign_keys=[tenant_id])
    landlord = db.relationship("User", foreign_keys=[landlord_id])
    messages = db.relationship("Message", back_populates="conversation", lazy="dynamic",
                               cascade="all, delete-orphan",
                               order_by="Message.created_at")

    def autre_participant(self, user_id):
        return self.landlord if user_id == self.tenant_id else self.tenant

    def nb_non_lus(self, user_id):
        return self.messages.filter(Message.sender_id != user_id,
                                    Message.read_at.is_(None)).count()

    def to_dict(self, user_id=None, lang="fr"):
        from app.services.acces import adresse_ouverte_par_candidature

        dernier = self.messages.order_by(Message.created_at.desc()).first()
        # L'adresse suit le statut COURANT de la candidature : une conversation
        # qui survit à un refus ou à un retrait ne la montre plus au locataire.
        avec_adresse = bool(user_id) and (
            user_id == self.landlord_id or adresse_ouverte_par_candidature(self.match)
        )
        data = {
            "id":         self.id,
            "match_id":   self.match_id,
            "listing":    self.match.listing.to_dict(lang=lang, include_landlord=False,
                                                     avec_adresse=avec_adresse)
                          if self.match and self.match.listing else None,
            "dernier_message": dernier.to_dict() if dernier else None,
            "last_message_at": self.last_message_at.isoformat() if self.last_message_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if user_id:
            autre = self.autre_participant(user_id)
            data["interlocuteur"] = autre.to_dict() if autre else None
            data["nb_non_lus"]    = self.nb_non_lus(user_id)
        return data


class Message(db.Model):
    __tablename__ = "messages"

    id              = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    conversation_id = db.Column(db.String(36), db.ForeignKey("conversations.id"),
                                nullable=False, index=True)
    sender_id       = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)

    contenu    = db.Column(db.Text, nullable=False)
    read_at    = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    conversation = db.relationship("Conversation", back_populates="messages")
    sender       = db.relationship("User")

    def to_dict(self):
        return {
            "id":         self.id,
            "sender_id":  self.sender_id,
            "contenu":    self.contenu,
            "lu":         self.read_at is not None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ─────────────────────────────────────────────────────────────
# FAVORITE — Annonces sauvegardées par un locataire
# ─────────────────────────────────────────────────────────────

class Favorite(db.Model):
    __tablename__ = "favorites"
    __table_args__ = (
        db.UniqueConstraint("user_id", "listing_id", name="uq_favorite_user_listing"),
    )

    id         = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id    = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    listing_id = db.Column(db.String(36), db.ForeignKey("listings.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user    = db.relationship("User", back_populates="favorites")
    listing = db.relationship("Listing", back_populates="favorites")


# ─────────────────────────────────────────────────────────────
# NOTIFICATION — Alertes in-app
# ─────────────────────────────────────────────────────────────

class Notification(db.Model):
    __tablename__ = "notifications"

    id      = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    type    = db.Column(db.String(40), nullable=False)
    # nouvelle_candidature | candidature_acceptee | candidature_refusee | nouveau_message
    # annonce_certifiee | annonce_refusee | paiement_recu | nouvel_avis | niveau_confiance

    titre   = db.Column(db.String(150), nullable=False)
    contenu = db.Column(db.Text, nullable=True)
    lien    = db.Column(db.String(200), nullable=True)   # route frontend à ouvrir

    read_at    = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship("User", back_populates="notifications")

    def to_dict(self):
        return {
            "id":         self.id,
            "type":       self.type,
            "titre":      self.titre,
            "contenu":    self.contenu,
            "lien":       self.lien,
            "lu":         self.read_at is not None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ─────────────────────────────────────────────────────────────
# REVIEW — Avis croisés après une location
# ─────────────────────────────────────────────────────────────

class Review(db.Model):
    __tablename__ = "reviews"
    __table_args__ = (
        db.UniqueConstraint("reviewer_id", "match_id", name="uq_review_reviewer_match"),
    )

    id          = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    reviewer_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    target_id   = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    match_id    = db.Column(db.String(36), db.ForeignKey("matches.id"), nullable=True)

    note        = db.Column(db.Integer, nullable=False)   # 1 à 5
    commentaire = db.Column(db.Text, nullable=True)
    type_avis   = db.Column(db.String(20), nullable=False)  # tenant_to_landlord | landlord_to_tenant
    is_positive = db.Column(db.Boolean, default=False)      # note >= 4

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    reviewer = db.relationship("User", foreign_keys=[reviewer_id], back_populates="reviews_given")
    target   = db.relationship("User", foreign_keys=[target_id], back_populates="reviews_received")

    def to_dict(self):
        """Vue publique de l'avis, la seule servie (avis d'un utilisateur,
        profil public, avis publié) : l'auteur passe par `auteur_public`."""
        return {
            "id":          self.id,
            "reviewer":    auteur_public(self.reviewer) if self.reviewer else None,
            "target_id":   self.target_id,
            "note":        self.note,
            "commentaire": self.commentaire,
            "type_avis":   self.type_avis,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }


# Champs d'identité d'un locataire auteur d'avis, publiés à `null` : les clés
# restent (même forme que `User.to_dict`), les valeurs non. Mêmes champs que
# `CHAMPS_IDENTITE_LOCATAIRE` du profil public (routes/users.py).
CHAMPS_IDENTITE_AUTEUR = ("avatar_url", "bio", "quartier")


def auteur_public(auteur):
    """L'auteur d'un avis tel que le voit n'importe quel lecteur (lot 1.15).

    Un locataire est réduit à « Prénom I. » (`services.acces.nom_reduit`),
    sans photo, bio ni quartier : un avis public ne doit pas suffire à le
    retrouver hors de Tcheyna. Un bailleur ou une agence reste en clair,
    comme sur son profil public et sur chacune de ses annonces. Un compte
    supprimé garde son nom anonymisé (« Compte supprimé ») tel quel.
    """
    from app.services.acces import nom_reduit

    data = auteur.to_dict(public=True)
    if auteur.role == "tenant":
        if not auteur.supprime_le:
            data["full_name"] = nom_reduit(auteur.full_name)
        for champ in CHAMPS_IDENTITE_AUTEUR:
            data[champ] = None
    return data


# ─────────────────────────────────────────────────────────────
# PAYMENT — Mobile Money via CinetPay
# ─────────────────────────────────────────────────────────────

PAYMENT_TYPES = {
    "caution":              "Dépôt de garantie",
    "premier_loyer":        "Premier loyer",
    # Plus initiable depuis D1 : conservée pour relire les paiements passés.
    "commission":           "Commission de mise en relation (ancien barème, 6 %)",
    "frais_mise_en_relation": "Frais de mise en relation",
    "certification":        "Certification d'annonce",
    "abonnement_passeport": "Abonnement Passeport Locataire",
    "mise_en_avant":        "Mise en avant d'annonce",
}


class Payment(db.Model):
    __tablename__ = "payments"

    id       = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id  = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    match_id = db.Column(db.String(36), db.ForeignKey("matches.id"), nullable=True, index=True)
    listing_id = db.Column(db.String(36), db.ForeignKey("listings.id"), nullable=True)

    reference     = db.Column(db.String(30), unique=True, nullable=False, index=True)  # n° de reçu
    type_paiement = db.Column(db.String(30), nullable=False)
    description   = db.Column(db.String(200), nullable=True)

    montant    = db.Column(db.Integer, nullable=False)
    commission = db.Column(db.Integer, default=0)   # part Tcheyna, à titre informatif
    devise     = db.Column(db.String(10), nullable=False)
    methode    = db.Column(db.String(30), nullable=True)  # orange_money | mtn_momo | wave | moov

    cinetpay_transaction_id = db.Column(db.String(100), nullable=True, index=True)
    cinetpay_token          = db.Column(db.String(200), nullable=True)
    cinetpay_operator_id    = db.Column(db.String(100), nullable=True)

    # pending | success | failed | a_rembourser | rembourse
    statut     = db.Column(db.String(20), default="pending", index=True)
    paid_at    = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user    = db.relationship("User")
    match   = db.relationship("Match")
    listing = db.relationship("Listing")

    def to_dict(self):
        return {
            "id":            self.id,
            "reference":     self.reference,
            "type_paiement": self.type_paiement,
            "type_label":    PAYMENT_TYPES.get(self.type_paiement, self.type_paiement),
            "description":   self.description,
            "montant":       self.montant,
            "commission":    self.commission or 0,
            "devise":        self.devise,
            "methode":       self.methode,
            "statut":        self.statut,
            "match_id":      self.match_id,
            "paid_at":       self.paid_at.isoformat() if self.paid_at else None,
            "created_at":    self.created_at.isoformat() if self.created_at else None,
        }


# ─────────────────────────────────────────────────────────────
# ABONNEMENT PASSEPORT — Un an de mise en avant du dossier
# ─────────────────────────────────────────────────────────────

DUREE_ABONNEMENT_PASSEPORT = timedelta(days=365)


def abonnements_passeport(user_ids):
    """Fin d'abonnement de chaque locataire dont l'abonnement court encore.

    Retourne {user_id: datetime}. L'abonnement n'a pas de colonne propre : il
    se lit dans les paiements réussis, qui restent la seule source de vérité.
    Un nouvel abonnement est refusé tant que le précédent court, si bien que
    le dernier paiement suffit à dater la fin.
    """
    if not user_ids:
        return {}
    depuis = datetime.utcnow() - DUREE_ABONNEMENT_PASSEPORT
    lignes = (db.session.query(Payment.user_id, db.func.max(Payment.paid_at))
              .filter(Payment.user_id.in_(user_ids),
                      Payment.type_paiement == "abonnement_passeport",
                      Payment.statut == "success",
                      Payment.paid_at > depuis)
              .group_by(Payment.user_id)
              .all())
    return {user_id: paye_le + DUREE_ABONNEMENT_PASSEPORT for user_id, paye_le in lignes}


# ─────────────────────────────────────────────────────────────
# VÉRIFICATION — Journal des décisions du back-office
# ─────────────────────────────────────────────────────────────

# objet : ce sur quoi porte la décision.
OBJETS_VERIFICATION = ("identite", "revenus", "certification_annonce", "statut_compte")
# decision : approuvee | refusee ; classee (demande sans pièce retirée de la
# file) ; purgee (pièce supprimée faute de décision dans le délai) ;
# activation | desactivation (statut d'un compte).
DECISIONS_VERIFICATION = ("approuvee", "refusee", "classee", "purgee", "activation", "desactivation")


class Verification(db.Model):
    """Une ligne par décision : qui a décidé quoi, sur qui, quand et pourquoi.

    Les pièces étant supprimées à la décision, ce journal est la seule trace
    qui permette de répondre à « qui a validé cette identité ? ». Il ne
    contient aucune donnée de la pièce elle-même.
    """
    __tablename__ = "verifications"

    id        = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    # NULL : traitement automatique (purge), sans décideur humain.
    acteur_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True, index=True)
    # Utilisateur ou annonce selon `objet` : pas de clé étrangère commune.
    cible_id  = db.Column(db.String(36), nullable=False, index=True)
    objet     = db.Column(db.String(30), nullable=False)
    decision  = db.Column(db.String(20), nullable=False)
    motif     = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    acteur = db.relationship("User")

    def to_dict(self):
        return {
            "id":        self.id,
            "acteur_id": self.acteur_id,
            "cible_id":  self.cible_id,
            "objet":     self.objet,
            "decision":  self.decision,
            "motif":     self.motif,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ─────────────────────────────────────────────────────────────
# FICHIER À SUPPRIMER — Suppressions de stockage en attente
# ─────────────────────────────────────────────────────────────

class FichierASupprimer(db.Model):
    """Fichier dont la référence a quitté la base mais qui doit encore
    disparaître du stockage.

    La ligne est écrite dans la même transaction que l'effacement de la
    référence, puis retirée une fois le fichier supprimé. Une panne de
    Supabase ou un arrêt du processus entre les deux laisse donc une trace
    qu'une reprise (`flask donnees retenter-suppressions`) traite, au lieu
    d'un fichier orphelin que plus rien ne désigne.
    """
    __tablename__ = "fichiers_a_supprimer"

    id         = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    reference  = db.Column(db.String(300), nullable=False)
    origine    = db.Column(db.String(40), nullable=False)  # decision_identite, suppression_compte…
    tentatives = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    derniere_tentative = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ─────────────────────────────────────────────────────────────
# AGRÉGATS D'UNE LISTE D'ANNONCES (lot 3.1)
# ─────────────────────────────────────────────────────────────

AgregatsAnnonce = namedtuple(
    "AgregatsAnnonce", "nb_candidatures nb_avis_bailleur note_moyenne_bailleur")


def agregats_annonces(annonces):
    """Compteurs de `Listing.to_dict` pour toute une liste, en DEUX requêtes.

    Pour chaque annonce : nombre de candidatures (tous statuts, comme
    `matches.count()` ; sous-requête corrélée, la base ne compte que pour
    les annonces demandées), puis nombre d'avis reçus par son bailleur et
    note moyenne, lus par `notes_par_auteur` pour tous les bailleurs de la
    liste à la fois et calculés comme dans `User.to_dict`.

    Renvoie {id d'annonce: AgregatsAnnonce}.
    """
    ids = [annonce.id for annonce in annonces]
    if not ids:
        return {}

    candidatures = dict(db.session.query(
        Listing.id,
        db.select(db.func.count(Match.id))
          .where(Match.listing_id == Listing.id).scalar_subquery(),
    ).filter(Listing.id.in_(ids)).all())
    notes = notes_par_auteur(annonce.landlord_id for annonce in annonces)

    agregats = {}
    for annonce in annonces:
        groupes = notes.get(annonce.landlord_id, [])
        agregats[annonce.id] = AgregatsAnnonce(candidatures.get(annonce.id, 0),
                                               sum(n for n, _ in groupes),
                                               moyenne_des_notes(groupes))
    return agregats
