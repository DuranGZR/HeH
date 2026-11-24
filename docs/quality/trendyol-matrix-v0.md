# Trendyol URL Filtre Matrisi v0 (W1 / D02)

- **Tarih:** 2026-11-24
- **Kapsam:** W1 / D02 — Vitrin kategorilerde fiyat aralığı (`prc`) ve rota kalıpları (`/sr?...` vs `/<slug>-x-<codes>`)
- **Yöntem:** Kazıma (scraping) veya otomatik bot olmadan gerçek tarayıcı oturumunda manuel URL açılışı ve filtre kontrolü; kayıtların şema doğrulaması [verify_filter_matrix.py](../../scripts/verify_filter_matrix.py) ile kilitlenmiştir.
- **Dürüstlük İlkesi:** Master Plan Bölüm 08 gereği `FILTER_VERIFIED` statüsü hem web hem mobil uygulama geçiş kanıtı gerektirir. D02 yalnız web doğrulaması içerdiğinden doğrulanan tüm kayıtlar `WEB_VERIFIED_PENDING_MOBILE` olarak işaretlenmiştir.

## Vitrin Kategori Matrisi v0

| Kategori | Fiyat (Web) | `/sr` Rotası | `-x-` Facet Path | Marka / Renk / Beden / OR | Genel Durum |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Erkek Mont** | `0-3000`, `1500-3000`, `2000-*` PASS | `/sr?q=erkek+mont&prc=...` & `/sr?wg=2&wc=118&prc=...` | `/erkek-mont-x-g2-c118?prc=0-3000` PASS | `[D03 BEKLİYOR]` | `WEB_VERIFIED_PENDING_MOBILE` |
| **Spor Ayakkabı** | `1000-4000` PASS | `/sr?q=spor+ayakkabi&prc=1000-4000` | `[D03/W12'de ayrıca test edilecek]` | `[D03 BEKLİYOR]` | `WEB_VERIFIED_PENDING_MOBILE` |
| **Bluetooth Kulaklık** | `0-6000` PASS | `/sr?q=bluetooth+kulaklik&prc=0-6000` | `[D03/W12'de ayrıca test edilecek]` | `[D03 BEKLİYOR]` | `WEB_VERIFIED_PENDING_MOBILE` |
| **Laptop** | `20000-30000` PASS | `/sr?q=laptop&prc=20000-30000` | `[D03/W12'de ayrıca test edilecek]` | `[D03 BEKLİYOR]` | `WEB_VERIFIED_PENDING_MOBILE` |
| **Cep Telefonu** | `[HENÜZ TEST EDİLMEDİ]` | `[HENÜZ TEST EDİLMEDİ]` | `[HENÜZ TEST EDİLMEDİ]` | `[D03 BEKLİYOR]` | `UNKNOWN` |

<a id="d02-gozlemler"></a>
## D02 Gözlem Kayıtları ve Bulgular

### 1. Fiyat Parametresi (`prc=`) Kalıcılığı ve Sözdizimi
- **Üst sınır ve kapalı aralık (`prc=0-3000`, `prc=1500-3000`, `prc=1000-4000`, `prc=0-6000`, `prc=20000-30000`)**: Tüm test edilen URL'ler HTTP 200 ile yönlendirmeden açıldı; sol `Fiyat` akordeonu otomatik açılarak `En Az` / `En Çok` kutuları doldu ve organik sonuçlar verilen aralığa uydu (`erkek mont`: `0-3000` için `14688+`, `1500-3000` için `10953+` ürün; `laptop`: `20000-30000` için `143+` ürün).
- **Yalnız alt sınır (`prc=<min>-*`)**: UI'da sadece `En Az = 2000` girilip uygulandığında Trendyol `prc=2000-*` kalıbını üretti (`https://www.trendyol.com/sr?wg=2&wc=118&prc=2000-*`). Taze yüklemede `En Az = "2000"` ve `En Çok = ""` korundu (`30117+` ürün).
- **Önemli Ürün Notu (Sponsorlu Alanlar)**: `prc=` organik ürün listelerini filtrelese de sayfa üstü/arası **Sponsorlu** marka mağaza karuselleri (ör. DeFacto, Apple) `prc=` aralığı dışındaki ürünleri gösterebilmektedir. Son kullanıcı bilgilendirmesi (`verification_notice`) bu gerçeği gizlememelidir.

### 2. `CanonicalSearchQueryStrategy` (`/sr`) vs `VerifiedFacetPathStrategy` (`-x-`)
- **Doğrudan açılış kalıcılığı**: Hem `https://www.trendyol.com/sr?q=erkek+mont&prc=0-3000` hem de `https://www.trendyol.com/erkek-mont-x-g2-c118?prc=0-3000` doğrudan açıldığında kendi URL'sini korudu ve aynı ürün kümesini (`14688+ Ürün`) filtreledi.
- **UI mutasyonu sonrası URL davranışı**: Kullanıcı sayfa içinde sol `Fiyat` butonuna bastığında Trendyol hem `q=` metnini hem `-x-` yolunu kaldırıp sayısal query ID formuna (`/sr?wg=2&wc=118&prc=...`) geçmektedir. Benzer şekilde kenar çubuğunda alt kategori seçildiğinde (`/sr?wc=1172%2C109`, `/sr?wc=165994%2C108626`) `wc=` parametresi üretilmektedir.
- **Arama çubuğu ve başlık farkı**: `/sr?q=...` arama kutusunda metni ve `H1` başlığında ham sorguyu korurken; `/erkek-mont-x-g2-c118` ve `/sr?wg=2&wc=118` kanonik kategori başlığı (`"Erkek Mont"`) ile açılır.
- **Mimari sonuç**:
  - Vitrin kategorilerde kanıtlanmış `-x-` veya `wg/wc` ID'leri yalnız doğrulandıkça `VerifiedFacetPathStrategy` / kanıtlı `sr` facet'i olarak açılmalıdır.
  - Uzun kuyrukta ve kanıtlanmamış kategorilerde `/sr?q=<sorgu>&prc=<min>-<max|*>` kalıbı güvenilir temel fallback (`CanonicalSearchQueryStrategy`) olarak çalışmaktadır.

### 3. Kanıt Dosyaları
- Makinece doğrulanan JSON matrisi: [d02-url-observations.json](../../evidence/W1/d02-url-observations.json)
- Ekran görüntüsü kanıtı: [d02-laptop-prc-20000-30000.png](../../evidence/W1/d02-laptop-prc-20000-30000.png) (`laptop`, `20000-30000`)
