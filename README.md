<p align="center"><img src="assets/icon.png" width="128" alt="CLI Assistant"></p>

# CLI Assistant

Raycast Pro olmadan Raycast'te yapay zekâ: soru sor, sohbet et, seçili metni düzelt, çevir, özetle. İstekler, bilgisayarında kurulu ve kendi Claude hesabınla giriş yapmış [Claude Code](https://code.claude.com) CLI'si üzerinden gider. Kullanım Raycast AI kredisinden değil, Claude planının kotasından düşer.

> Bu proje Anthropic veya Raycast ile bağlantılı değildir; Anthropic tarafından geliştirilmemiş ya da onaylanmamıştır.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| **Soru Sor** | Soruyu ana aramadan alır, cevap akarak gelir. Fallback komutu olarak eklenebilir. |
| **Sohbet** | Devam soruları sorabileceğin sohbet. |
| **Sohbet Geçmişi** | Önceki sohbetleri açar veya siler. |
| **Seçim Hakkında Sor** | Seçili metin hakkında soru sorar. |
| **Yazımı Düzelt** · **Metni İyileştir** · **Metni Kısalt** | Seçili metni dönüştürüp seçimin yerine yapıştırır. |
| **Çevir** | Yazdıkça çevirir; seçili metin kendiliğinden gelir. Hedef dil hatırlanır. |
| **Çevir ve Değiştir** | Seçili metni pencere açmadan çevirip yerine yapıştırır. |
| **Özetle** · **Açıkla** | Seçili metni (seçim yoksa panodakini) özetler veya açıklar. |

**Model seçimi:** Sohbet ve Çevir'de arama çubuğundaki menüden, cevap ekranında <kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd> ile. Seçilen model tüm komutlarda ortaktır ve hatırlanır; sohbetin ortasında değiştirince bağlam korunur.

Cevap ekranında: <kbd>↵</kbd> ön uygulamaya yapıştır, <kbd>⌘</kbd><kbd>↵</kbd> sohbette devam et, <kbd>⌘</kbd><kbd>⇧</kbd><kbd>C</kbd> kopyala, <kbd>⌘</kbd><kbd>R</kbd> yeniden üret, <kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd> başka modelle sor (seçim kalıcı olur), <kbd>⌘</kbd><kbd>.</kbd> durdur.

## Gereksinimler

- macOS üzerinde Raycast v2
- [Claude Code](https://code.claude.com/docs/en/quickstart) kurulu ve ücretli bir Claude planıyla giriş yapılmış:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  claude   # ardından /login
  ```

## Kurulum

Eklenti Raycast Store'da değil; kaynaktan kurulur:

```bash
git clone https://github.com/umitaltintas/raycast-cli-assistant.git
cd raycast-cli-assistant
npm install
npm run dev   # eklenti Raycast'e eklendikten sonra Ctrl+C ile durdurabilirsin
```

İpuçları:

- **Soru Sor**'u Raycast ayarlarından fallback komutu yap: ana aramaya yazdığın, hiçbir komutla eşleşmeyen metin ↵ ile doğrudan soruya dönüşür.
- Sık kullandığın komutlara (Çevir ve Değiştir, Yazımı Düzelt) hotkey ata.

## Ayarlar

| Ayar | Açıklama |
| --- | --- |
| Varsayılan Model | Haiku 5.5 (en hızlı), Sonnet 5.5, Opus 5.5, Fable 5.1. Uygulama içinde seçtiğin model bunun yerine geçer. |
| Ek Modeller | Listeye eklenecek, virgülle ayrılmış model adları. `claude --model`'in kabul ettiği her ad olur: `opus`, `sonnet`, `claude-opus-5-5[1m]` vb. |
| Claude CLI Yolu | Boşsa `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` denenir |
| Ek Talimat | Her isteğe eklenen kişisel talimat (üslup, hitap vb.) |

## Nasıl çalışır

Her istek `claude -p` ile, akış (`stream-json`) modunda çalıştırılır. Claude Code bir kodlama ajanı olduğu için sohbet asistanına gerekmeyenler kapatılır:

- araçlar (`--tools ""`), MCP sunucuları (`--strict-mcp-config`), ayar dosyaları (`--setting-sources ""`) ve slash komutları kapalı;
- Claude Code'un kodlama sistem talimatı yerine kısa bir asistan talimatı (`--system-prompt`).

Bu, ilk cevaba kadar geçen süreyi ölçümümde ~9 sn'den ~3 sn'ye indiriyor. `--bare` daha hızlı olurdu ama yalnızca API anahtarıyla çalışıyor, Claude hesabı girişini okumuyor.

Diğer ayrıntılar:

- **Sohbetler** Claude Code oturumlarıdır (`--session-id` / `--resume`). Oturum dosyaları gerçek projelerine karışmasın diye eklentinin kendi klasöründe tutulur.
- **Proxy:** `--setting-sources ""` kullanıcı ayarlarını atladığı için `~/.claude/settings.json` içindeki `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` değerleri eklenti tarafından okunup CLI'ye verilir.
- **Raycast ortamı:** Raycast eklenti süreçlerinde `USER` / `LOGNAME` tanımlı değil; Claude Code bunlar olmadan anahtar zincirindeki girişi bulamayıp `Not logged in` diyor. Eklenti bu değişkenleri kendisi tanımlar.
- **Çeviri yönü:** "Otomatik (TR ↔ EN)" kararı modele bırakılmaz, metnin Türkçe olup olmadığına eklenti karar verir; modele her zaman tek bir hedef dil gider.
- `ANTHROPIC_API_KEY` ortamda tanımlıysa CLI üyelik yerine onu kullanacağı için çocuk süreçten silinir.

## Kullanım koşulları

Eklenti kimlik bilgisi toplamaz, saklamaz ve aktarmaz; yalnızca senin kurduğun, değiştirilmemiş Claude Code CLI'sini çalıştırır ve giriş Anthropic'in kendi akışıyla yapılır. Kullanımın [Anthropic'in koşullarına](https://code.claude.com/docs/en/legal-and-compliance) ve planının sınırlarına tabidir.

## Lisans

MIT
