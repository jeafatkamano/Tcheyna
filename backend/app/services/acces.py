"""
services/acces.py — Matrice d'accès : qui voit quoi (lot 1.6).

Toutes les règles de visibilité des données sensibles vivent ici, et nulle
part ailleurs : le passeport d'un locataire, l'adresse exacte d'un bien, une
annonce retirée. Chaque route qui sert l'une de ces données appelle la règle
correspondante ; une route oubliée ne fuit pas, car les sérialisations
masquent par défaut (voir `Listing.to_dict`). Le droit de publier une
annonce (D3) y vit aussi : il conditionne l'accès aux dossiers des candidats.

Les ensembles de statuts sont des constantes nommées : élargir ou restreindre
un accès est une décision métier, qui se change ici et se lit dans le diff.
"""
from functools import wraps

from flask import jsonify

from app.models import Listing, Match

# ─── Passeport locataire ─────────────────────────────────────

# Statuts de candidature qui ouvrent au bailleur le passeport (vue publique)
# du candidat. `rejected` et `cancelled` en sont exclus : après un refus ou un
# retrait, le bailleur n'a plus de raison de consulter le dossier.
STATUTS_OUVRANT_PASSEPORT = ("pending", "accepted", "completed")

PASSEPORT_COMPLET = "complet"
PASSEPORT_PUBLIC = "public"

ROLES_BAILLEUR = ("landlord", "agency")


def peut_voir_passeport(viewer, tenant):
    """Niveau de lecture du passeport de `tenant` par `viewer`.

    Renvoie `"complet"` (le locataire lui-même, l'admin), `"public"` (un
    bailleur qui a reçu de ce locataire une candidature de statut
    `STATUTS_OUVRANT_PASSEPORT` sur l'une de SES annonces) ou `None`.

    Seule règle appliquée par toutes les routes qui servent un passeport :
    `/passport/<id>`, `/users/<id>`, `/matches/mes-demandes`,
    `/matches/<id>`. Les suggestions de candidats n'en servent aucun (voir
    `profil_suggestion`).
    """
    if viewer is None or tenant is None or not getattr(viewer, "is_active", True):
        return None
    if viewer.id == tenant.id or viewer.role == "admin":
        return PASSEPORT_COMPLET
    if viewer.role not in ROLES_BAILLEUR:
        return None

    lien = _candidatures_ouvrantes(viewer).filter(Match.tenant_id == tenant.id).first()
    return PASSEPORT_PUBLIC if lien else None


def _candidatures_ouvrantes(bailleur):
    """Candidatures reçues par `bailleur` sur ses annonces, dont le statut
    ouvre le passeport du candidat."""
    return (Match.query.join(Listing, Match.listing_id == Listing.id)
            .filter(Listing.landlord_id == bailleur.id,
                    Match.status.in_(STATUTS_OUVRANT_PASSEPORT)))


def locataires_ouverts(viewer):
    """Même règle que `peut_voir_passeport`, précalculée pour une liste :
    renvoie une fonction `locataire -> niveau | None` au prix d'une seule
    requête (identifiants distincts des candidats ouvrants du bailleur)."""
    if viewer is None or not getattr(viewer, "is_active", True):
        return lambda _locataire: None
    if viewer.role not in ROLES_BAILLEUR:
        return lambda locataire: peut_voir_passeport(viewer, locataire)

    ids = {tenant_id for (tenant_id,) in
           _candidatures_ouvrantes(viewer).with_entities(Match.tenant_id).distinct()}

    def regle(locataire):
        if locataire is None:
            return None
        if locataire.id == viewer.id:
            return PASSEPORT_COMPLET
        return PASSEPORT_PUBLIC if locataire.id in ids else None

    return regle


def passeport_pour(viewer, tenant, niveau=...):
    """Le passeport de `tenant` tel que `viewer` a le droit de le lire, ou
    `None` (aucun droit, ou pas de passeport).

    `niveau`, s'il est fourni, vient de `locataires_ouverts` : il évite une
    requête par locataire dans une liste."""
    if tenant is None or tenant.passport is None:
        return None
    if niveau is ...:
        niveau = peut_voir_passeport(viewer, tenant)
    if niveau is None:
        return None
    return tenant.passport.to_dict(public=niveau != PASSEPORT_COMPLET)


# ─── Suggestions de candidats (version réduite) ──────────────

def nom_reduit(full_name):
    """« Mariama Diallo » → « Mariama D. » : assez pour reconnaître un
    dossier, pas assez pour retrouver la personne hors de Tcheyna."""
    morceaux = (full_name or "").split()
    if not morceaux:
        return "Locataire"
    if len(morceaux) == 1:
        return morceaux[0]
    return f"{morceaux[0]} {morceaux[-1][0].upper()}."


def profil_suggestion(locataire, score, details, abonne):
    """Ce qu'un bailleur voit d'un locataire qui ne lui a PAS candidaté.

    Version réduite (PRD §5.3) : prénom et initiale, niveau de confiance,
    score de compatibilité et son explication. Ni budget, ni situation
    professionnelle, ni employeur, ni quartiers, ni pièces, ni photo : le
    locataire n'a rien demandé à ce bailleur. Le dossier s'ouvre s'il
    candidate. Champs à ajuster ici, et nulle part ailleurs.
    """
    return {
        "tenant": {
            "id":          locataire.id,
            "role":        "tenant",
            "full_name":   nom_reduit(locataire.full_name),
            "trust_level": locataire.trust_level or 0,
        },
        "score_compatibilite":   score,
        "details_compatibilite": details,
        "abonne_passeport":      abonne,
    }


