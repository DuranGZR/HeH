# D33 — Gerçek STT / ASR Gözlemleriyle Türkçe CQU Anotasyon El Kitabı

- **Tarih:** `2026-11-25` (W7 / D33)
- **Şema Sürümü:** `SearchIntentV2` (`schema_version = "2.0.0"`, `ontology_version = "1.0.0"`)
- **Ontoloji Kaynağı:** [`backend/src/heh_api/data/ontology/ontology.v1.yaml`](../../backend/src/heh_api/data/ontology/ontology.v1.yaml) ve [`aliases.v1.yaml`](../../backend/src/heh_api/data/ontology/aliases.v1.yaml)
- **Doğrulama Aracı:** [`backend/scripts/nlp/validate_annotations.py`](../../backend/scripts/nlp/validate_annotations.py)

---

## 1. Altın İlkeler (Anayasamız)

1. **Varsayım Yasağı (`No Assumptions`):** Metinde açıkça yazmayan veya söylenmeyen cinsiyet (`erkek`/`kadın`), fiyat üst/alt sınırı, renk veya marka **kesinlikle eklenmez**.
   - `"siyah mont"` -> `category=erkek_mont? HAYIR` / `gender? HAYIR` -> `category=mont (belirsiz)` veya `erkek_mont` yerine cinsiyetsiz/varsayımsız değerlendirme (`explicit=true` yalnız metinde geçene verilir).
2. **Sıfır PII & Sıfır Sentetik Kopya Kazıma:** Telefon (`05xx`), TCKN, IBAN, e-posta veya fiziksel adres içeren hiçbir satır veri setine giremez.
3. **Transkript vs. Niyet Ayrımı (W6 ASR Kuralı):** Sesli arama satırlarında `input_source="voice"` ve opsiyonel `intended_meaning` ayrı tutulur; `spans` **her zaman o kaydın kendi `query` metni üzerindeki** tam karakter indeksini (`query[start:end] == surface`) işaretler.

---

## 2. Karakter Span Offset Kuralları

- Metin **Unicode NFC** ile normalize edilir; kontrol karakterleri temizlenir (`normalize_display_query`), ancak etiketlenecek `query` üzerinde harf küçültme veya kelime ekleme yapılmaz (case olduğu gibi kalır).
- Tüm span'lar **0-tabanlı yarı-açık dilimdir** (`[start, end)` -> Python `query[start:end] == surface`).
- **Türkçe Sondan Eklemeli Kuralı:**
  - Çekim ekini kök varlık etiketinden mümkün olduğunca dışarıda bırak (`"kulaklığı"` -> eğer marka/ürün kelimesi ek almışsa `"kulaklık"` yerine yüzeyin bütünü veya tanımlı kök dilimlenebilir; tutarlılık kuralı: yüzey `query[start:end]` sözcüğün bütün token sınırını kaplar: `"ayakkabısı"` -> `"ayakkabısı"`, `"Nike'tan"` -> `"Nike"`, `"2500'ün"` -> `"2500"`).
  - İki ayrı span aynı karakter aralığında **kesişemez / çakışamaz**.
- **Desteklenen Span Etiketleri (`field`):**
  `category`, `brand`, `color`, `size`, `gender`, `price`, `material`, `attribute`, `model`, `unit`.

---

## 3. İlişki (`Relations`), Kutup (`Polarity`) ve Kiplik (`Modality`)

| Yapı | Ne Zaman Kullanılır? | Değer / Kural | Örnek |
| :--- | :--- | :--- | :--- |
| **`all_of` (Varsayılan VE)** | Birbiriyle kesişen tüm olumlu koşullar | `polarity="positive"`, `modality="must"` | `"siyah M erkek mont"` -> `color=siyah` AND `size=m` AND `category=erkek_mont` |
| **`any_of` (`VEYA` grubu)** | Açık `"veya"`, `"ya da"`, `"/"` veya `"A, B veya C"` zinciri | `operator="in"`, `modality="should"`, `relation_group="or_..."` | `"Sony veya JBL"` -> tek `any_of` kümesi |
| **`not` (Hariç Tutma)** | `"olmasın"`, `"olmayan"`, `"hariç"`, `"dışında"`, `"değil"`, `"istemiyorum"` | `operator="not_in"`, `polarity="negative"`, `modality="must_not"` | `"Nike, Puma olmasın"` -> iki marka da `not` kapsamında |
| **Sağdan Sola Zincir Negation** | Birden çok öğeden hemen sonra gelen tek `"olmasın"` / `"hariç"` | Virgül/`ve`/`veya` köprüsü kesilmedikçe tüm listeyi kapsar; `"ama"` / `"ancak"` / `","` dışı kelimede durur | `"Nike ve Adidas olmasın ama siyah"` -> `Nike, Adidas`=`NOT`, `siyah`=`POS` |
| **Belirsiz Fiyat (`civarı`)** | `"3 bin civarı"`, `"2000 gibi"` | `modality="should"`, `required=false` (katı `0-3000` tavanı değildir) | `"3 bin civarı kulaklık"` |
| **Aksesuar Başlığı Koruması** | `"iPhone 15 kılıf"`, `"laptop çantası"` | Ana kategori `cep_telefonu` / `laptop` DEĞİL, aksesuardır (`no category` / `sirt_cantasi` vb.) | `"macbook kılıfı"` -> `category_key != "laptop"` |

