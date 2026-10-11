#!/bin/bash
# CLI Assistant kurulumu / guncellemesi.
#   curl -fsSL https://raw.githubusercontent.com/umitaltintas/raycast-cli-assistant/main/install.sh | bash
#
# Node, npm veya git gerekmez: GitHub Release'teki hazir derlemeyi indirir,
# Raycast'in eklenti klasorune koyar ve Raycast'e kaydettirir. Tekrar
# calistirmak en son surume gunceller; sohbet gecmisi ve ayarlar korunur.
set -euo pipefail

REPO="umitaltintas/raycast-cli-assistant"
NAME="claude-cli" # package.json'daki "name"; Raycast eklenti kimligi
# CLI_ASSISTANT_ASSET_URL yalnizca test icin (file:// de olur).
ASSET_URL="${CLI_ASSISTANT_ASSET_URL:-https://github.com/$REPO/releases/latest/download/cli-assistant.tar.gz}"
DEST="$HOME/.config/raycast/extensions/$NAME"
# `ray develop` kayitta kaynak klasoru (cwd) bildirir; kalici bir yer veriyoruz.
HOME_DIR="$HOME/.local/share/raycast-cli-assistant"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

bold "CLI Assistant kuruluyor"

[ "$(uname -s)" = "Darwin" ] || die "Yalnızca macOS destekleniyor."

if [ -d /Applications/Raycast.app ] || mdfind "kMDItemCFBundleIdentifier == 'com.raycast.macos'" 2>/dev/null | grep -q .; then
  ok "Raycast bulundu"
else
  die "Raycast bulunamadı: https://raycast.com"
fi

# Claude Code eksikse kurulum yine biter; eklenti ilk kullanımda ne yapılacağını söyler.
CLAUDE=""
for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  [ -x "$c" ] && { CLAUDE="$c"; break; }
done
if [ -z "$CLAUDE" ]; then
  warn "Claude Code bulunamadı. Kur: curl -fsSL https://claude.ai/install.sh | bash"
elif "$CLAUDE" auth status >/dev/null 2>&1; then
  ok "Claude Code kurulu ve giriş yapılmış"
else
  warn "Claude Code kurulu ama giriş yapılmamış. Terminalde: claude  →  /login"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$ASSET_URL" -o "$TMP/pkg.tar.gz" || die "İndirilemedi: $ASSET_URL"
mkdir "$TMP/pkg"
tar -xzf "$TMP/pkg.tar.gz" -C "$TMP/pkg"
grep -q "\"name\": \"$NAME\"" "$TMP/pkg/package.json" 2>/dev/null || die "İndirilen paket beklenen eklenti değil."
VERSION="$(cat "$TMP/pkg/VERSION" 2>/dev/null || echo '?')"
ok "Sürüm $VERSION indirildi"

mkdir -p "$(dirname "$DEST")" "$HOME_DIR"
rm -rf "$DEST"
mv "$TMP/pkg" "$DEST"
cp "$DEST/package.json" "$HOME_DIR/package.json"
echo "$VERSION" > "$HOME_DIR/VERSION"
ok "Dosyalar yerleştirildi"

# `ray develop`'un derleme sonrasi Raycast'e gonderdigi bildirim: eklentiyi
# gelistirme eklentisi olarak kaydeder/yeniden yukler. "start" Raycast
# penceresini de acar, gerek yok. Raycast kapaliysa open onu baslatir.
CWD="$(/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$HOME_DIR")"
open -g -b com.raycast.macos "raycast://cli/$NAME/build-success?cwd=$CWD&info="
ok "Raycast'e kaydedildi"

echo
bold "Hazır. Raycast'te \"CLI Assistant\" komutlarını ara."
cat <<'EOF'
  İpuçları:
  • Soru Sor'u fallback komutu yap: Raycast Ayarları → Extensions → CLI Assistant
  • Sık kullandığın komutlara (Çevir ve Değiştir, Yazımı Düzelt) hotkey ata
  • Güncellemek için bu komutu tekrar çalıştır
  • Kaldırmak için Raycast'te komutlardan birinde ⌘K → Uninstall Extension
EOF
