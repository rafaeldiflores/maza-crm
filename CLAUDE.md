# CLAUDE.md

MAZA CRM: prospección de talleres y back office de MAZA (planes, cuentas, cobros, soporte). Web en Cloud Run detrás de IAP, instalable como PWA. Textos, código y datos en español neutro (sin voseo).

## Arquitectura

- `frontend/` — Angular 22 (standalone, signals, OnPush, `@if/@for`, Tailwind v4, `@angular/pwa`). Rutas: `/prospectos`, `/hoy`, `/cuentas`, `/cobros`, `/metricas`, `/soporte`, `/errores`, `/auditoria`. `core/api.ts` concentra las llamadas y el interceptor (header `X-Maza-CRM`, recarga si IAP venció).
- `app.py` — FastAPI: API `/api/*` y, al final, el catch-all que sirve el build de Angular (`CRM_WEB_DIR`). Middlewares: TrustedHost (`CRM_HOSTS`), verificación del JWT de IAP (`IAP_AUDIENCIA`), rol admin (`CRM_ADMINS`) para `/api/maza/*`, y `X-Maza-CRM` obligatorio en escrituras.
- `db.py` — datos del CRM en Firestore (`crm*`) con espejo en memoria por `on_snapshot`; por eso **una sola instancia** en Cloud Run (`--max-instances 1`).
- `places.py` — rastreo con Places API (New), sin navegador. `ia_prospectos.py` — puntaje/dolores/mensaje con Gemini (Vertex). `ai_analyzer.py` — informe de visita (Gemini primero).
- `maza_admin.py` + `maza_rutas.py` — Cuentas MAZA con firebase-admin; toda escritura se audita en `adminAuditoria`. Las reglas de Maza-app cierran `crm*` y `adminAuditoria` a los clientes.
- `nube.py` — init de Firebase; `MAZA_EMULADOR=1` usa el emulador (Places y Vertex siempre van al proyecto real).
- `scraper.py` — solo utilidades (teléfono, link de WhatsApp, export Excel/CSV); la clase Playwright es legado.

## Desarrollo local

```powershell
# API contra el emulador de Firebase de Maza-app (npm run emulators + npm run sembrar allá)
$env:MAZA_EMULADOR='1'; $env:CRM_SIN_VERTEX='1'; .venv\Scripts\python -m uvicorn app:app --port 8000
cd frontend; npx ng serve          # proxy de /api y /recordings a :8000
```

## Deploy

```powershell
gcloud beta run deploy crm-maza --source . --region southamerica-west1 --project litoralbikes-7d29d
```
El Dockerfile compila Angular y lo copia a `/app/web`. Servicio con cuenta `crm-maza@`, IAP con cliente OAuth propio (el proyecto no tiene organización), una instancia, CPU siempre asignada (el rastreo corre en segundo plano).