---

## 4. `34` Rehber Örneği (`W6` Gerçek ASR Hata Kalıpları Dahil)

### 4.1 Vitrin & Çoklu Kısıt Örnekleri (`01–10`)

1. **`"3000 altı erkek mont"`** -> `category: erkek_mont [0:20]?` değil `category: erkek_mont ["erkek mont", 10:20]`, `price: 0-3000 (lte, must) ["3000 altı", 0:9]`, `explicit=true`.
2. **`"Mavi siyah M beden erkek mont"`** -> `brand: mavi ["Mavi", 0:4]` (`color_ambiguous` çözüldü), `color: siyah ["siyah", 5:10]`, `size: m ["M", 11:12]`, `category: erkek_mont ["erkek mont", 19:29]`.
3. **`"Columbia lacivert L beden erkek kaban"`** -> `brand: columbia ["Columbia"]`, `color: lacivert ["lacivert"]`, `size: l ["L"]`, `category: erkek_mont ["erkek kaban"]`.
4. **`"1500-3500 TL pamuklu siyah parka"`** -> `price: [1500, 3500] (between, must)`, `material: pamuk ["pamuklu"]`, `color: siyah`, `category: erkek_mont ["parka"]`.
5. **`"Adidas beyaz 43 numara koşu ayakkabısı 3000 altı"`** -> `brand: adidas`, `color: beyaz`, `size: 43 ["43 numara"]`, `category: spor_ayakkabi ["koşu ayakkabısı"]`, `price: <=3000`.
6. **`"Sony WH-1000XM5 siyah ANC bluetooth kulaklık"`** -> `brand: sony`, `model: WH-1000XM5`, `color: siyah`, `attribute: anc`, `category: bluetooth_kulaklik` (`1000` model içinden çıkarılmaz!).
7. **`"16 GB RAM 20-30 bin Lenovo laptop"`** -> `attribute/unit: 16 GB ["16 GB"]`, `price: [20000, 30000] ["20-30 bin"]`, `brand: lenovo`, `category: laptop`.
8. **`"iPhone 15 128 GB siyah cep telefonu 45000 altı"`** -> `brand: apple ["iPhone"]`, `model: iPhone 15`, `unit: 128 GB`, `color: siyah`, `category: cep_telefonu`, `price: <=45000`.
9. **`"2000 üstü 42 numara sneaker"`** -> `price: >=2000 ["2000 üstü"]`, `size: 42`, `category: spor_ayakkabi ["sneaker"]`.
10. **`"en fazla 5000 TL 30 saat şarjlı siyah kulak üstü kulaklık"`** -> `price: <=5000`, `unit: 30 saat`, `color: siyah`, `attribute: kulak_ustu`, `category: bluetooth_kulaklik`.

### 4.2 Uzun Kuyruk (`Long-Tail`) Kategoriler (`11–16`)

11. **`"5000 altı ergonomik siyah oyuncu koltuğu"`** -> `category: oyuncu_koltugu` (`home.furniture.gaming_chair`, `showcase=false`), `price<=5000`, `attribute: ergonomik`, `color: siyah`.
12. **`"kamp için 1.5 litre paslanmaz çelik siyah termos"`** -> `category: termos`, `unit: 1.5 litre`, `material: paslanmaz çelik`, `color: siyah`.
13. **`"2500-6000 TL filtre kahve makinesi"`** -> `category: kahve_makinesi`, `price=[2500, 6000]`.
14. **`"144 Hz 27 inç IPS monitör 9000 altı"`** -> `category: monitor`, `unit: 144 Hz`, `unit: 27 inç`, `attribute: ips`, `price<=9000`.
15. **`"6000 altı akıllı saat siyah suya dayanıklı"`** -> `category: akilli_saat`, `price<=6000`, `color: siyah`, `attribute: su_gecirmez`.
16. **`"hassas cilt için 50 ml nemlendirici cilt bakım kremi 600 altı"`** -> `category: cilt_bakim_kremi`, `unit: 50 ml`, `price<=600`.

