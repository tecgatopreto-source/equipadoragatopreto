#!/bin/sh
set -e

VOLUME_DB="/data/gatopreto.db"
SEED_PATH="./db_seed/gatopreto.db"
LINK_PATH="./db/gatopreto.db"

mkdir -p /data
mkdir -p /data/uploads
export UPLOAD_DIR=/data/uploads

if [ ! -f "$VOLUME_DB" ]; then
  echo "DB not found — copying seed to volume..."
  cp "$SEED_PATH" "$VOLUME_DB"
  echo "Seed copied."
else
  echo "DB already exists on volume."
fi

# Symlink volume DB into the path schema.js expects
ln -sf "$VOLUME_DB" "$LINK_PATH"
echo "Symlink created: $LINK_PATH -> $VOLUME_DB"

exec node server.js
