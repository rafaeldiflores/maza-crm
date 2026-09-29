"""
Servidor Web y API REST FastAPI para MAZA CRM & Prospección en Terreno.
Proporciona la interfaz gráfica, grabación de audio, CRM y ejecución de scraping.
"""

import asyncio
import os
import sys
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, Request, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel

import db
from config import PRESETS_ZONAS, RUBROS_MAP, WHATSAPP_TEMPLATES
from ai_analyzer import analyze_meeting
import maza_rutas

# Inicializar Base de Datos
db.init_db()

app = FastAPI(title="MAZA - CRM & Prospección Regional de Talleres")

# El CRM es solo de este PC: el servidor escucha en 127.0.0.1 (run_crm.py,
# iniciar_crm.*) y no hay CORS, así que ninguna otra página del navegador
# puede leer sus respuestas. TrustedHost corta el DNS rebinding (una página
# ajena que resuelve su dominio a 127.0.0.1 llega con otro Host).
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])


@app.middleware("http")
async def solo_desde_el_crm(request: Request, call_next):
    """Sin CORS una página ajena no lee las respuestas, pero sí puede DISPARAR
    un POST simple (un <form> apuntando a localhost). Toda escritura exige un
    header propio (las páginas del CRM lo agregan en su fetch): un header no
    estándar obliga al navegador a pedir permiso (preflight), y sin CORS ese
    permiso nunca se da."""
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("x-maza-crm") != "1":
            return JSONResponse({"detail": "Falta el header X-Maza-CRM."}, status_code=403)
    return await call_next(request)

if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
    BUNDLE_DIR = Path(getattr(sys, '_MEIPASS', BASE_DIR))
else:
    BASE_DIR = Path(__file__).parent
    BUNDLE_DIR = BASE_DIR

TEMPLATES_DIR = BUNDLE_DIR / "templates"
if not TEMPLATES_DIR.exists():
    TEMPLATES_DIR = BASE_DIR / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = BUNDLE_DIR / "static"
if not STATIC_DIR.exists():
    STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

RECORDINGS_DIR = BASE_DIR / "recordings"
EXPORTS_DIR = BASE_DIR / "exports"

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/recordings", StaticFiles(directory=RECORDINGS_DIR), name="recordings")

# Estado de tarea de scraping en segundo plano
scrape_state = {
    "running": False,
    "logs": [],
    "total_found": 0,
    "stop_event": None,
    "stopping": False
}

class TallerUpdate(BaseModel):
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    interes: Optional[int] = None
    encargado_nombre: Optional[str] = None
    observaciones: Optional[str] = None
    telefono: Optional[str] = None
    whatsapp_link: Optional[str] = None
    proximo_contacto: Optional[str] = None

class ScrapeRequest(BaseModel):
    comunas: List[str]
    rubros: List[str]
    max_per_query: int = 15
    visual: bool = False
    concurrency: int = 3

class TallerCreate(BaseModel):
    nombre: str
    comuna: str
    rubro: str = "General"
    direccion: str = ""
    telefono: str = ""

app.include_router(maza_rutas.router)