# ─── Adresse exacte d'une annonce ────────────────────────────

# Statuts de candidature qui donnent au locataire l'adresse exacte du bien.
# C'est le statut COURANT qui compte : une candidature acceptée puis refusée
# ou retirée perd l'adresse.
STATUTS_OUVRANT_ADRESSE = ("accepted", "completed")


def adresse_ouverte_par_candidature(candidature):
    """La candidature `candidature` donne-t-elle au locataire l'adresse du bien ?

    POINT D'EXTENSION D1 (PRD §8.1 option B, lot 2.4) : si le déblocage de
    l'adresse est lié au paiement des frais d'acceptation, c'est ici, et
    seulement ici, qu'il faut ajouter la condition « frais payés ». Toutes
    les sorties de l'adresse vers un locataire passent par cette fonction.
    """
    return candidature is not None and candidature.status in STATUTS_OUVRANT_ADRESSE


def visibilite_adresse(viewer):
    """Prépare la règle d'accès à l'adresse pour `viewer`.

    Renvoie une fonction `annonce -> bool`. Les candidatures du viewer sont
    lues une fois : une liste de N annonces ne coûte pas N requêtes.
    Ont l'adresse : le propriétaire de l'annonce, l'admin, et le locataire
    dont la candidature l'ouvre (`adresse_ouverte_par_candidature`).
    """
    if viewer is None or not getattr(viewer, "is_active", True):
        return lambda _annonce: False
    if viewer.role == "admin":
        return lambda _annonce: True

    ouvertes = set()
    if viewer.role == "tenant":
        ouvertes = {m.listing_id for m in viewer.matches
                    if adresse_ouverte_par_candidature(m)}

    def regle(annonce):
        return annonce.landlord_id == viewer.id or annonce.id in ouvertes

    return regle


def peut_voir_adresse(viewer, annonce, candidature=None):
    """Règle d'accès à l'adresse pour une seule annonce.

    `candidature`, si elle est fournie et appartient au viewer, évite de la
    relire en base (sérialisation d'une candidature, d'une conversation).
    """
    if viewer is None or annonce is None:
        return False
    if candidature is not None and candidature.tenant_id == viewer.id \
            and candidature.listing_id == annonce.id:
        return (annonce.landlord_id == viewer.id
                or adresse_ouverte_par_candidature(candidature))
    return visibilite_adresse(viewer)(annonce)


# ─── Annonce retirée ─────────────────────────────────────────

def peut_voir_annonce(viewer, annonce):
    """Une annonce visible se lit par tous. Une annonce retirée
    (`is_visible=False`) ne se lit plus que par son propriétaire, l'admin et
    les locataires qui y ont candidaté (quel que soit le statut : ils
    gardent l'historique de leur candidature, sans l'adresse)."""
    if annonce.is_visible:
        return True
    if viewer is None:
        return False
    if viewer.role == "admin" or viewer.id == annonce.landlord_id:
        return True
    return Match.query.filter_by(tenant_id=viewer.id,
                                 listing_id=annonce.id).first() is not None


# ─── Publication d'une annonce (D3, lot 2.1) ─────────────────

# Décision D3 (20/10/2026) : un bailleur ou une agence ne publie qu'avec un
# téléphone vérifié par OTP. Sans ce verrou, un compte créé à l'instant
# publie une annonce appât et reçoit l'identité et le passeport public des
# candidats (`peut_voir_passeport`). La CNI validée n'est PAS exigée : elle
# donne le badge « Propriétaire vérifié » (`User.proprietaire_verifie`).
CODE_TELEPHONE_NON_VERIFIE = "telephone_non_verifie"
MESSAGE_TELEPHONE_NON_VERIFIE = "Vérifiez votre numéro de téléphone pour publier une annonce."


def peut_publier_annonce(bailleur):
    """`bailleur` peut-il rendre une annonce visible ? Seul `phone_verified`
    compte, que seul un code OTP reçu pose (POST /auth/verify-otp)."""
    return (bailleur is not None and getattr(bailleur, "is_active", True)
            and bailleur.role in ROLES_BAILLEUR and bool(bailleur.phone_verified))


def publication_autorisee(fn):
    """Décorateur de toute route qui rend une annonce visible (aujourd'hui la
    seule création, POST /listings : aucune route ne remet en ligne une
    annonce retirée). Toute future route de remise en ligne le porte aussi.

    À placer SOUS `@role_required` et AU-DESSUS de `@valider_corps` : le refus
    passe avant la validation du corps, le formulaire n'ayant rien à corriger.
    403 au format uniforme, avec un `code` stable que le client lit pour
    proposer la vérification du téléphone.
    """
    @wraps(fn)
    def wrapper(*args, current_user, **kwargs):
        if not peut_publier_annonce(current_user):
            return jsonify({
                "error": MESSAGE_TELEPHONE_NON_VERIFIE,
                "details": [{"champ": "__root__", "code": CODE_TELEPHONE_NON_VERIFIE,
                             "message": MESSAGE_TELEPHONE_NON_VERIFIE}],
            }), 403
        return fn(*args, current_user=current_user, **kwargs)
    return wrapper
