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
import ajustes
import maza_admin
import maza_rutas

# Cargar el CRM desde Firestore (ver db.py). Si no hay red o credenciales, el
# servidor arranca igual y /api responde 503 con el motivo, que index.html
# muestra en un aviso: con un .exe sin consola no habría otra forma de verlo.
ERROR_INICIO: Optional[str] = None
try:
    db.init_db()
except Exception as e:  # noqa: BLE001
    ERROR_INICIO = str(e)

app = FastAPI(title="MAZA - CRM & Prospección Regional de Talleres")

# El CRM es solo de este PC: el servidor escucha en 127.0.0.1 (run_crm.py,
# iniciar_crm.*) y no hay CORS, así que ninguna otra página del navegador
# puede leer sus respuestas. TrustedHost corta el DNS rebinding (una página
# ajena que resuelve su dominio a 127.0.0.1 llega con otro Host).
# En Cloud Run, CRM_HOSTS agrega el dominio del servicio (ej. "*.run.app").
HOSTS = ["localhost", "127.0.0.1"] + [h.strip() for h in os.environ.get("CRM_HOSTS", "").split(",") if h.strip()]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=HOSTS)

# Detrás de IAP (Cloud Run): IAP autentica con Google antes de llegar acá y
# firma cada request. Se verifica la firma igual (defensa en profundidad: si
# alguien llegara al servicio sin pasar por IAP, no trae un JWT válido).
# IAP_AUDIENCIA = "/projects/<número>/locations/<región>/services/<servicio>".
IAP_AUDIENCIA = os.environ.get("IAP_AUDIENCIA")
# Solo estos correos gestionan cuentas de MAZA (/api/maza, /cuentas). El resto
# de quienes pasen IAP (vendedores) usan el CRM de prospección.
ADMINS = {e.strip().lower() for e in os.environ.get("CRM_ADMINS", "").split(",") if e.strip()}


def _usuario_iap(request: Request) -> Optional[str]:
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token
    token = request.headers.get("x-goog-iap-jwt-assertion")
    if not token:
        return None
    try:
        claims = id_token.verify_token(token, grequests.Request(), audience=IAP_AUDIENCIA,
                                       certs_url="https://www.gstatic.com/iap/verify/public_key")
        return (claims.get("email") or "").lower() or None
    except Exception:
        return None


@app.middleware("http")
async def solo_desde_el_crm(request: Request, call_next):
    """Sin CORS una página ajena no lee las respuestas, pero sí puede DISPARAR
    un POST simple (un <form> apuntando a localhost). Toda escritura exige un
    header propio (las páginas del CRM lo agregan en su fetch): un header no
    estándar obliga al navegador a pedir permiso (preflight), y sin CORS ese
    permiso nunca se da."""
    if IAP_AUDIENCIA:
        email = _usuario_iap(request)
        if not email:
            return JSONResponse({"detail": "Sesión no válida."}, status_code=401)
        maza_admin.USUARIO.set(email)
        ruta = request.url.path
        if (ruta.startswith("/api/maza") or ruta == "/cuentas") and email not in ADMINS:
            return JSONResponse({"detail": "Solo administradores."}, status_code=403)
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("x-maza-crm") != "1":
            return JSONResponse({"detail": "Falta el header X-Maza-CRM."}, status_code=403)
    if ERROR_INICIO and request.url.path.startswith("/api/") and request.url.path != "/api/salud":
        return JSONResponse({"detail": ERROR_INICIO}, status_code=503)
    return await call_next(request)


@app.get("/api/salud")
def salud():
    email = maza_admin.USUARIO.get()
    return {"ok": ERROR_INICIO is None, "error": ERROR_INICIO, "usuario": email,
            "admin": not IAP_AUDIENCIA or email in ADMINS}

if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
    BUNDLE_DIR = Path(getattr(sys, '_MEIPASS', BASE_DIR))
else:
    BASE_DIR = Path(__file__).parent
    BUNDLE_DIR = BASE_DIR

STATIC_DIR = BUNDLE_DIR / "static"
if not STATIC_DIR.exists():
    STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

RECORDINGS_DIR = db.RECORDINGS_DIR
EXPORTS_DIR = BASE_DIR / "exports"

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/recordings/{filename}")
def servir_grabacion(filename: str):
    """La grabación desde este PC o, si se grabó en otro, bajada de Storage."""
    ruta = db.ruta_audio_local(filename)
    if ruta is None:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    return FileResponse(ruta, media_type="audio/webm")

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
    evaluar_ia: bool = True

