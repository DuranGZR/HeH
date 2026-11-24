## Özet
- Problem ve kullanıcı değeri:
- İlgili Gün / Gate / Issue:

## Review Kontrol Listesi (Master Plan Bölüm 20)
- [ ] P0/P1/P2 kapsamına uygun ve kapsam dışı özellik eklenmedi.
- [ ] Doğrulama kodu / otomatik testler eklendi ve yerelde geçti.
- [ ] OpenAPI kontratı değiştiyse istemci tipleri güncellendi.
- [ ] Gizlilik, izin ve PII redaction açısından kontrol edildi (ham sorgu/token/e-posta log yok).
- [ ] `FILTER_VERIFIED` iddiası için gerçek kanıt mevcut; doğrulanmamış filtre `verified` işaretlenmedi.
- [ ] DB migration eklendiyse geriye dönük uyumluluk (expand/contract) ve Zero-DB hot path korundu.
- [ ] Ekranlarda boş / hata / yükleniyor / erişilebilirlik durumları doğrulandı.
- [ ] Native config değiştiyse yeni development/production binary gereksinimi not edildi.
- [ ] Tüm CI kontrolleri yeşil ve gerekliyse gerçek cihaz kontrolü belirtildi.
- [ ] Davranış değişikliğine ilişkin README / ADR / runbook güncellendi.
