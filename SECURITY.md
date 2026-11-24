# Güvenlik Politikası

## Temel İlkeler

- `.env` dosyaları, API anahtarları, veritabanı parolaları, JWT sırları ve imzalama sertifikaları asla Git'e veya mobil uygulama paketine eklenmez.
- Ham arama metinleri, e-posta adresleri, token'lar ve tam yönlendirme URL'leri varsayılan olarak sunucu loglarına ve telemetriye yazılmaz.
- Haricî bağlantılar yalnızca açıkça izin listesinde (`allowlist`) bulunan HTTPS Trendyol alan adlarına üretilir.
- Çekirdek misafir arama akışı için sunucuda kimlik veya profil zorunluluğu tutulmaz.

## Güvenlik Açığı Bildirimi

Güvenlik açığı tespit ettiğinizde herkese açık Issue açmak yerine doğrudan depo yöneticisiyle özel kanal üzerinden iletişime geçin ve yeniden üretim adımlarını paylaşın.
