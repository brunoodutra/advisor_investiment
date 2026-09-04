#!/usr/bin/env bash
# Idempotent dependency setup for the advisor_investiment Cloud Agent environment.
# System packages belong in the base image/snapshot; this only refreshes the
# Python virtualenv and project dependencies after the repo is checked out.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Ensure the stdlib venv builder is available (snapshot usually already has it).
if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq python3-venv || true
  fi
fi

# Create the virtualenv only if it does not already exist.
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install \
  -r backend/requirements.docker.txt \
  -r backend/Trade_Bot/requirements.txt

echo "install.sh: dependencies ready in $REPO_ROOT/.venv"
