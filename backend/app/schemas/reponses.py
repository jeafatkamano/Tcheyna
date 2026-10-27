"""
app/schemas/reponses.py — Contrat des réponses de l'API (lot 3.10).

Chaque modèle décrit exactement ce que renvoie un `to_dict()` de app/models.py.
Ces modèles ne transforment rien à l'exécution : ils alimentent la
spécification OpenAPI (`backend/openapi.json`), d'où le frontend génère ses
types TypeScript.

Ils sont stricts (`extra="forbid"`, `strict=True`) parce qu'ils servent aussi
de test : pendant la suite de tests, chaque `to_dict()` appelé est validé
contre son modèle (tests/conftest.py). Un champ ajouté, retiré ou retypé
dans un `to_dict()` sans mise à jour de ce fichier fait donc échouer les
tests, au lieu de casser silencieusement le frontend.

Convention des champs facultatifs (absents de certaines réponses) :
  • `champ: T = None`        : absent, ou présent avec une valeur T (jamais null) ;
  • `champ: T | None = None` : absent, ou présent et éventuellement null.
Le défaut `None` n'est pas validé : seul compte le type d'une valeur présente.
Les enrichissements que certaines routes ajoutent après `to_dict()`
(`is_favorite`, `score_compatibilite`…) figurent dans le contrat mais ne
sont pas vérifiés par ce mécanisme.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import models as m

Role = Literal["tenant", "landlord", "agency", "admin"]
StatutAnnonce = Literal["active", "matched", "closed"]
StatutCertification = Literal[*m.CERTIFICATION_STATUSES]
TypeTransaction = Literal[*m.TYPES_TRANSACTION]
StatutMatch = Literal[*m.MATCH_STATUSES]
TypeAvis = Literal["tenant_to_landlord", "landlord_to_tenant"]
TypePaiement = Literal[*m.PAYMENT_TYPES]
StatutPaiement = Literal["pending", "success", "failed", "a_rembourser", "rembourse"]


class Contrat(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


# ─── Utilisateurs ────────────────────────────────────────────

class Niveau(Contrat):
    label: str
    critere: str
    debloque: str


class User(Contrat):
    """`User.to_dict()` : profil public."""
    id: str
    full_name: str
    role: Role
    pays: str | None
    ville: str | None
    quartier: str | None
    bio: str | None
    trust_level: int
    badge: str
    phone_verified: bool
    cni_verified: bool
    income_verified: bool
    # Badge « Propriétaire vérifié » (lot 2.1) : bailleur ou agence dont la
    # pièce d'identité a été validée.
    proprietaire_verifie: bool
    avatar_url: str | None
    preferred_lang: Literal["fr", "en"]
    note_moyenne: float | None
    nb_avis: int
    created_at: str | None


class UserPrive(User):
    """`User.to_dict(public=False)` : le titulaire du compte ou un admin."""
    email: str
    phone: str | None
    cni_uploaded: bool
    is_active: bool


# ─── Annonces ────────────────────────────────────────────────

class Equipements(Contrat):
    generateur: bool
    eau: bool
    wifi: bool
    securite: bool
    parking: bool
    climatisation: bool


class DetailCompatibilite(Contrat):
    critere: str
    points: int
    max: int
    libelle: str


class MaCandidature(Contrat):
    id: str
    status: StatutMatch


class CertificationResoumission(Contrat):
    """Ce qu'une nouvelle demande de certification coûterait (D4, lot 2.2)."""
    nb_refus: int
    nb_paiements: int
    paiement_requis: bool
    resoumission_gratuite: bool


class Listing(Contrat):
    """`Listing.to_dict()`. `landlord` n'est présent qu'avec
    `include_landlord=True` (défaut)."""
    id: str
    title: str
    description: str
    pays: str
    ville: str
    quartier: str | None
    adresse: str | None
    adresse_masquee: bool
    type_transaction: TypeTransaction
    est_vente: bool
    type_bien: str
    prix: int
    charges: int
    caution: int | None
    cout_entree: int
    devise: str
    nb_pieces: int | None
    superficie: float | None
    etage: int | None
    meuble: bool
    disponible_a_partir: str | None
    equipements: Equipements
    certification_status: StatutCertification
    nb_documents: int
    is_certified: bool
    certified_at: str | None
    is_premium: bool
    status: StatutAnnonce
    views_count: int
    nb_candidatures: int
    images: list[str]
    created_at: str | None
    landlord: User | None = None
    # Enrichissements ajoutés par les routes selon le lecteur.
    is_favorite: bool = None
    is_owner: bool = None
    score_compatibilite: int = None
    details_compatibilite: list[DetailCompatibilite] = None
    ma_candidature: MaCandidature | None = None
    ajoute_le: str = None
    # Propriétaire seulement (lot 2.2) : annonce retirée, et coût d'une
    # nouvelle demande de certification.
    retiree: bool = None
    certification_resoumission: CertificationResoumission = None


# ─── Passeport locataire ─────────────────────────────────────

class DocumentsPasseport(Contrat):
    cni_recto: bool
    cni_verso: bool
    passport: bool
    income: bool


class TenantPassport(Contrat):
    """`TenantPassport.to_dict(public=True)` : vue d'un bailleur autorisé."""
    id: str
    tenant_id: str
    docs_uploaded: bool
    income_verified: bool
    score: int
    situation_pro: str | None
    a_un_garant: bool
    budget_min: int | None
    budget_max: int | None
    ville_souhaitee: str | None
    quartiers_souhaites: list[str]
    type_bien_souhaite: str | None
    nb_pieces_min: int | None
    nb_occupants: int | None
    date_emmenagement: str | None
    created_at: str | None


