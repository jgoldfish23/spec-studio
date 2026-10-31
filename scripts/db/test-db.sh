#!/usr/bin/env bash
# Runs the Postgres tests (vitest project "db").
#
# With DATABASE_URL set (CI uses a postgres:16 service container), tests run against that server.
# Otherwise a throwaway cluster is started in /tmp/spec-studio-pg on port 54329 and always removed
# afterwards, pass or fail. The exit code is the test run's.
set -uo pipefail

cd "$(dirname "$0")/../.."

if [ -n "${DATABASE_URL:-}" ]; then
  exec npx vitest run --project db "$@"
fi

PGBIN=/usr/lib/postgresql/16/bin
PGDIR=/tmp/spec-studio-pg
PGPORT=54329

# initdb refuses to run as root, so as root every server command runs as the postgres OS user.
run_pg() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -c "$*"
  else
    bash -c "$*"
  fi
}

cleanup() {
  if [ -f "$PGDIR/data/postmaster.pid" ]; then
    run_pg "$PGBIN/pg_ctl -D '$PGDIR/data' -m immediate stop" >/dev/null 2>&1
  fi
  rm -rf "$PGDIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -x "$PGBIN/initdb" ]; then
  echo "test-db: $PGBIN/initdb not found. Install PostgreSQL 16, or set DATABASE_URL to a running server." >&2
  exit 1
fi

# Remove anything a crashed earlier run left behind, then build a fresh cluster.
cleanup
mkdir -p "$PGDIR/data"
if [ "$(id -u)" = "0" ]; then chown -R postgres "$PGDIR"; fi

run_pg "$PGBIN/initdb -D '$PGDIR/data' -U postgres -A trust --no-sync" >/dev/null || {
  echo "test-db: initdb failed" >&2
  exit 1
}
run_pg "$PGBIN/pg_ctl -D '$PGDIR/data' -l '$PGDIR/server.log' -w -o \"-p $PGPORT -k $PGDIR -c listen_addresses=localhost -c fsync=off\" start" >/dev/null || {
  echo "test-db: server did not start; log follows" >&2
  cat "$PGDIR/server.log" >&2
  exit 1
}

export DATABASE_URL="postgresql://postgres@localhost:$PGPORT/postgres"
npx vitest run --project db "$@"
exit $?
