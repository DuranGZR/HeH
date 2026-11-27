# HeH. — Doğal Türkçe Ürün Arama Asistanı

**heh.**, kullanıcıların sesli veya yazılı doğal Türkçe ile tarif ettiği ürün kriterlerini yapısal kurallara ayıran, düzenlenebilir şekilde sunan ve açık kullanıcı onayıyla güvenli HTTPS Trendyol arama bağlantısı üreten minimalist mobil uygulamadır.

> **Bağımsızlık Beyanı:** HEH bağımsız bir arama bağlantısı oluşturucusudur; Trendyol'un resmî ürünü veya iştiraki değildir. Ürün kataloğu barındırmaz, web kazıma (scraping) yapmaz ve yalnızca izinli HTTPS `www.trendyol.com` bağlantıları açar.

## Depo Yapısı

- `frontend/`: React Native (`0.88`) + Expo SDK `58` + strict TypeScript mobil istemci (`expo-widgets`, `expo-speech-recognition`)
- `backend/`: Python (`>=3.12`) + `uv` + FastAPI + Pydantic v2 API, M0 Türkçe deterministik CQU motoru (`infrastructure/nlp/rules`) ve PostgreSQL/Alembic katmanı
- `infrastructure/`: Yerel geliştirme için PostgreSQL 17 Docker Compose (`docker-compose.yml`)
- `.github/`: Zorunlu CI (`ci.yml`) ve PR/Issue şablonları

## Modül Sınırları

- `frontend/` hiçbir iş mantığı, parser kuralı veya Trendyol URL parametresi üretmez; yalnızca `backend/` OpenAPI kontratını (`src/api/generated.ts`) tüketir.
- `backend/src/heh_api/domain/` hiçbir dış framework, FastAPI nesnesi veya ORM modeli import etmez.
- Çekirdek misafir arama hattı (`/api/v1/search/parse`, `/api/v1/search/resolve`, `/api/v1/search/capabilities`, `/api/v1/health/ready`) PostgreSQL'e bağlı olmadan bellek-içi salt-okunur snapshot üzerinde çalışır (**Zero-DB Hot Path**).

## Hızlı Kurulum ve Kalite Kapıları

Ön koşullar: Node.js `22.x`, `pnpm 12.x`, `uv`, Python `3.12+` (opsiyonel yerel DB için Docker Desktop).

### Ortam Değişkenleri

- Backend: `cp backend/.env.example backend/.env` (sırlar ve `.env` asla commit edilmez).
- Frontend: `cp frontend/.env.example frontend/.env` (`EXPO_PUBLIC_HEH_API_URL` mobil cihazın veya emülatörün erişeceği API adresini belirler).

### Yerel PostgreSQL 17 & Migration (Opsiyonel)

```bash
HEH_POSTGRES_PORT=5433 docker compose -f infrastructure/docker-compose.yml up -d --wait
cd backend
HEH_DATABASE_URL=postgresql+psycopg://heh:heh_local_dev@127.0.0.1:5433/heh uv run alembic upgrade head
HEH_DATABASE_URL=postgresql+psycopg://heh:heh_local_dev@127.0.0.1:5433/heh uv run pytest -m integration -q
```

### Backend (`backend/`)

```bash
cd backend
uv sync --frozen --dev
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests scripts
uv run pytest -q
uv run python scripts/eval_m0_golden.py
uv run python scripts/generate_contracts.py --check
uv run uvicorn heh_api.main:app --reload
```

### API Örneği (`1-RTT POST /api/v1/search/parse`)

```json
POST /api/v1/search/parse
{"text": "3000 altı siyah M erkek mont", "locale": "tr-TR", "input_source": "text"}
```

OpenAPI/TypeScript şema senkronizasyonu: `cd backend && uv run python scripts/generate_contracts.py`

### Frontend & Native Development Build (`frontend/`)

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:ci
npx expo config --type introspect
```

Widget (`expo-widgets`, iOS `group.com.heh.app`) ve sesli arama (`expo-speech-recognition`) izinleri `frontend/app.config.ts` üzerinde tanımlıdır; fiziksel cihaz testleri için `eas.json` `development` profiliyle `expo-dev-client` derlemesi gerekir.
