#!/bin/bash
#
# Install (or remove) the LaunchAgent that waits for Airtable's API
# quota to reset and then migrates into the Excel store.
#
#   scripts/install-airtable-watcher.sh              # install + run once now
#   scripts/install-airtable-watcher.sh --uninstall  # remove
#   scripts/install-airtable-watcher.sh --status     # is it loaded?
#
# Runs every 6 hours under your user account (not root). It removes
# itself once the migration succeeds — see await-airtable-migrate.sh.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="io.kubegraf.airtable-migrate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  --uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -f "$PLIST"
    echo "removed $LABEL"
    exit 0
    ;;
  --status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "$LABEL is loaded"
      [ -f "$REPO/.airtable-migrate.done" ] && echo "migration already completed" \
        || echo "waiting for the Airtable quota to reset"
    else
      echo "$LABEL is not loaded"
    fi
    exit 0
    ;;
esac

mkdir -p "$HOME/Library/LaunchAgents"
chmod +x "$REPO/scripts/await-airtable-migrate.sh" "$REPO/scripts/install-airtable-watcher.sh"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/await-airtable-migrate.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>21600</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$REPO</string>
  <key>StandardOutPath</key>
  <string>$REPO/.airtable-migrate.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$REPO/.airtable-migrate.launchd.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST_EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST" || { echo "failed to load $LABEL"; exit 1; }

echo "installed $LABEL — probes Airtable every 6 hours"
echo "  log:       $REPO/.airtable-migrate.log"
echo "  status:    scripts/install-airtable-watcher.sh --status"
echo "  uninstall: scripts/install-airtable-watcher.sh --uninstall"
