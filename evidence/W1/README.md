# W1 Kanıt Dizini (`evidence/W1`)

Bu klasör, Trendyol arama bağlantılarının gerçek tarayıcı ve cihaz üzerindeki davranışına ait doğrulanabilir kanıtları içerir (bot/scraping içermez).

- `d02-url-observations.json`: W1 / D02 kapsamında 4 vitrin kategoride (`erkek_mont`, `spor_ayakkabi`, `bluetooth_kulaklik`, `laptop`) `/sr?...` ve `-x-` URL kalıplarının web doğrulama kayıtları.
- `d02-laptop-prc-20000-30000.png`: `https://www.trendyol.com/sr?q=laptop&prc=20000-30000` ekranında `Kategori: Laptop` ve `Fiyat: 20000 - 30000` filtrelerinin aktifliğini gösteren ekran görüntüsü.

Doğrulama komutu:

```bash
uv run --directory backend python ../scripts/verify_filter_matrix.py ../evidence/W1/d02-url-observations.json
```
