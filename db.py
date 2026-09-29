"""
Capa de datos del CRM de Talleres MAZA, en Firestore (ver nube.py).

Antes era un SQLite local (crm_talleres.db): cada PC tenía su propia base. Ahora
los datos viven en la nube y cualquier PC con `gcloud auth application-default
login` ve lo mismo. `migrar_a_nube.py` sube una base SQLite vieja.

Colecciones (todas `crm*`, cerradas para las apps cliente por las reglas):
  crmTalleres/{id}        un taller; id entero (la UI y la API usan enteros)
  crmClaves/{hash}        unicidad de nombre+comuna (el UNIQUE de SQLite)
  crmReuniones/{id}       visitas y reuniones, con taller_id
  crmHistorial/{auto}     cambios de estado (embudo y tendencias)
  crmOnboarding/{id}      checklist de la prueba de 14 días de cada taller
  crmMeta/contadores      próximos ids enteros de talleres y reuniones

Lecturas: el CRM baja todo una vez al arrancar (init_db) y después escucha los
cambios (on_snapshot), así que un cambio hecho en otro PC llega en segundos y
filtrar, ordenar o contar no cuesta lecturas. Escrituras: van a Firestore y
se aplican también al espejo local en el acto, para que la respuesta de la API
ya las muestre sin esperar al listener.

Las funciones y lo que devuelven son las mismas que en la versión SQLite.
"""

import difflib
import hashlib
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

import nube
from config import ONBOARDING_STEPS

if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent
RECORDINGS_DIR = BASE_DIR / "recordings"

COL_TALLERES = "crmTalleres"
COL_CLAVES = "crmClaves"
COL_REUNIONES = "crmReuniones"
COL_HISTORIAL = "crmHistorial"
COL_ONBOARDING = "crmOnboarding"
DOC_CONTADORES = ("crmMeta", "contadores")

CAMPOS_TALLER = {
    "nombre": "", "rubro": "General", "comuna": "", "direccion": "", "telefono": "",
    "whatsapp_link": "", "calificacion": "", "opiniones": "0", "sitio_web": "",
    "maps_url": "", "estado": "Por consultar", "prioridad": "Media", "interes": 0,
    "encargado_nombre": "", "observaciones": "", "fecha_creacion": None,
    "fecha_ultima_visita": None, "proximo_contacto": None, "fecha_inicio_prueba": "",
    "maza_uid": "",
}
CAMPOS_REUNION = {
    "taller_id": 0, "fecha": "", "tipo": "Presencial", "duracion_segundos": 0,
    "archivo_audio": "", "transcripcion": "", "resumen_ia": "", "notas": "",
    "acuerdos": "", "resultado": "Pendiente",
}


def _ahora() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clave(nombre: str, comuna: str) -> str:
    return hashlib.sha1(f"{nombre}\x00{comuna}".encode("utf-8")).hexdigest()


# ─── Espejo local ─────────────────────────────────────────────────────────────

_lock = threading.RLock()
_talleres: Dict[int, Dict[str, Any]] = {}
_reuniones: Dict[int, Dict[str, Any]] = {}
_historial: Dict[str, Dict[str, Any]] = {}
_onboarding: Dict[int, Dict[str, Any]] = {}
_listeners: list = []
_iniciado = False


def _escuchar(coleccion: str, destino: Dict, clave_de, normalizar):
    listo = threading.Event()

    def al_cambiar(_docs, cambios, _hora):
        with _lock:
            for c in cambios:
                k = clave_de(c.document.id)
                if c.type.name == "REMOVED":
                    destino.pop(k, None)
                else:
                    destino[k] = normalizar(c.document.id, c.document.to_dict() or {})
        listo.set()

    _listeners.append(nube.firestore_db().collection(coleccion).on_snapshot(al_cambiar))
    return listo


