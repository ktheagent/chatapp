#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/apps/web"
RESULT="$WEB/e2ee-result.json"
PASSWORD='RelayCi-Only-Password-42!'

cd "$WEB"
npm install --no-audit --no-fund
npm run build

docker volume create relay-synapse-e2ee >/dev/null
docker run --rm \
  -v relay-synapse-e2ee:/data \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:v1.158.0 generate

docker run --rm \
  -v relay-synapse-e2ee:/data \
  alpine:3.22 \
  sh -c "printf '\nregistration_shared_secret: relay-ci-registration-secret\n' >> /data/homeserver.yaml"

docker run -d --name relay-synapse-e2ee-server \
  -v relay-synapse-e2ee:/data \
  -p 8008:8008 \
  matrixdotorg/synapse:v1.158.0 >/dev/null

cleanup() {
  if [[ -f /tmp/relay-vite.pid ]]; then kill "$(cat /tmp/relay-vite.pid)" 2>/dev/null || true; fi
  docker rm -f relay-synapse-e2ee-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

for attempt in {1..60}; do
  if curl --fail --silent http://127.0.0.1:8008/_matrix/client/versions >/dev/null; then break; fi
  if [[ "$attempt" == "60" ]]; then
    docker logs relay-synapse-e2ee-server
    exit 1
  fi
  sleep 1
done

docker exec relay-synapse-e2ee-server register_new_matrix_user \
  http://localhost:8008 -c /data/homeserver.yaml -u alice -p "$PASSWORD" --no-admin
docker exec relay-synapse-e2ee-server register_new_matrix_user \
  http://localhost:8008 -c /data/homeserver.yaml -u bob -p "$PASSWORD" --no-admin

npm run dev -- --host 127.0.0.1 --port 5173 >/tmp/relay-vite.log 2>&1 &
echo $! >/tmp/relay-vite.pid

for attempt in {1..45}; do
  if curl --fail --silent http://127.0.0.1:5173/e2ee-ci.html >/dev/null; then break; fi
  if [[ "$attempt" == "45" ]]; then cat /tmp/relay-vite.log; exit 1; fi
  sleep 1
done

set +e
MATRIX_BASE_URL=http://127.0.0.1:8008 \
MATRIX_TEST_PASSWORD="$PASSWORD" \
RELAY_E2EE_PAGE_URL=http://127.0.0.1:5173/e2ee-ci.html \
E2EE_RESULT_FILE="$RESULT" \
npm run test:e2ee-browser
status=$?
set -e

if [[ ! -f "$RESULT" ]]; then
  printf '%s\n' '{"ok":false,"stage":"browser-result-missing"}' >"$RESULT"
fi

mkdir -p "$ROOT/ci"
cp "$RESULT" "$ROOT/ci/e2ee-last-result.json"

python3 - "$ROOT/ci/e2ee-last-result.json" <<'PY'
import json, os, sys
from pathlib import Path
p = Path(sys.argv[1])
data = json.loads(p.read_text())
data["sourceCommit"] = os.getenv("GITHUB_SHA")
data["workflowRun"] = os.getenv("GITHUB_RUN_ID")
p.write_text(json.dumps(data, indent=2) + "\n")
PY

cat "$ROOT/ci/e2ee-last-result.json"

if [[ -n "${GITHUB_ACTIONS:-}" && "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
  cd "$ROOT"
  git config user.name relay-ci
  git config user.email relay-ci@users.noreply.github.com
  git add ci/e2ee-last-result.json
  if ! git diff --cached --quiet; then
    git commit -m "Record Matrix E2EE CI result [skip ci]"
    git push origin HEAD:main
  fi
fi

if [[ "$status" -ne 0 ]]; then
  echo "=== Vite log ==="
  tail -n 120 /tmp/relay-vite.log || true
  echo "=== Synapse log ==="
  docker logs --tail 180 relay-synapse-e2ee-server 2>&1 || true
fi

exit "$status"
