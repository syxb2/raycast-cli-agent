#!/bin/bash
# Installs or updates CLI Assistant.
#   curl -fsSL https://raw.githubusercontent.com/umitaltintas/raycast-cli-assistant/main/install.sh | bash
#
# No Node, npm or git needed: downloads the prebuilt package from the latest
# GitHub release, puts it into Raycast's extensions folder and registers it
# with Raycast. Running it again updates to the latest version; chats and
# settings are kept.
set -euo pipefail

REPO="umitaltintas/raycast-cli-assistant"
NAME="claude-cli" # "name" in package.json; the Raycast extension id
# CLI_ASSISTANT_ASSET_URL is for testing only (file:// works too).
ASSET_URL="${CLI_ASSISTANT_ASSET_URL:-https://github.com/$REPO/releases/latest/download/cli-assistant.tar.gz}"
DEST="$HOME/.config/raycast/extensions/$NAME"
# `ray develop` reports a source folder (cwd) on registration; give it a stable one.
HOME_DIR="$HOME/.local/share/raycast-cli-assistant"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

bold "Installing CLI Assistant"

[ "$(uname -s)" = "Darwin" ] || die "Only macOS is supported."

if [ -d /Applications/Raycast.app ] || mdfind "kMDItemCFBundleIdentifier == 'com.raycast.macos'" 2>/dev/null | grep -q .; then
  ok "Raycast found"
else
  die "Raycast not found: https://raycast.com"
fi

# A missing Claude Code doesn't stop the install; the extension explains what
# to do on first use.
CLAUDE=""
for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  [ -x "$c" ] && { CLAUDE="$c"; break; }
done
if [ -z "$CLAUDE" ]; then
  warn "Claude Code not found. Install it: curl -fsSL https://claude.ai/install.sh | bash"
elif "$CLAUDE" auth status >/dev/null 2>&1; then
  ok "Claude Code installed and signed in"
else
  warn "Claude Code is installed but not signed in. In a terminal: claude  →  /login"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# The releases/latest/download redirect can point to the previous version for
# a few minutes after a release (seen 2026-10-11); ask the API for the tag first.
if [ -z "${CLI_ASSISTANT_ASSET_URL:-}" ]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
    /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])' 2>/dev/null || true)"
  [ -n "$TAG" ] && ASSET_URL="https://github.com/$REPO/releases/download/$TAG/cli-assistant.tar.gz"
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
bold "Done. Search for \"CLI Assistant\" commands in Raycast."
cat <<'EOF'
  Next steps:
  • Set your Primary Language: Raycast Settings → Extensions → CLI Assistant
  • Make Ask AI a fallback command, and give hotkeys to Translate and Replace
    or Fix Spelling and Grammar
  • To update, run this command again
  • To uninstall, press ⌘K on any of its commands in Raycast → Uninstall Extension
EOF