class TallerCreate(BaseModel):
    nombre: str
    comuna: str
    rubro: str = "General"
    direccion: str = ""
    telefono: str = ""

app.include_router(maza_rutas.router)


class RutaPedido(BaseModel):
    lat: float
    lng: float
    ids: List[int]
    volver: bool = True


@app.post("/api/ruta/optimizar")
def optimizar_ruta(p: RutaPedido):
    """Ordena los talleres elegidos para recorrer menos km desde la ubicación
    del vendedor. Devuelve los ids en orden + distancia y tiempo estimados."""
    import places
    talleres = [t for t in (db.get_taller_by_id(i) for i in p.ids) if t and t.get("direccion") and t["direccion"] != "No especificada"]
    if len(talleres) < 2:
        raise HTTPException(status_code=400, detail="Elige al menos 2 talleres con dirección.")
    if len(talleres) > 25:
        raise HTTPException(status_code=400, detail="Máximo 25 paradas por ruta.")
    try:
        r = places.optimizar_ruta({"lat": p.lat, "lng": p.lng}, [f"{t['direccion']}, {t['comuna']}, Chile" for t in talleres], p.volver)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"No se pudo optimizar: {e}")
    return {"ids": [talleres[i]["id"] for i in r["orden"]], "coords": r["coords"], "km": round(r["metros"] / 1000, 1), "minutos": round(r["segundos"] / 60)}


@app.post("/api/talleres/{taller_id}/visita-rapida")
def visita_rapida(taller_id: int):
    """Marca la visita desde la ruta en curso: deja registro y pasa el taller a
    Contactado si estaba por visitar (lo hace db.add_reunion)."""
    if not db.get_taller_by_id(taller_id):
        raise HTTPException(status_code=404, detail="Taller no encontrado")
    db.add_reunion(taller_id, {"tipo": "Visita en ruta", "resultado": "Pendiente", "notas": "Visitado desde la ruta del día."})
    return {"ok": True, "taller": db.get_taller_by_id(taller_id)}


@app.get("/api/config")
def leer_config():
    return ajustes.leer()


@app.put("/api/config")
def guardar_config(nueva: Dict[str, Any], request: Request):
    if IAP_AUDIENCIA and maza_admin.USUARIO.get() not in ADMINS:
        raise HTTPException(status_code=403, detail="Solo administradores.")
    return ajustes.guardar(nueva)


@app.get("/api/presets")
def get_presets():
    return {
        "zonas": PRESETS_ZONAS,
        "rubros": RUBROS_MAP,
        "whatsapp_templates": ajustes.leer()["plantillas"]
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
    background: BackgroundTasks,
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
    audio_file: Optional[UploadFile] = File(None),
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
        # A Storage en segundo plano: la visita se guarda sin esperar la subida.
        background.add_task(db.subir_audio, filename)

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
    reunion = db.get_reunion(reunion_id)
    if not reunion:
        raise HTTPException(status_code=404, detail="Reunión no encontrada")

    text = f"{reunion['notas']}\n{reunion['transcripcion']}".strip()
    ai_report = analyze_meeting(reunion["taller_nombre"], reunion["taller_rubro"], text)

    db.update_reunion(reunion_id, {"resumen_ia": ai_report.get("resumen", "")})

    return {"ok": True, "reporte": ai_report}

# Lógica de Scraping en segundo plano (directa sin subprocesos para compatibilidad 100% con .exe)
async def run_scraper_async(comunas: List[str], rubros_cods: List[str], max_per_query: int, evaluar_ia: bool = True):
    """Rastreo con Places API (places.py): sin navegador, corre en Cloud Run.
    Cada resultado se guarda al tiro; los talleres NUEVOS se evalúan con IA
    (reseñas + Gemini) para ordenarlos por prioridad de contacto."""
    import places
    from config import RUBROS_MAP

    scrape_state.update(running=True, stopping=False, stop_event=asyncio.Event(),
                        logs=[f"Buscando en: {', '.join(comunas)}"])
    stop_event = scrape_state["stop_event"]
    seleccion = [r for r in RUBROS_MAP.values() if r["codigo"] in rubros_cods] if rubros_cods else list(RUBROS_MAP.values())
    jobs = [(c, r, q) for c in comunas for r in seleccion for q in r["queries"]]
    nuevos_ids: List[int] = []

    def log(msg):
        scrape_state["logs"] = (scrape_state["logs"] + [msg])[-50:]

    try:
        for n, (comuna, rubro, consulta) in enumerate(jobs, 1):
            if stop_event.is_set():
                break
            antes = set(t["id"] for t in db.get_talleres())
            res = await asyncio.to_thread(lambda: [{**x, "Rubro": rubro["nombre"]} for x in places.buscar(consulta, comuna, max_per_query)])
            cnt = await asyncio.to_thread(db.save_scraped_workshops, res)
            nuevos_ids += [t["id"] for t in db.get_talleres() if t["id"] not in antes]
            log(f"[{n}/{len(jobs)}] '{consulta}' en {comuna} -> {len(res)} talleres ({cnt} nuevos)")

        if evaluar_ia and nuevos_ids and not stop_event.is_set():
            log(f"Evaluando {len(nuevos_ids)} talleres nuevos con IA...")
            for k, tid in enumerate(nuevos_ids[:80], 1):
                if stop_event.is_set():
                    break
                try:
                    await asyncio.to_thread(evaluar_taller_ia, tid)
                except Exception as e:  # noqa: BLE001 — uno que falla no corta el resto
                    log(f"IA: no se pudo evaluar el taller {tid}: {e}")
                if k % 10 == 0:
                    log(f"IA: {k}/{min(len(nuevos_ids), 80)} evaluados")

        log("Detenido: lo encontrado quedó guardado." if stop_event.is_set() else "¡Listo! Ordena por «Prioridad IA» para ver a quién llamar primero.")
    except Exception as e:
        log(f"Error general: {e}")
    finally:
        scrape_state["running"] = False


def evaluar_taller_ia(taller_id: int) -> dict:
    import places
    import ia_prospectos
    t = db.get_taller_by_id(taller_id)
    if not t:
        raise HTTPException(status_code=404, detail="Taller no encontrado")
    if not t.get("place_id"):
        raise HTTPException(status_code=400, detail="Este taller no viene de Google Maps (sin place_id)")
    datos = ia_prospectos.evaluar(t, places.detalle(t["place_id"]))
    db.guardar_evaluacion_ia(taller_id, datos)
    return datos


@app.post("/api/talleres/{taller_id}/evaluar-ia")
def evaluar_ia_endpoint(taller_id: int):
    try:
        return {"ok": True, "evaluacion": evaluar_taller_ia(taller_id), "taller": db.get_taller_by_id(taller_id)}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"No se pudo evaluar: {e}")