def _norm_taller(doc_id: str, d: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": int(doc_id), **{k: d.get(k, v) for k, v in CAMPOS_TALLER.items()}}


def _norm_reunion(doc_id: str, d: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": int(doc_id), **{k: d.get(k, v) for k, v in CAMPOS_REUNION.items()}}


def init_db():
    """Arranca los listeners y espera la primera carga completa. Idempotente."""
    global _iniciado
    with _lock:
        if _iniciado:
            return
        _iniciado = True
    eventos = [
        _escuchar(COL_TALLERES, _talleres, int, _norm_taller),
        _escuchar(COL_REUNIONES, _reuniones, int, _norm_reunion),
        _escuchar(COL_HISTORIAL, _historial, str, lambda i, d: d),
        _escuchar(COL_ONBOARDING, _onboarding, int, lambda i, d: d),
    ]
    for e in eventos:
        if not e.wait(timeout=90):
            raise RuntimeError(
                "No se pudo cargar el CRM desde Firestore (¿sin internet o sin "
                "`gcloud auth application-default login`?)."
            )


def _col(nombre: str):
    return nube.firestore_db().collection(nombre)


def _contadores_ref():
    return nube.firestore_db().collection(DOC_CONTADORES[0]).document(DOC_CONTADORES[1])


def _siguiente_id(campo: str, tx=None) -> int:
    """Id entero correlativo. Dentro de una transacción si se pasa `tx`."""
    from google.cloud import firestore as gcf

    ref = _contadores_ref()
    if tx is not None:
        snap = ref.get(transaction=tx)
        n = int((snap.to_dict() or {}).get(campo, 0)) + 1 if snap.exists else 1
        tx.set(ref, {campo: n}, merge=True)
        return n

    @gcf.transactional
    def _en_tx(t):
        return _siguiente_id(campo, t)

    return _en_tx(nube.firestore_db().transaction())


def _crear_taller(datos: Dict[str, Any]) -> Optional[int]:
    """Alta con unicidad de nombre+comuna garantizada por crmClaves, aunque dos
    PCs rastreen la misma comuna a la vez. Devuelve None si ya existía."""
    from google.cloud import firestore as gcf

    nombre, comuna = datos["nombre"], datos["comuna"]
    clave_ref = _col(COL_CLAVES).document(_clave(nombre, comuna))

    @gcf.transactional
    def _en_tx(tx):
        if clave_ref.get(transaction=tx).exists:
            return None
        nuevo_id = _siguiente_id("talleres", tx)
        doc = {**CAMPOS_TALLER, **datos}
        tx.set(_col(COL_TALLERES).document(str(nuevo_id)), doc)
        tx.set(clave_ref, {"taller_id": nuevo_id, "nombre": nombre, "comuna": comuna})
        return nuevo_id

    nuevo_id = _en_tx(nube.firestore_db().transaction())
    if nuevo_id is not None:
        with _lock:
            _talleres[nuevo_id] = _norm_taller(str(nuevo_id), {**CAMPOS_TALLER, **datos})
    return nuevo_id


def _actualizar_taller_doc(taller_id: int, cambios: Dict[str, Any]) -> None:
    if not cambios:
        return
    _col(COL_TALLERES).document(str(taller_id)).update(cambios)
    with _lock:
        if taller_id in _talleres:
            _talleres[taller_id] = {**_talleres[taller_id], **cambios}


def _buscar_por_nombre_comuna(nombre: str, comuna: str) -> Optional[Dict[str, Any]]:
    with _lock:
        for t in _talleres.values():
            if t["nombre"] == nombre and t["comuna"] == comuna:
                return t
    return None


def _talleres_lista() -> List[Dict[str, Any]]:
    with _lock:
        return [dict(t) for t in _talleres.values()]


# ─── Talleres ─────────────────────────────────────────────────────────────────

def save_scraped_workshops(workshops: List[Dict[str, Any]]) -> int:
    """Inserta o actualiza talleres extraídos por el scraper."""
    if not workshops:
        return 0
    inserted_count = 0
    now = _ahora()

    for w in workshops:
        nombre = w.get("Nombre", "").strip()
        comuna = w.get("Comuna", "").strip()
        if not nombre or not comuna:
            continue
        nuevo = {
            "rubro": w.get("Rubro", "General"),
            "direccion": w.get("Dirección", ""),
            "telefono": w.get("Teléfono", ""),
            "whatsapp_link": w.get("WhatsApp Link", ""),
            "calificacion": w.get("Calificación", ""),
            "opiniones": w.get("Opiniones", "0"),
            "sitio_web": w.get("Sitio Web", ""),
            "maps_url": w.get("Google Maps", ""),
        }

        existente = _buscar_por_nombre_comuna(nombre, comuna)
        if existente is None:
            creado = _crear_taller({
                "nombre": nombre, "comuna": comuna, **nuevo,
                "estado": "Por consultar", "fecha_creacion": now,
            })
            if creado is not None:
                inserted_count += 1
                continue
            existente = _buscar_por_nombre_comuna(nombre, comuna)
            if existente is None:
                continue  # lo creó otro PC recién; llega por el listener

        # Mismo criterio que el ON CONFLICT de SQLite: dirección, teléfono y
        # WhatsApp solo se pisan con un dato real, el resto se refresca.
        cambios = {
            "rubro": nuevo["rubro"],
            "calificacion": nuevo["calificacion"],
            "opiniones": nuevo["opiniones"],
            "maps_url": nuevo["maps_url"],
            "sitio_web": nuevo["sitio_web"],
        }
        if nuevo["direccion"] not in ("", "No especificada"):
            cambios["direccion"] = nuevo["direccion"]
        if nuevo["telefono"] not in ("", "No especificado"):
            cambios["telefono"] = nuevo["telefono"]
        if nuevo["whatsapp_link"] not in ("", "N/A"):
            cambios["whatsapp_link"] = nuevo["whatsapp_link"]
        cambios = {k: v for k, v in cambios.items() if existente.get(k) != v}
        _actualizar_taller_doc(existente["id"], cambios)

    return inserted_count


def get_seen_keys() -> set:
    """Claves nombre+comuna de todos los talleres ya guardados, en el mismo
    formato que usa el scraper para deduplicar. Se usa para sembrar el set de
    'ya vistos' antes de un nuevo rastreo, así re-escanear una comuna ya
    trabajada salta los talleres conocidos en vez de re-procesarlos."""
    init_db()
    return {f"{t['nombre'].lower()}_{t['comuna'].lower()}" for t in _talleres_lista()}


# Columnas ordenables expuestas en la API, mapeadas a su dirección "natural"
# por defecto (ej: fecha -> más reciente primero, nombre -> alfabético).
SORTABLE_COLUMNS = {
    "fecha_creacion": {"column": "fecha_creacion", "default_dir": "desc"},
    "nombre": {"column": "nombre", "default_dir": "asc"},
    "calificacion": {"column": "calificacion", "default_dir": "desc"},
    "proximo_contacto": {"column": "proximo_contacto", "default_dir": "asc"},
}

# Etapas en las que un taller sigue "activo" en el embudo (no cerrado
# positiva ni negativamente). Un seguimiento vencido solo importa en estas.
ESTADOS_ABIERTOS = ("Por consultar", "Contactado", "Interesado", "En prueba 14 días")
ORDEN_ESTADO = {"Por consultar": 1, "Contactado": 2, "Interesado": 3, "En prueba 14 días": 4}


def _dia(valor: Any) -> str:
    """'AAAA-MM-DD' de una fecha guardada como texto (con o sin hora)."""
    return str(valor or "")[:10]


def _seguimiento(t: Dict[str, Any], comparar) -> bool:
    return bool(t.get("proximo_contacto")) and t["estado"] in ESTADOS_ABIERTOS \
        and comparar(_dia(t["proximo_contacto"]), datetime.now().date().isoformat())


def get_talleres(
    estado: Optional[str] = None,
    rubro: Optional[str] = None,
    comuna: Optional[str] = None,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
    order_dir: Optional[str] = None,
    solo_whatsapp: bool = False,
    vencidos: bool = False,
) -> List[Dict[str, Any]]:
    rows = _talleres_lista()

    if estado and estado != "Todos":
        rows = [t for t in rows if t["estado"] == estado]
    if rubro and rubro != "Todos":
        rows = [t for t in rows if t["rubro"] == rubro]
    if comuna and comuna != "Todos":
        rows = [t for t in rows if t["comuna"] == comuna]
    if search:
        s = search.lower()
        rows = [t for t in rows if any(s in str(t.get(k) or "").lower()
                                       for k in ("nombre", "direccion", "observaciones", "encargado_nombre"))]
    if solo_whatsapp:
        rows = [t for t in rows if t["whatsapp_link"] not in ("", "N/A")]
    if vencidos:
        rows = [t for t in rows if _seguimiento(t, lambda d, hoy: d <= hoy)]

    sort_spec = SORTABLE_COLUMNS.get(order_by)
    if sort_spec:
        col = sort_spec["column"]
        desc = (order_dir or sort_spec["default_dir"]).lower() != "asc"
        # Desempate: id más nuevo primero, como el "id DESC" de SQLite.
        rows.sort(key=lambda t: t["id"], reverse=True)
        con_valor = [t for t in rows if t.get(col) not in (None, "")]
        sin_valor = [t for t in rows if t.get(col) in (None, "")]
        con_valor.sort(key=lambda t: str(t[col]), reverse=desc)
        # Los valores vacíos siempre quedan al final, sin importar la dirección.
        rows = con_valor + sin_valor
    else:
        rows.sort(key=lambda t: (ORDEN_ESTADO.get(t["estado"], 5), -t["id"]))
    return rows


def get_taller_by_id(taller_id: int) -> Optional[Dict[str, Any]]:
    with _lock:
        t = _talleres.get(int(taller_id))
        return dict(t) if t else None


def get_vinculos_maza() -> Dict[str, Dict[str, Any]]:
    """{uid de MAZA: taller del CRM} para los talleres ya vinculados."""
    return {
        t["maza_uid"]: {k: t[k] for k in ("id", "nombre", "comuna", "estado")}
        for t in _talleres_lista() if t.get("maza_uid")
    }


def _registrar_estado(taller_id: int, anterior: Optional[str], nuevo: str) -> None:
    fila = {"taller_id": taller_id, "estado_anterior": anterior, "estado_nuevo": nuevo, "fecha": _ahora()}
    ref = _col(COL_HISTORIAL).document()
    ref.set(fila)
    with _lock:
        _historial[ref.id] = fila


def update_taller(taller_id: int, fields: Dict[str, Any]) -> bool:
    allowed = {
        "estado", "prioridad", "interes", "encargado_nombre",
        "observaciones", "telefono", "whatsapp_link", "proximo_contacto", "fecha_ultima_visita",
        "maza_uid",
    }
    cambios = {k: v for k, v in fields.items() if k in allowed}
    actual = get_taller_by_id(taller_id)
    if not cambios or actual is None:
        return False

    _actualizar_taller_doc(taller_id, cambios)

    if "estado" in cambios and actual["estado"] and actual["estado"] != cambios["estado"]:
        _registrar_estado(taller_id, actual["estado"], cambios["estado"])

    if cambios.get("estado") == "En prueba 14 días":
        iniciar_prueba_si_corresponde(taller_id)

    return True


def iniciar_prueba_si_corresponde(taller_id: int) -> None:
    """Marca el día 0 de la prueba de 14 días la primera vez que un taller
    entra a ese estado. Si ya tenía fecha de inicio (ej. volvió a pasar por 'En
    prueba' tras un cambio manual), no la pisa, para no reiniciar el conteo de
    días de una prueba en curso. El checklist no necesita sembrarse: un paso
    sin fila cuenta como pendiente (ver get_onboarding)."""
    t = get_taller_by_id(taller_id)
    if t and not t.get("fecha_inicio_prueba"):
        _actualizar_taller_doc(taller_id, {"fecha_inicio_prueba": _ahora()})


# ─── Onboarding ───────────────────────────────────────────────────────────────

def get_onboarding(taller_id: int) -> List[Dict[str, Any]]:
    """Checklist de onboarding del taller. Los pasos que se agreguen a
    ONBOARDING_STEPS después aparecen solos, como pendientes."""
    with _lock:
        pasos = dict((_onboarding.get(int(taller_id)) or {}).get("pasos") or {})
    return [{
        "key": step["key"],
        "label": step["label"],
        "dia_sugerido": step["dia_sugerido"],
        "completado": bool((pasos.get(step["key"]) or {}).get("completado", False)),
        "fecha_completado": (pasos.get(step["key"]) or {}).get("fecha_completado", ""),
    } for step in ONBOARDING_STEPS]


def set_onboarding_paso(taller_id: int, paso_key: str, completado: bool) -> bool:
    valor = {"completado": bool(completado), "fecha_completado": _ahora() if completado else ""}
    _col(COL_ONBOARDING).document(str(taller_id)).set({"pasos": {paso_key: valor}}, merge=True)
    with _lock:
        doc = _onboarding.setdefault(int(taller_id), {"pasos": {}})
        doc.setdefault("pasos", {})[paso_key] = valor
    return True


# ─── Borrado ──────────────────────────────────────────────────────────────────

def delete_taller(taller_id: int) -> bool:
    taller_id = int(taller_id)
    t = get_taller_by_id(taller_id)
    with _lock:
        reuniones = [r for r in _reuniones.values() if r["taller_id"] == taller_id]
        historial = [k for k, h in _historial.items() if h.get("taller_id") == taller_id]

    db = nube.firestore_db()
    lote = db.batch()
    ops = 0

    def borrar(ref):
        nonlocal lote, ops
        lote.delete(ref)
        ops += 1
        if ops % 400 == 0:  # tope de 500 escrituras por lote
            lote.commit()
            lote = db.batch()

    borrar(_col(COL_TALLERES).document(str(taller_id)))
    borrar(_col(COL_ONBOARDING).document(str(taller_id)))
    if t:
        borrar(_col(COL_CLAVES).document(_clave(t["nombre"], t["comuna"])))
    for r in reuniones:
        borrar(_col(COL_REUNIONES).document(str(r["id"])))
    for k in historial:
        borrar(_col(COL_HISTORIAL).document(k))
    lote.commit()

    with _lock:
        _talleres.pop(taller_id, None)
        _onboarding.pop(taller_id, None)
        for r in reuniones:
            _reuniones.pop(r["id"], None)
        for k in historial:
            _historial.pop(k, None)

    for r in reuniones:
        if r.get("archivo_audio"):
            borrar_audio(Path(r["archivo_audio"]).name)
    return True


# ─── Audios (Storage + copia local) ───────────────────────────────────────────

def _ruta_audio_nube(filename: str) -> str:
    return f"crm/grabaciones/{filename}"


def subir_audio(filename: str) -> None:
    """Sube la grabación a Storage para que la vea cualquier PC. Si falla (sin
    red), queda local y se reintenta la próxima vez que se pida."""
    b = nube.bucket()
    local = RECORDINGS_DIR / filename
    if b is None or not local.exists():
        return
    try:
        b.blob(_ruta_audio_nube(filename)).upload_from_filename(str(local), content_type="audio/webm")
    except Exception:
        pass


def ruta_audio_local(filename: str) -> Optional[Path]:
    """Ruta de la grabación en este PC, bajándola de Storage si hace falta."""
    filename = Path(filename).name
    local = RECORDINGS_DIR / filename
    if local.exists():
        return local
    b = nube.bucket()
    if b is None:
        return None
    blob = b.blob(_ruta_audio_nube(filename))
    try:
        if not blob.exists():
            return None
        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(local))
        return local
    except Exception:
        return None


def borrar_audio(filename: str) -> None:
    filename = Path(filename).name
    try:
        (RECORDINGS_DIR / filename).unlink(missing_ok=True)
    except OSError:
        pass
    b = nube.bucket()
    if b is not None:
        try:
            b.blob(_ruta_audio_nube(filename)).delete()
        except Exception:
            pass


# ─── Reuniones ────────────────────────────────────────────────────────────────

def add_reunion(taller_id: int, data: Dict[str, Any]) -> int:
    now = _ahora()
    reunion_id = _siguiente_id("reuniones")
    fila = {
        "taller_id": int(taller_id),
        "fecha": data.get("fecha", now),
        "tipo": data.get("tipo", "Presencial"),
        "duracion_segundos": data.get("duracion_segundos", 0),
        "archivo_audio": data.get("archivo_audio", ""),
        "transcripcion": data.get("transcripcion", ""),
        "resumen_ia": data.get("resumen_ia", ""),
        "notas": data.get("notas", ""),
        "acuerdos": data.get("acuerdos", ""),
        "resultado": data.get("resultado", "Pendiente"),
    }
    _col(COL_REUNIONES).document(str(reunion_id)).set(fila)
    with _lock:
        _reuniones[reunion_id] = {"id": reunion_id, **fila}

    # Actualizar fecha última visita en taller
    t = get_taller_by_id(taller_id)
    if t:
        cambios = {"fecha_ultima_visita": now}
        if t["estado"] == "Por consultar":
            cambios["estado"] = "Contactado"
        _actualizar_taller_doc(int(taller_id), cambios)
    return reunion_id


def get_reuniones(taller_id: Optional[int] = None) -> List[Dict[str, Any]]:
    with _lock:
        filas = [dict(r) for r in _reuniones.values() if not taller_id or r["taller_id"] == int(taller_id)]
        nombres = {i: t["nombre"] for i, t in _talleres.items()}
    filas = [r for r in filas if r["taller_id"] in nombres]  # el JOIN de SQLite
    for r in filas:
        r["taller_nombre"] = nombres[r["taller_id"]]
    filas.sort(key=lambda r: r["id"], reverse=True)
    return filas


def get_reunion(reunion_id: int) -> Optional[Dict[str, Any]]:
    """Reunión con nombre y rubro de su taller (para regenerar el informe)."""
    with _lock:
        r = _reuniones.get(int(reunion_id))
        t = _talleres.get(r["taller_id"]) if r else None
    if not r or not t:
        return None
    return {**r, "taller_nombre": t["nombre"], "taller_rubro": t["rubro"]}


def update_reunion(reunion_id: int, fields: Dict[str, Any]) -> None:
    _col(COL_REUNIONES).document(str(reunion_id)).update(fields)
    with _lock:
        if int(reunion_id) in _reuniones:
            _reuniones[int(reunion_id)].update(fields)


# ─── Estadísticas ─────────────────────────────────────────────────────────────

def get_stats() -> Dict[str, Any]:
    rows = _talleres_lista()
    por_estado: Dict[str, int] = {}
    for t in rows:
        por_estado[t["estado"]] = por_estado.get(t["estado"], 0) + 1
    with _lock:
        total_reuniones = len(_reuniones)
    return {
        "total": len(rows),
        "por_estado": por_estado,
        "con_whatsapp": sum(1 for t in rows if t["whatsapp_link"] not in ("", "N/A")),
        "total_reuniones": total_reuniones,
        "comunas": sorted({t["comuna"] for t in rows if t["comuna"]}),
        "rubros": sorted({t["rubro"] for t in rows if t["rubro"]}),
        "seguimientos_vencidos": sum(1 for t in rows if _seguimiento(t, lambda d, hoy: d <= hoy)),
        "seguimientos_hoy": sum(1 for t in rows if _seguimiento(t, lambda d, hoy: d == hoy)),
    }


# Orden real del embudo de ventas (de arriba hacia abajo).
FUNNEL_STAGES = ["Por consultar", "Contactado", "Interesado", "En prueba 14 días", "Cliente Activo"]


def get_funnel_stats() -> Dict[str, Any]:
    """Embudo basado en historial real de transiciones (no solo la foto
    actual): cuenta cuántos talleres llegaron ALGUNA VEZ a cada etapa, así un
    taller que avanzó y luego se descartó sigue contando como que sí llegó a
    esa etapa. 'Por consultar' es la base: todo taller nace ahí."""
    total = len(_talleres_lista())
    with _lock:
        historial = list(_historial.values())

    def llegaron(etapa):
        return len({h["taller_id"] for h in historial if h.get("estado_nuevo") == etapa})

    reached = {"Por consultar": total}
    for stage in FUNNEL_STAGES[1:]:
        reached[stage] = llegaron(stage)

    funnel = []
    prev_count = total
    for stage in FUNNEL_STAGES:
        count = reached[stage]
        funnel.append({
            "estado": stage,
            "count": count,
            "pct_total": round(count / total * 100, 1) if total else 0,
            "pct_etapa_anterior": round(count / prev_count * 100, 1) if prev_count else 0
        })
        if count:
            prev_count = count

    return {"funnel": funnel, "total": total, "descartados_en_algun_punto": llegaron("Descartado")}


def get_tendencia_semanal(dias: int = 14) -> List[Dict[str, Any]]:
    """Serie diaria de talleres nuevos y visitas registradas, para ver si el
    ritmo de prospección sube o baja semana a semana."""
    hoy = datetime.now().date()
    desde = (hoy - timedelta(days=dias)).isoformat()
    nuevos: Dict[str, int] = {}
    for t in _talleres_lista():
        d = _dia(t.get("fecha_creacion"))
        if d >= desde:
            nuevos[d] = nuevos.get(d, 0) + 1
    visitas: Dict[str, int] = {}
    with _lock:
        for r in _reuniones.values():
            d = _dia(r.get("fecha"))
            if d >= desde:
                visitas[d] = visitas.get(d, 0) + 1

    serie = []
    for i in range(dias - 1, -1, -1):
        d = (hoy - timedelta(days=i)).isoformat()
        serie.append({"fecha": d, "nuevos": nuevos.get(d, 0), "visitas": visitas.get(d, 0)})
    return serie


def find_possible_duplicates(similitud_minima: float = 0.82) -> List[Dict[str, Any]]:
    """Agrupa talleres que probablemente son el mismo negocio duplicado:
    - Mismo teléfono no vacío en más de un registro (señal fuerte).
    - Nombre muy parecido dentro de la misma comuna (typos, "Ltda" vs sin,
      mayúsculas distintas, etc).
    No se fusiona nada automáticamente: solo se reporta para que el vendedor
    decida cuál registro conservar."""
    rows = [{k: t[k] for k in ("id", "nombre", "comuna", "telefono", "estado")} for t in _talleres_lista()]
    rows.sort(key=lambda r: r["id"])

    grupos = []
    ya_agrupados = set()

    by_phone: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        tel = (r["telefono"] or "").strip()
        if tel and tel != "No especificado":
            by_phone.setdefault(tel, []).append(r)
    for tel, group in by_phone.items():
        if len(group) > 1:
            grupos.append({"motivo": "Mismo teléfono", "detalle": tel, "talleres": group})
            ya_agrupados.update(r["id"] for r in group)

    by_comuna: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        by_comuna.setdefault(r["comuna"], []).append(r)

    for comuna, group in by_comuna.items():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a["id"] in ya_agrupados and b["id"] in ya_agrupados:
                    continue
                ratio = difflib.SequenceMatcher(None, a["nombre"].strip().lower(), b["nombre"].strip().lower()).ratio()
                if ratio >= similitud_minima:
                    grupos.append({"motivo": "Nombre muy similar", "detalle": f"{round(ratio*100)}% de coincidencia", "talleres": [a, b]})
                    ya_agrupados.update([a["id"], b["id"]])

    return grupos


def create_taller_manual(data: Dict[str, Any]) -> Optional[int]:
    """Alta manual de un taller (referido, boca a boca, contacto directo en
    terreno) que no vino del scraper. Reusa la unicidad de nombre+comuna para
    evitar duplicar uno que ya exista."""
    return _crear_taller({
        "nombre": data["nombre"].strip(),
        "rubro": data.get("rubro", "General"),
        "comuna": data["comuna"].strip(),
        "direccion": data.get("direccion", ""),
        "telefono": data.get("telefono", ""),
        "whatsapp_link": data.get("whatsapp_link", ""),
        "estado": "Por consultar",
        "fecha_creacion": _ahora(),
    })
