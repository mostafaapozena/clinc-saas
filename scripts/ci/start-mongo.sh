#!/usr/bin/env bash
# Starts MongoDB as a single-node replica set for CI (transactions need a replica set).
# GitHub service containers cannot pass server arguments, so it runs via docker directly.
set -euo pipefail
IMAGE="${MONGO_IMAGE:-mongo:8.2.12}"

# Explicit open-file limit (MongoDB recommends 64000) instead of relying on the runner default.
docker run -d --name mongo --ulimit nofile=64000:64000 -p 27017:27017 "$IMAGE" --replSet rs0 --bind_ip_all >/dev/null

for _ in $(seq 1 60); do
  if docker exec mongo mongosh --quiet --eval "db.adminCommand('ping').ok" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec mongo mongosh --quiet --eval \
  "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] })" >/dev/null

for _ in $(seq 1 60); do
  if [ "$(docker exec mongo mongosh --quiet --eval 'db.hello().isWritablePrimary')" = "true" ]; then
    echo "MongoDB replica set ready: $(docker exec mongo mongod --version | head -1)"
    exit 0
  fi
  sleep 1
done

echo "MongoDB did not become a writable primary in time" >&2
docker logs mongo | tail -50 >&2
exit 1