@app.get("/cuentas", response_class=HTMLResponse)
async def serve_cuentas():
    with open(TEMPLATES_DIR / "cuentas.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = TEMPLATES_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h1>Error: Plantilla no encontrada</h1>", status_code=500)
    with open(index_file, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/api/presets")
def get_presets():
    return {
        "zonas": PRESETS_ZONAS,
        "rubros": RUBROS_MAP,
        "whatsapp_templates": WHATSAPP_TEMPLATES
    }

@app.get("/api/stats")
def get_stats():
    return db.get_stats()

@app.get("/api/stats/embudo")
def get_embudo():
    return db.get_funnel_stats()

@app.get("/api/stats/tendencia")
def get_tendencia(dias: int = 14):
    return db.get_tendencia_semanal(dias)

@app.get("/api/duplicados")
def get_duplicados():
    return db.find_possible_duplicates()

@app.get("/api/talleres")
def get_talleres(
    estado: Optional[str] = None,
    rubro: Optional[str] = None,
    comuna: Optional[str] = None,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
    order_dir: Optional[str] = None,
    solo_whatsapp: bool = False,
    vencidos: bool = False,
):
    return db.get_talleres(estado, rubro, comuna, search, order_by, order_dir, solo_whatsapp, vencidos)

@app.post("/api/talleres")
def create_taller_endpoint(data: TallerCreate):
    nombre = data.nombre.strip()
    comuna = data.comuna.strip()
    if not nombre or not comuna:
        raise HTTPException(status_code=400, detail="Nombre y comuna son obligatorios")

    telefono_limpio = ""
    whatsapp_link = ""
    if data.telefono:
        from scraper import clean_phone, generate_whatsapp_link
        telefono_limpio = clean_phone(data.telefono) or data.telefono
        whatsapp_link = generate_whatsapp_link(telefono_limpio, nombre) or ""

    new_id = db.create_taller_manual({
        "nombre": nombre,
        "comuna": comuna,
        "rubro": data.rubro,
        "direccion": data.direccion,
        "telefono": telefono_limpio,
        "whatsapp_link": whatsapp_link
    })
    if new_id is None:
        raise HTTPException(status_code=409, detail="Ya existe un taller con ese nombre en esa comuna")

    return {"ok": True, "taller": db.get_taller_by_id(new_id)}

@app.get("/api/talleres/{taller_id}")
def get_taller_detail(taller_id: int):
    taller = db.get_taller_by_id(taller_id)
    if not taller:
        raise HTTPException(status_code=404, detail="Taller no encontrado")
    reuniones = db.get_reuniones(taller_id)
    onboarding = db.get_onboarding(taller_id) if taller["estado"] in ("En prueba 14 días", "Cliente Activo") else []
    return {
        "taller": taller,
        "reuniones": reuniones,
        "onboarding": onboarding
    }

class OnboardingUpdate(BaseModel):
    completado: bool

@app.patch("/api/talleres/{taller_id}/onboarding/{paso_key}")
def update_onboarding_paso(taller_id: int, paso_key: str, data: OnboardingUpdate):
    taller = db.get_taller_by_id(taller_id)
    if not taller:
        raise HTTPException(status_code=404, detail="Taller no encontrado")
    db.set_onboarding_paso(taller_id, paso_key, data.completado)
    return {"ok": True, "onboarding": db.get_onboarding(taller_id)}

@app.patch("/api/talleres/{taller_id}")
def update_taller_endpoint(taller_id: int, data: TallerUpdate):
    fields = {k: v for k, v in data.model_dump().items() if v is not None}

    # Si se actualiza el teléfono y no se envió un whatsapp_link explícito,
    # regenerar el link para que no quede apuntando al número anterior.
    if "telefono" in fields and "whatsapp_link" not in fields:
        taller_actual = db.get_taller_by_id(taller_id)
        nombre_taller = taller_actual["nombre"] if taller_actual else ""
        from scraper import clean_phone, generate_whatsapp_link
        telefono_limpio = clean_phone(fields["telefono"])
        fields["telefono"] = telefono_limpio or fields["telefono"]
        fields["whatsapp_link"] = generate_whatsapp_link(telefono_limpio, nombre_taller) or "N/A"

    success = db.update_taller(taller_id, fields)
    if not success:
        raise HTTPException(status_code=400, detail="No se pudo actualizar el taller")
    return {"ok": True, "taller": db.get_taller_by_id(taller_id)}

@app.delete("/api/talleres/{taller_id}")
def delete_taller_endpoint(taller_id: int):
    db.delete_taller(taller_id)
    return {"ok": True}

def estado_desde_resultado(resultado: str) -> str:
    """Deriva el estado del pipeline a partir del resultado de la visita.
    Centralizado en el backend para que cualquier cliente de la API
    (web, futura app móvil, integraciones) dispare el mismo avance de etapa."""
    if "probar" in resultado or "14" in resultado:
        return "En prueba 14 días"
    if "Interesado" in resultado:
        return "Interesado"
    if "No le interesa" in resultado:
        return "Descartado"
    return "Contactado"

@app.post("/api/reuniones")
async def create_reunion(
    taller_id: int = Form(...),
    tipo: str = Form("Presencial"),
    duracion_segundos: int = Form(0),
    notas: str = Form(""),
    acuerdos: str = Form(""),
    resultado: str = Form("Pendiente"),
    transcripcion: str = Form(""),
    encargado_nombre: str = Form(""),
    proximo_contacto: str = Form(""),
    prioridad: str = Form(""),
    audio_file: Optional[UploadFile] = File(None)
):
    taller = db.get_taller_by_id(taller_id)
    if not taller:
        raise HTTPException(status_code=404, detail="Taller no encontrado")

    archivo_audio_rel = ""
    if audio_file:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"audio_taller_{taller_id}_{timestamp}.webm"
        file_path = RECORDINGS_DIR / filename
        content = await audio_file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        archivo_audio_rel = f"/recordings/{filename}"

    # Generar informe / resumen si hay notas o transcripción
    full_text = f"{notas}\n{transcripcion}".strip()
    ai_report = analyze_meeting(taller["nombre"], taller["rubro"], full_text)

    reunion_data = {
        "tipo": tipo,
        "duracion_segundos": duracion_segundos,
        "archivo_audio": archivo_audio_rel,
        "transcripcion": transcripcion,
        "resumen_ia": ai_report.get("resumen", ""),
        "notas": notas,
        "acuerdos": acuerdos or ai_report.get("proximo_paso", ""),
        "resultado": resultado
    }

    reunion_id = db.add_reunion(taller_id, reunion_data)

    # Avance de etapa del pipeline y datos del contacto, en la misma operación
    # que registra la visita (evita que quede la reunión guardada sin reflejarse
    # en el estado del taller si un segundo request llegara a fallar).
    taller_updates = {"estado": estado_desde_resultado(resultado)}
    if notas:
        taller_updates["observaciones"] = notas
    if encargado_nombre:
        taller_updates["encargado_nombre"] = encargado_nombre
    if proximo_contacto:
        taller_updates["proximo_contacto"] = proximo_contacto
    if prioridad:
        taller_updates["prioridad"] = prioridad
    db.update_taller(taller_id, taller_updates)

    return {
        "ok": True,
        "reunion_id": reunion_id,
        "reporte": ai_report,
        "nuevo_estado": taller_updates["estado"]
    }

@app.post("/api/reuniones/{reunion_id}/generar-informe")
def generar_informe_reunion(reunion_id: int):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT r.*, t.nombre as taller_nombre, t.rubro as taller_rubro FROM reuniones r JOIN talleres t ON r.taller_id = t.id WHERE r.id = ?", (reunion_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Reunión no encontrada")

    reunion = dict(row)
    text = f"{reunion['notas']}\n{reunion['transcripcion']}".strip()
    ai_report = analyze_meeting(reunion["taller_nombre"], reunion["taller_rubro"], text)

    # Actualizar resumen_ia
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE reuniones SET resumen_ia = ? WHERE id = ?", (ai_report.get("resumen", ""), reunion_id))
    conn.commit()
    conn.close()

    return {"ok": True, "reporte": ai_report}

