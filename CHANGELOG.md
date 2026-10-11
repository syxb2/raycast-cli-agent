# CLI Assistant Changelog

## [Model Listesi CLI'den] - 2026-10-11

- Model listesi sabit değil; Claude Code CLI'den planına göre alınır, önbelleğe yazılır ve günde bir yenilenir
- Menülere "Model Listesini Yenile" eklendi
- Varsayılan model ayarı takma adlara (haiku, sonnet, opus, fable) geçti; her zaman en yeni sürüm kullanılır

## [Model Seçimi] - 2026-10-11

- Seçilen model tüm komutlarda ortak ve kalıcı; Sohbet ve Çevir'de menüden, cevap ekranında ⌘⇧R ile değiştirilir
- Sohbet ortasında model değiştirilebilir, bağlam korunur; her cevabın altında hangi modelin yazdığı görünür
- Fable 5.1 eklendi; "Ek Modeller" ayarıyla `claude --model`'in kabul ettiği her ad eklenebilir
- Durdur kısayolu tekrar ⌘. oldu

## [İlk Sürüm] - 2026-10-11

- Soru Sor, Sohbet ve Sohbet Geçmişi komutları
- Seçili metinle çalışan komutlar: Seçim Hakkında Sor, Yazımı Düzelt, Metni İyileştir, Metni Kısalt, Çevir, Çevir ve Değiştir, Özetle, Açıkla
- Akarak gelen cevaplar, devam soruları, 5 saatlik ve haftalık kota gösterimi
