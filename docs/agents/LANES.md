# Couloirs de travail

Deux threads ne travaillent **jamais** dans le même couloir en même temps. Le socle partagé n'est touché que par un thread à la fois, et une seule migration Alembic est ouverte à la fois.

| Couloir | Périmètre |
|---|---|
| L1 Confiance | `backend/app/routes/auth.py`, `passport.py`, `users.py`, vérifications de `admin.py` |
| L2 Annonces et matching | `backend/app/routes/listings.py`, `matches.py`, `favorites.py`, `reviews.py`, `services/matching.py` |
| L3 Paiements | `backend/app/routes/payments.py` |
| L4 Messagerie et notifications | `backend/app/routes/messages.py`, `notifications.py`, `services/notifications.py` |
| L5 Web | `frontend/src/pages/**`, `frontend/src/components/**`, `frontend/src/hooks/**` |
| L6 Infra et qualité | `.github/`, `render.yaml`, `scripts/`, `docs/` (hors `BACKLOG.md`), tests transverses |

## Socle partagé (un seul thread à la fois)

- `backend/app/models.py`, `backend/migrations/`
- `backend/app/__init__.py`, `backend/config.py`
- `backend/requirements*.txt`, `frontend/package.json`, `frontend/package-lock.json`
- `frontend/src/api/` (`client.ts`, `index.ts`, `types.ts`, `schema.gen.ts`)
- Contrat d'API : `backend/app/schemas/reponses.py`, `backend/app/openapi.py`, `backend/openapi.json`

Un lot dont le couloir est libre mais qui doit toucher le socle attend que le socle soit libre.

## Changement d'API

Un lot qui modifie l'API ouvre d'abord la PR backend (changement additif et spec à jour : contrat dans `backend/app/schemas/reponses.py`, puis `flask api spec` dans `backend/` et `npm run api:types` dans `frontend/`, la CI refuse une spec ou des types en retard). La PR web suit, avec « Dépend de #n » dans sa description, et ne démarre pas tant que la PR backend n'est pas mergée.