class TenantPassportPrive(TenantPassport):
    """`TenantPassport.to_dict()` : le locataire lui-même ou un admin."""
    revenu_mensuel: int | None
    devise: str | None
    employeur: str | None
    garant_nom: str | None
    garant_revenu: int | None
    documents: DocumentsPasseport


# ─── Mises en relation et messagerie ─────────────────────────

class Match(Contrat):
    id: str
    tenant: User | None
    listing: Listing | None
    status: StatutMatch
    message: str | None
    score_compatibilite: int | None
    visite_date: str | None
    completed_at: str | None
    commission: int
    conversation_id: str | None
    created_at: str | None


class Message(Contrat):
    id: str
    sender_id: str
    contenu: str
    lu: bool
    created_at: str | None


MotifFermeture = Literal["candidature_refusee", "candidature_retiree", "candidature_close"]


class PaginationMessages(Contrat):
    """Fil demandé par page (`limite`, `avant`), lot 2.8."""
    limite: int
    plus_anciens: bool
    # Valeur à passer en `avant` pour la page plus ancienne ; null à la fin.
    curseur: str | None


class Conversation(Contrat):
    """`interlocuteur` et `nb_non_lus` : seulement quand la conversation est
    lue par l'un de ses participants (`to_dict(user_id=…)`). Messagerie
    bornée (lot 2.8) : `ecriture_fermee`, `motif_fermeture`, et, pour un fil
    demandé par page, `messages` et `pagination`."""
    id: str
    match_id: str
    listing: Listing | None
    dernier_message: Message | None
    last_message_at: str | None
    created_at: str | None
    interlocuteur: User | None = None
    nb_non_lus: int = None
    ecriture_fermee: bool = None
    motif_fermeture: MotifFermeture | None = None
    messages: list[Message] = None
    pagination: PaginationMessages = None


class Notification(Contrat):
    id: str
    type: str
    titre: str
    contenu: str | None
    lien: str | None
    lu: bool
    created_at: str | None


class Review(Contrat):
    id: str
    reviewer: User | None
    target_id: str
    note: int
    commentaire: str | None
    type_avis: TypeAvis
    created_at: str | None


# ─── Paiements ────────────────────────────────

class Payment(Contrat):
    id: str
    reference: str
    type_paiement: TypePaiement
    type_label: str
    description: str | None
    montant: int
    commission: int
    devise: str
    methode: str | None
    statut: StatutPaiement
    match_id: str | None
    paid_at: str | None
    created_at: str | None


# ─── Erreurs ─────────────────────────────────────────────────

class DetailErreur(Contrat):
    champ: str
    code: str
    message: str


class PaiementAttendu(Contrat):
    """Paiement à faire pour que la demande aboutisse (402 des frais de mise
    en relation, D1)."""
    type_paiement: TypePaiement
    match_id: str
    montant: int
    devise: str


class Erreur(Contrat):
    """Corps de toute réponse d'erreur. `details` : liste des erreurs par
    champ (sur un 422 ; vide ou absente ailleurs). Champs propres à certaines
    réponses :
      • `reessayer_dans` (429) : secondes avant de réessayer ;
      • `action_requise` (402, 403) : ce que l'utilisateur doit faire
        (`payer_frais_mise_en_relation`, `verifier_telephone`,
        `verifier_identite`) ; `paiement` : le paiement attendu ;
      • `paiement_requis` et `certification_resoumission` (402 d'une demande
        de certification, lot 2.2) ;
      • `code` et `plafond` (409, plafond de candidatures actives, D7)."""
    error: str
    details: list[DetailErreur] = None
    reessayer_dans: int = None
    action_requise: str = None
    paiement: PaiementAttendu = None
    paiement_requis: str = None
    certification_resoumission: CertificationResoumission = None
    code: str = None
    plafond: int = None


# Modèle de chaque `to_dict()`, selon ses arguments. Sert à la spécification
# et à la validation des `to_dict()` pendant les tests.
def modele_de(objet, kwargs) -> type[Contrat] | None:
    """Le modèle qui décrit `objet.to_dict(**kwargs)`, ou None s'il n'en a pas."""
    if isinstance(objet, m.User):
        return User if kwargs.get("public", True) else UserPrive
    if isinstance(objet, m.TenantPassport):
        return TenantPassport if kwargs.get("public", False) else TenantPassportPrive
    return MODELES_PAR_CLASSE.get(type(objet))


MODELES_PAR_CLASSE: dict[type, type[Contrat]] = {
    m.Listing: Listing,
    m.Match: Match,
    m.Conversation: Conversation,
    m.Message: Message,
    m.Notification: Notification,
    m.Review: Review,
    m.Payment: Payment,
}

# Composants publiés dans la spécification, dans cet ordre.
COMPOSANTS: tuple[type[Contrat], ...] = (
    Niveau, User, UserPrive, Equipements, DetailCompatibilite, MaCandidature,
    CertificationResoumission, Listing, DocumentsPasseport, TenantPassport,
    TenantPassportPrive, Match, Message, PaginationMessages, Conversation,
    Notification, Review, Payment, DetailErreur, PaiementAttendu, Erreur,
)
