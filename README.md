# heh. — Doğal Türkçe Ürün Arama Asistanı

**heh.**, kullanıcıların sesli veya yazılı doğal Türkçe ile tarif ettiği ürün kriterlerini yapısal kurallara ayıran, düzenlenebilir şekilde sunan ve açık kullanıcı onayıyla güvenli HTTPS Trendyol arama bağlantısı üreten minimalist mobil uygulamadır.

> **Bağımsızlık Beyanı:** HEH bağımsız bir arama bağlantısı oluşturucusudur; Trendyol'un resmî ürünü veya iştiraki değildir. Ürün kataloğu barındırmaz, web kazıma (scraping) yapmaz ve yalnızca izinli HTTPS bağlantıları açar.

## Depo Yapısı

- `frontend/`: React Native (`0.88`) + Expo SDK `58` + strict TypeScript mobil istemci
- `backend/`: Python (`>=3.12`) + `uv` + FastAPI + Pydantic v2 API ve çekirdek domain/NLP katmanı
- `.github/`: Zorunlu CI (`ci.yml`), Dependabot ve PR/Issue şablonları

## Modül Sınırları

- `frontend/` hiçbir iş mantığı, parser kuralı veya Trendyol URL parametresi üretmez; yalnızca `backend/` kontratını tüketir.
- `backend/src/heh_api/domain/` hiçbir dış framework, FastAPI nesnesi veya ORM modeli import etmez.
- Çekirdek misafir arama hattı (`/api/v1/search/*` ve `/api/v1/health/ready`) PostgreSQL'e bağlı olmadan bellek-içi salt-okunur snapshot üzerinde çalışır (Zero-DB Hot Path).

## Hızlı Kurulum ve Kalite Kapıları

Ön koşullar: Node.js `22.x`, `pnpm 12.x`, `uv`, Python `3.12+`.

### Backend (`backend/`)

```bash
cd backend
uv sync --dev
uv run ruff format --check .
uv run ruff check .
uv run mypy src tests scripts
uv run pytest -q
uv run uvicorn heh_api.main:app --reload
```

### Frontend (`frontend/`)

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:ci
```
