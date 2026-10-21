"""schemas/messages.py — Messagerie."""
from pydantic import BaseModel, ConfigDict

from app.schemas import BaseCorps, Entier, Texte

LONGUEUR_MAX = 2000

# Pagination du fil (lot 2.8) : nombre de messages par page.
LIMITE_MESSAGES_DEFAUT = 30
LIMITE_MESSAGES_MAX = 100

# Pagination de la liste des conversations : mêmes noms et même borne haute
# que la recherche d'annonces (`page`, `per_page` ≤ 50).
CONVERSATIONS_PAR_PAGE_DEFAUT = 20
CONVERSATIONS_PAR_PAGE_MAX = 50


class NouveauMessage(BaseCorps):
    contenu: Texte(LONGUEUR_MAX, 1)


class _Parametres(BaseModel):
    # Paramètres d'URL : un paramètre inconnu est ignoré, et non refusé comme
    # dans un corps. Un client (ou un proxy) peut en ajouter pour contourner
    # un cache ; seuls ceux que la route lit sont validés.
    model_config = ConfigDict(extra="ignore")


class PageMessages(_Parametres):
    """`?limite=30&avant=<id>` : les `limite` messages qui précèdent le
    message `avant` (les plus récents si `avant` est absent)."""
    limite: Entier(1, LIMITE_MESSAGES_MAX) | None = None
    avant: Texte(36, 1) | None = None


class PageConversations(_Parametres):
    page: Entier(1) | None = None
    per_page: Entier(1, CONVERSATIONS_PAR_PAGE_MAX) | None = None
