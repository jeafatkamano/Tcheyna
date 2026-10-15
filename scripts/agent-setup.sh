#!/usr/bin/env bash
# agent-setup.sh — Prépare un poste (ou un conteneur d'agent) pour travailler
# sur Tcheyna : dépendances du backend dans backend/.venv, du frontend via
# npm ci. Sans clé ni service externe : les tests mockent Supabase, CinetPay
# et Africa's Talking.
#
# Usage : bash scripts/agent-setup.sh [backend|frontend]   (défaut : les deux)
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CIBLE="${1:-tout}"

preparer_backend() {
  echo "── backend"
  cd "$RACINE/backend"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
  # Outils de test et de lint, quand le dépôt les déclare.
  if [[ -f requirements-dev.txt ]]; then
    .venv/bin/pip install --quiet -r requirements-dev.txt
  fi
  [[ -f .env ]] || cp .env.example .env
}

preparer_frontend() {
  echo "── frontend"
  cd "$RACINE/frontend"
  npm ci --no-audit --no-fund
}

case "$CIBLE" in
  backend)  preparer_backend ;;
  frontend) preparer_frontend ;;
  tout)     preparer_backend; preparer_frontend ;;
  *) echo "Usage : $0 [backend|frontend]" >&2; exit 2 ;;
esac

echo "✅ Prêt."
