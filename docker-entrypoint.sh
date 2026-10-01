#!/bin/sh
set -e
# Volumes mounted by Docker/Dokploy are often root-owned on first use.
# When started as root, make the data directory writable for the "node"
# user and drop privileges; otherwise run as whoever we already are.
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
