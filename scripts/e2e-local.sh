#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE=.env.e2e-local

if command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
  COMPOSE=(podman compose)
  ENGINE=podman
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  ENGINE=docker
else
  echo 'Podman Compose or Docker Compose is required.' >&2
  exit 1
fi

echo 'Starting Convex backend and LiveKit...'
"${COMPOSE[@]}" up -d convex-backend livekit

echo 'Waiting for Convex backend at http://127.0.0.1:3210/ (up to 60 seconds)...'
ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error http://127.0.0.1:3210/ >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo 'Convex backend did not become ready within 60 seconds.' >&2
  "${ENGINE}" logs convex-backend || true
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo 'Creating .env.e2e-local with a self-hosted admin key...'
  admin_key="$("${ENGINE}" exec convex-backend ./generate_admin_key.sh | tr -d '\r\n')"
  if [[ ! "$admin_key" =~ ^convex-self-hosted\| ]]; then
    echo 'Convex backend returned an invalid admin key.' >&2
    exit 1
  fi
  cat > "$ENV_FILE" <<EOF_ENV
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=$admin_key
EOF_ENV
else
  echo 'Reusing .env.e2e-local.'
fi

BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
SITE_URL=http://localhost:3334
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_HOST=ws://localhost:7880
# The browser connects to LIVEKIT_HOST; the Convex container has to go through the host gateway.
LIVEKIT_API_HOST=http://host.docker.internal:7880

echo 'Setting Convex function environment...'
npx convex env set --env-file .env.e2e-local BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
npx convex env set --env-file .env.e2e-local SITE_URL "$SITE_URL"
npx convex env set --env-file .env.e2e-local LIVEKIT_API_KEY "$LIVEKIT_API_KEY"
npx convex env set --env-file .env.e2e-local LIVEKIT_API_SECRET "$LIVEKIT_API_SECRET"
npx convex env set --env-file .env.e2e-local LIVEKIT_HOST "$LIVEKIT_HOST"
npx convex env set --env-file .env.e2e-local LIVEKIT_API_HOST "$LIVEKIT_API_HOST"
echo 'Deploying Convex functions...'
npx convex dev --once --env-file .env.e2e-local
echo 'Seeding the meeting room...'
npx convex run e2e:seedRoom '{}' --env-file .env.e2e-local
# Give the assistant its own room so a previous media test's tracks cannot join its grid.
npx convex run e2e:seedRoom '{"slug":"assistant-e2e","name":"Assistant E2E"}' --env-file .env.e2e-local
# Open and without a workspace: everyone in it moderates (timer, voting), as in a self-hosted room.
npx convex run e2e:seedRoom '{"slug":"facilitation","name":"Workshop","access":"OPEN"}' --env-file .env.e2e-local

echo 'Local E2E stack is ready.'
echo 'Run: npm run e2e:local'
