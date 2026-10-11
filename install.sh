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
# Pass --spotlight (curl ... | bash -s -- --spotlight) to also create an
# "Ask AI" app that Spotlight finds; once created, updates keep it current.
SPOTLIGHT=0
for arg in "$@"; do
  [ "$arg" = "--spotlight" ] && SPOTLIGHT=1
done
SPOTLIGHT_APP="$HOME/Applications/Ask AI.app"
[ -d "$SPOTLIGHT_APP" ] && SPOTLIGHT=1
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

# Either CLI is enough; a missing one doesn't stop the install, the extension
# explains what to do on first use.
CLAUDE=""
for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  [ -x "$c" ] && { CLAUDE="$c"; break; }
done
if [ -z "$CLAUDE" ]; then
  warn "Claude Code not found (optional). Install: curl -fsSL https://claude.ai/install.sh | bash"
elif "$CLAUDE" auth status >/dev/null 2>&1; then
  ok "Claude Code installed and signed in"
else
  warn "Claude Code is installed but not signed in. In a terminal: claude  →  /login"
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
  warn "Codex is installed but not signed in. In a terminal: '$CODEX' login"
fi

[ -n "$CLAUDE$CODEX" ] || warn "Install at least one of Claude Code or Codex to use the extension."

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

if [ "$SPOTLIGHT" = 1 ]; then
  if [ -f "$DEST/spotlight/ask.py" ]; then
    # Outside the extension folder, so a Raycast update can't remove it mid-use.
    install -m 755 "$DEST/spotlight/ask.py" "$HOME_DIR/ask.py"
    W="$(mktemp -d)"
    sed "s|__ASK_SCRIPT__|$HOME_DIR/ask.py|" "$DEST/spotlight/AskAI.applescript" > "$W/ask.applescript"
    mkdir -p "$HOME/Applications" "$W/icon.iconset"
    rm -rf "$SPOTLIGHT_APP"
    osacompile -o "$SPOTLIGHT_APP" "$W/ask.applescript"
    for s in 16 32 128 256 512; do
      sips -z $s $s "$DEST/assets/extension-icon.png" --out "$W/icon.iconset/icon_${s}x${s}.png" >/dev/null
      sips -z $((s * 2)) $((s * 2)) "$DEST/assets/extension-icon.png" --out "$W/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$W/icon.iconset" -o "$SPOTLIGHT_APP/Contents/Resources/applet.icns"
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string io.github.umitaltintas.ask-ai" "$SPOTLIGHT_APP/Contents/Info.plist" 2>/dev/null || true
    codesign --force --deep -s - "$SPOTLIGHT_APP" 2>/dev/null || true
    rm -rf "$W"
    mdimport "$SPOTLIGHT_APP" 2>/dev/null || true
    ok "Ask AI app for Spotlight: $SPOTLIGHT_APP"
  else
    warn "This version has no Spotlight app; skipped."
  fi
fi

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
if [ "$SPOTLIGHT" = 1 ]; then
  echo '  • Spotlight: type "Ask AI". To remove it, delete ~/Applications/Ask AI.app'
fi
