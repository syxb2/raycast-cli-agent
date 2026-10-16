#!/bin/bash
# Installs or updates Cli Agent.
#   curl -fsSL https://raw.githubusercontent.com/syxb2/raycast-cli-agent/main/install.sh | bash
#
# No Node, npm or git needed: downloads the prebuilt package from the latest
# GitHub release, puts it into Raycast's extensions folder and registers it
# with Raycast. Running it again updates to the latest version; chats and
# settings are kept.
set -euo pipefail

REPO="syxb2/raycast-cli-agent"
NAME="raycast-cli-agent" # "name" in package.json; the Raycast extension id
# RAYCAST_CLI_AGENT_ASSET_URL is for testing only (file:// works too).
ASSET_URL="${RAYCAST_CLI_AGENT_ASSET_URL:-https://github.com/$REPO/releases/latest/download/raycast-cli-agent.tar.gz}"
DEST="$HOME/.config/raycast/extensions/$NAME"
# `ray develop` reports a source folder (cwd) on registration; give it a stable one.
HOME_DIR="$HOME/.local/share/raycast-cli-agent"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

bold "Installing Cli Agent"

[ "$(uname -s)" = "Darwin" ] || die "Only macOS is supported."

if [ -d /Applications/Raycast.app ] || mdfind "kMDItemCFBundleIdentifier == 'com.raycast.macos'" 2>/dev/null | grep -q .; then
  ok "Raycast found"
else
  die "Raycast not found: https://raycast.com"
fi

# Either CLI is enough; a missing one doesn't stop the install, the extension
# explains what to do on first use.
PI=""
for c in /opt/homebrew/bin/pi /usr/local/bin/pi "$HOME/.local/bin/pi" "$HOME/.npm-global/bin/pi" "$HOME/.bun/bin/pi"; do
  [ -x "$c" ] && { PI="$c"; break; }
done
if [ -z "$PI" ]; then
  warn "Pi Agent not found (optional). Install Pi and configure its local provider, then set Pi CLI Path if needed."
else
  ok "Pi Agent installed ($PI); its local settings and authentication will be reused"
fi

CODEX=""
for c in /opt/homebrew/bin/codex /usr/local/bin/codex "$HOME/.local/bin/codex" "$HOME/.npm-global/bin/codex" \
  "$HOME/.bun/bin/codex" /Applications/ChatGPT.app/Contents/Resources/codex /Applications/Codex.app/Contents/Resources/codex; do
  [ -x "$c" ] && { CODEX="$c"; break; }
done
if [ -z "$CODEX" ]; then
  warn "Codex not found (optional). Install: brew install codex"
elif "$CODEX" login status >/dev/null 2>&1; then
  ok "Codex installed and signed in ($CODEX)"
else
  warn "Codex is installed; configure its local provider credentials or run: '$CODEX' login"
fi

[ -n "$PI$CODEX" ] || warn "Install at least one of Codex or Pi Agent to use the extension."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# The releases/latest/download redirect can point to the previous version for
# a few minutes after a release (seen 2026-10-11); ask the API for the tag first.
if [ -z "${RAYCAST_CLI_AGENT_ASSET_URL:-}" ]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
    /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])' 2>/dev/null || true)"
  [ -n "$TAG" ] && ASSET_URL="https://github.com/$REPO/releases/download/$TAG/raycast-cli-agent.tar.gz"
fi
curl -fsSL "$ASSET_URL" -o "$TMP/pkg.tar.gz" || die "Download failed: $ASSET_URL"
mkdir "$TMP/pkg"
tar -xzf "$TMP/pkg.tar.gz" -C "$TMP/pkg"
grep -q "\"name\": \"$NAME\"" "$TMP/pkg/package.json" 2>/dev/null || die "The downloaded package is not the expected extension."
VERSION="$(cat "$TMP/pkg/VERSION" 2>/dev/null || echo '?')"
ok "Downloaded $VERSION"

mkdir -p "$(dirname "$DEST")" "$HOME_DIR"
rm -rf "$DEST"
mv "$TMP/pkg" "$DEST"
cp "$DEST/package.json" "$HOME_DIR/package.json"
echo "$VERSION" > "$HOME_DIR/VERSION"
ok "Files installed"

# The notification `ray develop` sends to Raycast after a build: registers or
# reloads the extension as a development extension. "start" would also open
# the Raycast window, which isn't needed. `open` launches Raycast if needed.
CWD="$(/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$HOME_DIR")"
open -g -b com.raycast.macos "raycast://cli/$NAME/build-success?cwd=$CWD&info="
ok "Registered with Raycast"

echo
bold "Done. Search for \"Cli Agent\" commands in Raycast."
cat <<'EOF'
  Next steps:
  • Open the Settings command (Cli Agent) to configure General, Codex and Pi Agent
  • Make Ask AI a fallback command, and give hotkeys to Translate and Replace
    or Fix Spelling and Grammar
  • To update, run this command again
  • To uninstall, press ⌘K on any of its commands in Raycast → Uninstall Extension
EOF
