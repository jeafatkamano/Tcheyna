"""
services/acces.py — Matrice d'accès : qui voit quoi (lot 1.6).

Toutes les règles de visibilité des données sensibles vivent ici, et nulle
part ailleurs : le passeport d'un locataire, l'adresse exacte d'un bien, une
annonce retirée. Chaque route qui sert l'une de ces données appelle la règle
correspondante ; une route oubliée ne fuit pas, car les sérialisations
masquent par défaut (voir `Listing.to_dict`).

Les ensembles de statuts sont des constantes nommées : élargir ou restreindre
un accès est une décision métier, qui se change ici et se lit dans le diff.
"""
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

    lien = (Match.query.join(Listing, Match.listing_id == Listing.id)
            .filter(Match.tenant_id == tenant.id,
                    Listing.landlord_id == viewer.id,
                    Match.status.in_(STATUTS_OUVRANT_PASSEPORT))
            .first())
    return PASSEPORT_PUBLIC if lien else None


def passeport_pour(viewer, tenant):
    """Le passeport de `tenant` tel que `viewer` a le droit de le lire, ou
    `None` (aucun droit, ou pas de passeport)."""
    if tenant is None or tenant.passport is None:
        return None
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