### 4.3 Boolean `OR` / `NOT` ve Çelişki Örnekleri (`17–23`)

17. **`"Sony veya JBL kablosuz kulaklık"`** -> `brand: (sony, jbl)` tek `any_of` (`operator="in"`, `modality="should"`).
18. **`"Nike, Puma veya Adidas spor ayakkabı"`** -> `brand: (nike, puma, adidas)` tek 3'lü `any_of`.
19. **`"Nike olmasın beyaz 42 numara spor ayakkabı"`** -> `brand: nike` (`operator="not_in"`, `polarity="negative"`, `modality="must_not"`, `logic_groups=[not]`), diğerleri `all_of`.
20. **`"Nike ve Puma olmasın 3000 altı spor ayakkabı"`** -> Hem `nike` hem `puma` `not_in` kapsamına girer (sağdan sola `ve` köprüsü).
21. **`"M veya L beden siyah erkek mont"`** -> `size: (m, l)` `any_of` grubu (`has_conflict=false`).
22. **`"S ve XL beden siyah mont"`** -> Çelişki! Aynı tekil slotta `veya` olmadan iki farklı beden (`has_conflict=true`, `intent_type="ambiguous"`, `confidence_state="abstain"`).
23. **`"Nike olsun ama Nike olmasın"`** -> Doğrudan mantıksal çelişki (`has_conflict=true`, `abstain`).

### 4.4 W6 Gerçek STT / ASR Hata Kalıpları (`24–31`)

24. **`"üç bin altı em beden siyah mont"`** (`input_source="voice"`)
    - ASR notu: `"em beden" -> M`, `"üç bin altı" -> <=3000`. `raw_query` metni korunur; `"em"` span'ı `"m"` olarak etiketlenir.
25. **`"nayk olmasın kırk iki numara beyaz ayakkabı"`** (`input_source="voice"`)
    - ASR notu: `"nayk"` (`["nayk", 0:4]`) -> `brand: nike` (`not_in`, `polarity="negative"`), `"kırk iki numara"` -> `size: 42`.
26. **`"iki buçuk bin te le altı cey bi el veya soni kulaklık"`** (`input_source="voice"`)
    - ASR notu: `"iki buçuk bin te le altı"` -> `price<=2500`, `"cey bi el"` -> `jbl`, `"soni"` -> `sony` (`any_of`).
27. **`"şayomi on altı cigabayt beyaz telefon yirmi beş bin altı"`** (`input_source="voice"`)
    - ASR notu: `"şayomi"` -> `brand: xiaomi`, `"on altı cigabayt"` / `"16 cigabayt"` -> `unit: 16 GB`, `"yirmi beş bin altı"` -> `price<=25000`.
28. **`"epıl mekbuk pro 16 cigabayt elli bin altı"`** (`input_source="voice"`)
    - ASR notu: `"epıl"` -> `brand: apple`, `"mekbuk pro"` -> `model/category: laptop`.
29. **`"el beden lacivert kaban üçbin beşyüz altı"`** (`input_source="voice"`)
    - ASR notu: `"el beden"` -> `size: l` (yanında `beden` olduğu için güvenli; tek `"el kremi"` asla beden olmaz).
30. **`"3 bin civarı gürültü engelleyici blutut kulaklık"`** (`input_source="voice"`)
    - Belirsizlik kuralı: `"3 bin civarı"` -> `modality="should"`, `required=false` (katı `<=3000` değil); `"gürültü engelleyici"` -> `attribute: anc`; `"blutut kulaklık"` -> `category: bluetooth_kulaklik`.
31. **`"ankır saundkor siyah kulaküstü kulaklık iki bin beş yüz üstü"`** (`input_source="voice"`)
    - ASR notu: `"ankır saundkor"` -> `brand: anker`, `"kulaküstü"` -> `attribute: kulak_ustu`, `"iki bin beş yüz üstü"` -> `price>=2500`.

### 4.5 OOD & Varsayım Yasağı Negatif Örnekleri (`32–34`)

32. **`"bugün istanbulda hava nasıl"`** -> `intent_type="unsupported"`, `is_ood=true`, `spans=[]`, 0 ürün kriteri.
33. **`"dolar kaç tl oldu acaba"`** -> `intent_type="unsupported"`, `is_ood=true` (`"tl"` geçse bile ticari ürün talebi değil!).
34. **`"ucuz şık bir mont öner"`** -> Varsayım Yasağı! `gender` ve `price` eklenmez (`review_required`, `explicit` fiyat/cinsiyet yok; bütçe uydurmak yasak).
