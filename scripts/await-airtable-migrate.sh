#!/bin/bash
#
# Unattended watcher: migrate Airtable → the configured store as soon as
# Airtable's API quota resets.
#
# Airtable's monthly request cap returns 429
# PUBLIC_API_BILLING_LIMIT_EXCEEDED and blocks the migration for the
# rest of the billing month. Rather than anyone remembering to check,
# a LaunchAgent runs this every 6 hours. It probes cheaply (one record),
# does nothing while still blocked, and runs the real migration the
# moment the API answers.
#
# Install/uninstall:
#   scripts/install-airtable-watcher.sh
#   scripts/install-airtable-watcher.sh --uninstall
#
# On success it migrates, writes a marker, notifies, and uninstalls
# itself — it is a one-shot that happens to retry until it can run.
#
# Everything it does is appended to .airtable-migrate.log.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$REPO/.airtable-migrate.log"
DONE_MARKER="$REPO/.airtable-migrate.done"
LABEL="io.kubegraf.airtable-migrate"

cd "$REPO" || exit 1

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

notify() {
  /usr/bin/osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null || true
}

# Already migrated — nothing left to do.
if [ -f "$DONE_MARKER" ]; then
  log "already migrated (marker present); uninstalling"
  "$REPO/scripts/install-airtable-watcher.sh" --uninstall >> "$LOG" 2>&1
  exit 0
fi

# Credentials: Airtable creds live in .env.local, the blob token in
# .env.development.local. node --env-file parses the dotenv quoting
# properly, which shell sourcing does not.
ENVFLAGS=()
[ -f "$REPO/.env.local" ]             && ENVFLAGS+=(--env-file="$REPO/.env.local")
[ -f "$REPO/.env.development.local" ] && ENVFLAGS+=(--env-file="$REPO/.env.development.local")
if [ ${#ENVFLAGS[@]} -eq 0 ]; then
  log "ERROR: no .env.local or .env.development.local — cannot run"
  exit 1
fi

# XLSX_STORE_PREFIX is deliberately unset so the xlsx driver, if that is
# the one configured, targets the production db/ namespace rather than a
# dev one. Which backend actually receives the data is decided by
# STORAGE_DRIVER in the env files above.
unset XLSX_STORE_PREFIX

NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  # LaunchAgents get a minimal PATH; fall back to the usual locations.
  for c in /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.nvm/versions/node/*/bin/node"; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
[ -z "$NODE" ] && { log "ERROR: node not found on PATH"; exit 1; }

# ── Probe: is the quota back? ────────────────────────────────────
PROBE=$("$NODE" "${ENVFLAGS[@]}" --input-type=module -e '
const base = process.env.AIRTABLE_BASE_ID, tok = process.env.AIRTABLE_TOKEN;
if (!base || !tok) { console.log("NOCREDS"); process.exit(0); }
try {
  const r = await fetch(`https://api.airtable.com/v0/${base}/Users?pageSize=1`,
    { headers: { Authorization: "Bearer " + tok } });
  if (r.ok) { console.log("READY"); process.exit(0); }
  const t = await r.text();
  let code = "HTTP_" + r.status;
  try { code = JSON.parse(t).errors?.[0]?.error ?? code; } catch {}
  console.log("BLOCKED " + r.status + " " + code);
} catch (e) { console.log("NETERR " + (e?.message ?? e)); }
' 2>&1 | tail -1)

case "$PROBE" in
  READY) log "Airtable API is readable — starting migration" ;;
  NOCREDS) log "ERROR: AIRTABLE_TOKEN/AIRTABLE_BASE_ID missing"; exit 1 ;;
  *) log "still waiting — $PROBE"; exit 0 ;;
esac

# ── Dry run first ────────────────────────────────────────────────
log "dry run…"
if ! "$NODE" "${ENVFLAGS[@]}" "$REPO/node_modules/.bin/tsx" \
      "$REPO/scripts/migrate-airtable-to-xlsx.ts" >> "$LOG" 2>&1; then
  log "dry run FAILED — nothing committed, will retry next tick"
  notify "Airtable migration" "Dry run failed — see .airtable-migrate.log"
  exit 1
fi

# ── Commit. The script's own guards (non-zero records, >=1 admin,
#    password hashes present, store empty) gate this. ──────────────
log "committing to the configured store …"
if "$NODE" "${ENVFLAGS[@]}" "$REPO/node_modules/.bin/tsx" \
     "$REPO/scripts/migrate-airtable-to-xlsx.ts" --commit >> "$LOG" 2>&1; then
  date -u +%Y-%m-%dT%H:%M:%SZ > "$DONE_MARKER"
  log "✓ MIGRATED — the configured store now holds the Airtable data"
  log "  airtable-export.xlsx contains password hashes — delete it once checked"
  notify "Airtable migration complete" "Data restored to the Excel store. See .airtable-migrate.log"
  "$REPO/scripts/install-airtable-watcher.sh" --uninstall >> "$LOG" 2>&1
  log "watcher uninstalled"
  exit 0
fi

log "commit FAILED or was refused by the safety guards — nothing written"
notify "Airtable migration blocked" "Guards refused the commit — see .airtable-migrate.log"
exit 1
