# Backlog Tcheyna

Source : le plan de complétion du 14/10/2026 (audit, plan, PRD rangés dans les fichiers du projet, sous `audit/`).
Ce fichier est **la file de travail des threads** : un thread prend la première tâche `prêt` dont le couloir est libre, dans l'ordre du tableau.
**Seul Kamano modifie ce fichier.** Un thread ne le modifie jamais : il signale dans sa PR la tâche terminée ou bloquée.

## Statuts

| Statut | Sens |
|---|---|
| `prêt` | Peut démarrer dès que son couloir et ses dépendances sont libres |
| `en PR` | Une PR brouillon existe ; ne pas reprendre |
| `bloqué Dx` | Attend la décision Dx de Kamano (liste en bas) |
| `après …` | Attend qu'une autre tâche soit mergée |
| `fait` | Mergé sur `main` |

Couloirs : voir [agents/LANES.md](agents/LANES.md).

## Phase 0 — Organisation

| Lot | Couloir | Tâche | Statut |
|---|---|---|---|
| 0.1 | — | D10 : un seul dépôt (monorepo `backend/` + `frontend/`) | **décidé par défaut**, à confirmer |
| 0.2 | L6 | Backlog, couloirs, règles multi-agents, `scripts/agent-setup.sh` | en PR (cette PR) |
| 0.3 | L6 | `docs/TCHEYNA_SPEC_TECHNIQUE.md` : machines à états du PRD §6 et contrat d'API | prêt |
| 0.4 | L6 | Subagent `pr-reviewer` dans `.claude/agents/` (remplace le gabarit `kamano.agent.md`) | prêt |

## Phase 1 — Sécurité, intégrité, conformité

Les PR sont empilées : les merger **dans cet ordre**. Avant le merge de #4, tamponner puis migrer la base de production (`flask db stamp d5a017c5d0f3`, puis `flask db upgrade` ; procédure dans `backend/migrations/README`).

| Ordre | Lot | Couloir | Tâche | Statut |
|---|---|---|---|---|
| 1 | 1.1 | L6 | Socle qualité : pytest, ruff, ESLint, CI, migration initiale | en PR #2 |
| 2 | 1.2 | socle | Validation des entrées | en PR #3 |
| 3 | 1.4 | L1 | Comptes : limitation de débit, OTP haché, révocation des jetons | en PR #4 |
| 4 | 1.6 | L2 | Accès au passeport, à l'adresse et aux fichiers | en PR #5 |
| 5 | 1.7 | L5 | Photos compressées, réseau tolérant | en PR #6 |
| 6 | 1.3 | L3 | Paiements fiables ; caution et loyer hors plateforme (D2 = A) | en PR #7 |
| 7 | 1.5 | L1 | Données personnelles : journal de vérification, purge des pièces (D5 = A) | en PR #8 |
| — | 1.8 | L5 | Reformuler `CGU.tsx` §6 : la caution et le loyer ne passent plus par Tcheyna (D2 = A) | après #7 |
| — | 1.9 | — | Inventaire des paiements caution / premier loyer restés `pending` en production, au déploiement de #7 | après #7 (Kamano) |

## Phase 2 — Logique métier

| Lot | Couloir | Tâche | Statut |
|---|---|---|---|
| 2.6 | L4 | Signalements : annonce, utilisateur, message ; file admin ; suspension | après phase 1 |
| 2.7 | L4 | Visites : date future, confirmation par l'autre partie, rappel la veille | après 2.6 |
| 2.8 | L4 | Messagerie bornée : écriture fermée après refus ou retrait, pagination, modèles de messages | après 2.7 |
| 2.1 | L1 | Bailleur vérifié : OTP et CNI avant publication, badge « Propriétaire vérifié » | bloqué D3 |
| 2.2 | L2 | Cycle de vie de l'annonce (actions publier, retirer, réactiver) ; re-soumission de certification | bloqué D4 |
| 2.3 | L2 | Expiration des annonces sans activité, relance à J-7 | bloqué D6 |
| 2.4 | L3 | Modèle de revenu sur la location ; CGU et `/payments/tarifs` alignés | bloqué D1 |
| 2.5 | L2 | Conclusion déclarée par une partie et confirmée par l'autre ; fenêtre d'avis ; plafond de candidatures | bloqué D7, D8 |
| 2.9 | L5 | Reçu déclaratif de remise de caution, signé par OTP par les deux parties (suite de D2 = A) | après 1.3 |

## Phase 3 — Expérience terrain

| Lot | Couloir | Tâche | Statut |
|---|---|---|---|
| 3.1 | L2 | Supprimer les N+1 de la recherche (41 requêtes pour 12 annonces) ; tri « match » et suggestions calculés en SQL sur l'ensemble filtré | après phase 1 |
| 3.2 | L2 | Compteur de vues dédoublonné, écrit hors de la lecture | après 3.1 |
| 3.3 | L5 | PWA : manifest, service worker, cache des annonces vues ; découpage du bundle par espace | après 1.7 |
| 3.4 | L5 | File d'envoi hors ligne (IndexedDB) pour messages et candidatures | après 3.3 |
| 3.5 | L5 | Vignettes et `srcset`, image de repli locale | après 3.3 |
| 3.6 | L6 | Journal d'événements et tableau des indicateurs du PRD §4 | après phase 1 |
| 3.7 | L4 | Notifications web push | après 2.8 |
| 3.8 | L1 | Connexion par téléphone, mot de passe oublié par OTP | après 1.5 |

## Phase 4 — Sur données terrain uniquement

Séquestre de caution, application Expo, interface anglaise, second marché, espace agence multi-utilisateurs. Aucune tâche `prêt` avant décision de Kamano.

## Décisions

| # | Décision | État |
|---|---|---|
| D1 | Modèle de revenu sur la location (frais fixes à l'acceptation, abonnement agence, ou 6 % maintenus) | **ouverte** |
| D2 | Caution et premier loyer via la plateforme | A : retirés (15/10/2026) |
| D3 | Niveau minimum d'un bailleur pour publier | ouverte |
| D4 | Re-soumission d'une certification refusée : gratuite, gratuite une fois, payante | ouverte |
| D5 | Conservation des pièces | A : supprimées dès la décision, 12 mois maximum sans décision (15/10/2026) |
| D6 | Durée de vie d'une annonce sans activité | ouverte |
| D7 | Plafond de candidatures actives par locataire | ouverte |
| D8 | Délai pour noter après conclusion | ouverte |
| D9 | Hébergement : plan Render payant ou ping de réveil | ouverte |
| D10 | Un dépôt ou trois | monorepo par défaut, à confirmer |
| D11 | Identité légale de l'éditeur (`frontend/src/lib/editeur.ts`) | ouverte |
| D12 | Durée de validité d'un justificatif de revenus | ouverte |