@app.post("/api/scrape/start")
async def start_scraping(req: ScrapeRequest):
    global scrape_state
    if scrape_state["running"]:
        return JSONResponse({"ok": False, "message": "Ya hay una extracción en curso"}, status_code=400)

    # Iniciar tarea asíncrona directamente en el event loop de FastAPI
    asyncio.create_task(run_scraper_async(req.comunas, req.rubros, min(max(req.max_per_query, 1), 60), req.evaluar_ia))
    return {"ok": True, "message": "Extracción iniciada en segundo plano"}

@app.post("/api/scrape/stop")
def stop_scraping():
    global scrape_state
    if not scrape_state["running"]:
        return JSONResponse({"ok": False, "message": "No hay ninguna extracción en curso"}, status_code=400)
    if scrape_state["stop_event"]:
        scrape_state["stop_event"].set()
    scrape_state["stopping"] = True
    scrape_state["logs"].append("[!] Deteniendo... termina la búsqueda en curso.")
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


# ─── Interfaz (Angular) ───────────────────────────────────────────────────────
# El build de frontend/ (en Docker, /app/web). Cualquier ruta que no sea /api
# ni un archivo existente devuelve index.html: el router de Angular la resuelve.
# index.html y el service worker van sin caché para que un deploy llegue al tiro.
WEB_DIR = Path(os.environ.get("CRM_WEB_DIR", BASE_DIR / "frontend" / "dist" / "frontend" / "browser"))
SIN_CACHE = {"index.html", "ngsw.json", "ngsw-worker.js", "manifest.webmanifest"}


@app.get("/{ruta:path}", include_in_schema=False)
def interfaz(ruta: str):
    if ruta.startswith("api/"):
        raise HTTPException(status_code=404)
    archivo = (WEB_DIR / ruta).resolve()
    if ruta and archivo.is_file() and WEB_DIR.resolve() in archivo.parents:
        headers = {"Cache-Control": "no-cache"} if archivo.name in SIN_CACHE else {"Cache-Control": "public, max-age=31536000, immutable"}
        return FileResponse(archivo, headers=headers)
    indice = WEB_DIR / "index.html"
    if not indice.exists():
        raise HTTPException(status_code=503, detail="Falta el build de la interfaz (cd frontend && npx ng build)")
    return FileResponse(indice, headers={"Cache-Control": "no-cache"})
