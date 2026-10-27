# Règles multi-agents

À lire par chaque thread avant toute tâche.

## Avant de commencer

1. Lire `docs/BACKLOG.md`, `docs/agents/LANES.md` et la section de `docs/TCHEYNA_SPEC_TECHNIQUE.md` qui concerne la tâche (quand ce fichier existe).
2. Prendre la première tâche `prêt` du backlog dont le couloir et les dépendances sont libres.
3. Lancer `bash scripts/agent-setup.sh`.

## Pendant

- Une tâche = une branche depuis `main` = une PR brouillon titrée `[Lx] Lot n.m — …`.
- Ne jamais pousser sur `main`, ne jamais merger, ne jamais modifier `docs/BACKLOG.md`.
- Aucune clé ni donnée réelle : Supabase, CinetPay, Africa's Talking et Expo sont mockés dans les tests. Pas de déploiement Render, pas de `eas build`.
- Une règle métier manquante (prix, frais, fonctionnalité payante, durée de conservation) ne s'invente pas : la poser comme question dans la PR et s'arrêter sur ce point.
- `render.yaml` n'est pas appliqué automatiquement (services Render créés sans Blueprint) : toute PR qui le modifie donne dans son corps l'action manuelle équivalente dans le tableau de bord Render (chemin du réglage, valeur exacte à copier, vérification). Voir `docs/RUNBOOK_PHASE1.md`, section 12.

## Avant de dire « terminé »

- Tests, lint, typecheck et build passent dans chaque partie modifiée (`backend/`, `frontend/`).
- Relecture par le subagent `pr-reviewer` ; toute remarque « À CORRIGER » ou « BLOQUANT » est corrigée.
- Le dernier message résume la tâche, la PR et les vérifications.
