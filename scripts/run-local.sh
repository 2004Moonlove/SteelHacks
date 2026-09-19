#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$repo_dir"
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
if command -v /usr/libexec/java_home >/dev/null 2>&1; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
fi
if [ "${1:-}" = "--build" ]; then
  (cd frontend && npm ci && npm run build)
  (cd backend && ./mvnw -Pbundle-frontend package)
fi
if [ ! -f backend/target/dayfork-0.1.0.jar ]; then
  echo 'Build first: ./scripts/run-local.sh --build' >&2
  exit 1
fi
java_command="java"
if [ -n "${JAVA_HOME:-}" ]; then
  java_command="$JAVA_HOME/bin/java"
fi
exec "$java_command" -jar backend/target/dayfork-0.1.0.jar
