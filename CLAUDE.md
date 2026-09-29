# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MAZA CRM: a local FastAPI + SQLite CRM for prospecting Chilean workshops (mecánica, motos, bicis, detailing, desabolladura, lubricentro), fed by a Playwright scraper of Google Maps. UI text, comments and data are in Spanish. The project is not a git repo and has no test suite or linter.

## Commands

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium        # once; only the scraper needs it
python run_crm.py                            # full app: server + browser + (tray icon when frozen) on :8000
python -m uvicorn app:app --host 0.0.0.0 --port 8000   # server only (what iniciar_crm.bat does)
python main.py --preset valpo_litoral --rubro motos --max 15 [--visual] [--concurrency 3]   # scraper CLI (also interactive with no args); writes exports/talleres_prospeccion_*.xlsx/csv
python -m PyInstaller MazaCRM.spec --noconfirm   # builds dist/MazaCRM/MazaCRM.exe
```

`--preset` takes the keys of `PRESETS_ZONAS` in `config.py` (e.g. `stgo_sur`, `valpo_gran`), not numbers, despite the argparse help text.

## Architecture

- `app.py` — FastAPI app: REST API under `/api/*`, serves the single-page UI `templates/index.html` (Tailwind/Lucide via CDN, all JS inline in that ~2500-line file), mounts `/static` and `/recordings`. Also holds the background scraping task and its in-memory `scrape_state` (logs, stop event). Scraping runs as an `asyncio` task inside the server's event loop (not a subprocess) so it works inside the frozen .exe; the UI polls `/api/scrape/status`, and stop is cooperative via an `asyncio.Event`.
- `db.py` — all SQLite access (`crm_talleres.db`). Tables: `talleres` (UNIQUE on nombre+comuna), `reuniones`, `onboarding_pasos`, `historial_estados`, `configuracion`. Schema changes are done as "lightweight migrations" in `init_db()` (`ALTER TABLE` wrapped in try/except) — follow that pattern. `historial_estados` feeds the funnel/trend stats; state changes and the 14-day trial start (`iniciar_prueba_si_corresponde`, which seeds onboarding steps) live here.
- `scraper.py` — `WorkshopScraper`: Google Maps scraping with Playwright. `scrape_batch` runs jobs (comuna × rubro × query) concurrently across tabs of one browser context under a semaphore. Deduplication uses `seen_keys` = `"{nombre.lower()}_{comuna.lower()}"`; `db.get_seen_keys()` seeds it so re-scanning known areas skips known workshops. Also contains the Excel/CSV exporters and phone → WhatsApp link helpers. Scraped dicts use Spanish display keys (`"Nombre"`, `"Teléfono"`, `"WhatsApp Link"`…) that `db.save_scraped_workshops` maps to columns.
- `ai_analyzer.py` — visit-report generation (`analyze_meeting`): tries Groq (`GROQ_API_KEY`), then Anthropic (`ANTHROPIC_API_KEY`), then falls back to an offline keyword heuristic. Those SDKs are optional and not in `requirements.txt`. The report drives the taller's `estado` (`estado_desde_resultado` in `app.py`).
- `config.py` — `PRESETS_ZONAS` (regional comuna lists), `RUBROS_MAP` (rubro codes + Maps search queries), `WHATSAPP_TEMPLATES`, `ONBOARDING_STEPS`. Add new regions/rubros/templates here.
- `main.py` — CLI front end to the same scraper (bypasses the UI, still uses `db.get_seen_keys()` but writes exports rather than saving into the DB).
- `run_crm.py` — launcher/entry point for the PyInstaller build.

## Frozen (.exe) gotchas

- Path handling is duplicated in `run_crm.py`, `app.py` and `db.py`: when `sys.frozen`, user data (`crm_talleres.db`, `exports/`, `recordings/`, `maza_crm.log`) lives next to the .exe, while bundled `templates/` and `static/` come from `sys._MEIPASS`. Keep that split when adding files.
- The windowed build has `sys.stdout/stderr = None`, so `run_crm.py` redirects them to `maza_crm.log`; don't remove that or `print()` in the scraper will crash the app.
- `MazaCRM.spec` needs new modules listed in `hiddenimports` and new asset folders in `datas`.
- `build/`, `dist/` and `exports/` are generated artifacts, not source.