# Lógica de Scraping en segundo plano (directa sin subprocesos para compatibilidad 100% con .exe)
async def run_scraper_async(comunas: List[str], rubros_cods: List[str], max_per_query: int, visual: bool, concurrency: int = 3):
    global scrape_state
    scrape_state["running"] = True
    scrape_state["stopping"] = False
    scrape_state["stop_event"] = asyncio.Event()
    scrape_state["logs"] = [f"Iniciando extracción para: {', '.join(comunas)}"]
    stop_event = scrape_state["stop_event"]

    # Asegurar que Playwright encuentre Chromium en modo compilado .exe o en modo script
    local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser(r"~\AppData\Local"))
    system_browsers = Path(local_appdata) / "ms-playwright"
    bundle_browsers = BASE_DIR / "_internal" / "playwright" / "driver" / "package" / ".local-browsers"

    if bundle_browsers.exists() and any(bundle_browsers.glob("chromium*")):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(bundle_browsers)
    elif system_browsers.exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(system_browsers)

    from playwright.async_api import async_playwright
    from config import BROWSER_CONFIG, RUBROS_MAP
    from scraper import WorkshopScraper

    selected_rubros = [r for r in RUBROS_MAP.values() if r["codigo"] in rubros_cods] if rubros_cods else list(RUBROS_MAP.values())
    scraper = WorkshopScraper(headless=not visual, max_results_per_query=max_per_query, seen_keys=db.get_seen_keys())

    jobs = [
        {"query": query, "rubro_nombre": rubro["nombre"], "comuna": comuna}
        for comuna in comunas
        for rubro in selected_rubros
        for query in rubro["queries"]
    ]
    total_queries = len(jobs)
    done_count = 0
    # Modo visible: una sola pestaña a la vez para no saturar la pantalla de ventanas.
    effective_concurrency = 1 if visual else max(1, min(concurrency, 5))

    async def on_job_done(job, res):
        nonlocal done_count
        done_count += 1
        prefix = f"[{done_count}/{total_queries}] '{job['query']}' en {job['comuna']}"
        if res:
            # Guardar de inmediato en la base de datos SQLite
            cnt = db.save_scraped_workshops(res)
            scrape_state["logs"].append(f"{prefix} -> +{len(res)} talleres ({cnt} nuevos guardados)")
        else:
            scrape_state["logs"].append(f"{prefix} -> sin talleres nuevos (ya conocidos o sin resultados).")
        if len(scrape_state["logs"]) > 50:
            scrape_state["logs"] = scrape_state["logs"][-50:]

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not visual)
            context = await browser.new_context(**BROWSER_CONFIG)

            scrape_state["logs"].append(
                f"Procesando {total_queries} búsquedas con {effective_concurrency} pestañas en paralelo..."
            )
            await scraper.scrape_batch(context, jobs, concurrency=effective_concurrency, on_job_done=on_job_done, stop_event=stop_event)

            await browser.close()

        if scraper.skipped_known_count > 0:
            scrape_state["logs"].append(f"[i] {scraper.skipped_known_count} talleres ya conocidos se saltaron (sin re-procesar).")

        if stop_event.is_set():
            scrape_state["logs"].append("Extracción detenida por el usuario. Lo ya encontrado quedó guardado en el CRM.")

        # Generar respaldo de exportación en Excel y CSV con lo recolectado hasta el momento
        all_talleres = db.get_talleres()
        if all_talleres:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            formatted = []
            for t in all_talleres:
                formatted.append({
                    "Nombre": t["nombre"],
                    "Rubro": t["rubro"],
                    "Comuna": t["comuna"],
                    "Teléfono": t["telefono"],
                    "WhatsApp Link": t["whatsapp_link"],
                    "Dirección": t["direccion"],
                    "Calificación": t["calificacion"],
                    "Opiniones": t["opiniones"],
                    "Sitio Web": t["sitio_web"],
                    "Google Maps": t["maps_url"],
                    "Fecha Extracción": t["fecha_creacion"]
                })
            scraper.export_excel(formatted, EXPORTS_DIR / f"talleres_crm_{ts}.xlsx")
            scraper.export_csv(formatted, EXPORTS_DIR / f"talleres_crm_{ts}.csv")

        if not stop_event.is_set():
            scrape_state["logs"].append("¡Extracción finalizada! Base de datos actualizada.")
    except Exception as e:
        scrape_state["logs"].append(f"Error general: {e}")
    finally:
        scrape_state["running"] = False
        scrape_state["stopping"] = False
        scrape_state["stop_event"] = None

