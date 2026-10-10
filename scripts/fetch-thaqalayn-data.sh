#!/usr/bin/env bash
# Fetch the CC0 ThaqalaynData dump (the dataset that drives thaqalayn.net /
# thaqalayn.com) into vendor/ThaqalaynData — the input for build:corpus.
# Only the books/ subtree is checked out; the rest of the repo is not needed.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-vendor/ThaqalaynData}"
if [ -d "$DEST/.git" ]; then
  echo "→ updating $DEST"
  git -C "$DEST" pull --ff-only
else
  mkdir -p "$(dirname "$DEST")"
  git clone --filter=blob:none --no-checkout --single-branch --branch master \
    https://github.com/narmafraz/ThaqalaynData.git "$DEST"
  git -C "$DEST" sparse-checkout init --cone
  git -C "$DEST" sparse-checkout set books
  git -C "$DEST" checkout master
fi
echo "✓ $DEST/books ready — now run:  THAQALAYN_DATA=$DEST/books npm run build:corpus"
