# Katkı ve Geliştirme Akışı

## Branch ve Commit Disiplini

- `main` dalı her zaman yeşil (`CI Gate` PASS) kalmalıdır.
- Kısa ömürlü çalışma dalları (`feat/*`, `fix/*`, `docs/*`) kullanılır; doğrudan kırmızı kod merge edilmez.
- Commit öncesi `git status -s` kontrol edilerek `.env`, yerel geçici dosyalar veya bağımlılık klasörlerinin sahnelenmediği doğrulanır.

## Zorunlu Yerel Kontroller

Her değişiklikten önce aşağıdaki tüm kapılar sıfır hata ile geçmelidir:

- Backend: `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy src tests`, `uv run pytest -q`
- Frontend: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