@app.post("/api/scrape/start")
async def start_scraping(req: ScrapeRequest):
    global scrape_state
    if scrape_state["running"]:
        return JSONResponse({"ok": False, "message": "Ya hay una extracción en curso"}, status_code=400)

    # Iniciar tarea asíncrona directamente en el event loop de FastAPI
    asyncio.create_task(run_scraper_async(req.comunas, req.rubros, req.max_per_query, req.visual, req.concurrency))
    return {"ok": True, "message": "Extracción iniciada en segundo plano"}

@app.post("/api/scrape/stop")
def stop_scraping():
    global scrape_state
    if not scrape_state["running"]:
        return JSONResponse({"ok": False, "message": "No hay ninguna extracción en curso"}, status_code=400)
    if scrape_state["stop_event"]:
        scrape_state["stop_event"].set()
    scrape_state["stopping"] = True
    scrape_state["logs"].append("[!] Deteniendo extracción... se cerrará al terminar las fichas ya abiertas.")
    return {"ok": True, "message": "Deteniendo extracción..."}

@app.get("/api/scrape/status")
def get_scrape_status():
    global scrape_state
    return {
        "running": scrape_state["running"],
        "stopping": scrape_state["stopping"],
        "logs": scrape_state["logs"][-15:]
    }

@app.get("/api/export/excel")
def export_excel_all():
    from scraper import WorkshopScraper
    talleres = db.get_talleres()
    if not talleres:
        raise HTTPException(status_code=400, detail="No hay talleres para exportar")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = EXPORTS_DIR / f"crm_talleres_export_{timestamp}.xlsx"
    
    # Formatear para export_excel
    formatted = []
    for t in talleres:
        formatted.append({
            "Nombre": t["nombre"],
            "Rubro": t["rubro"],
            "Comuna": t["comuna"],
            "Teléfono": t["telefono"],
            "WhatsApp Link": t["whatsapp_link"],
            "Dirección": t["direccion"],
            "Calificación": t["calificacion"],
            "Opiniones": t["opiniones"],
            "Sitio Web": t["sitio_web"],
            "Google Maps": t["maps_url"],
            "Fecha Extracción": t["fecha_creacion"]
        })

    scraper = WorkshopScraper()
    scraper.export_excel(formatted, filepath)
    return FileResponse(filepath, filename=filepath.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*60)
    print(" INICIANDO PANEL CRM & SCRAPER REGIONAL MAZA")
    print(" Abre en tu navegador: http://localhost:8000")
    print("="*60 + "\n")
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
