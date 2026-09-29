"""
Capa de base de datos SQLite para el CRM de Talleres MAZA.
Gestiona el catálogo de talleres, estados de prospección, notas, grabaciones e informes.
"""

import difflib
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from config import ONBOARDING_STEPS

if getattr(sys, 'frozen', False):
    DB_PATH = Path(sys.executable).parent / "crm_talleres.db"
else:
    DB_PATH = Path(__file__).parent / "crm_talleres.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    """Inicializa las tablas del CRM si no existen."""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS talleres (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        rubro TEXT NOT NULL,
        comuna TEXT NOT NULL,
        direccion TEXT DEFAULT '',
        telefono TEXT DEFAULT '',
        whatsapp_link TEXT DEFAULT '',
        calificacion TEXT DEFAULT '',
        opiniones TEXT DEFAULT '0',
        sitio_web TEXT DEFAULT '',
        maps_url TEXT DEFAULT '',
        estado TEXT DEFAULT 'Por consultar',
        prioridad TEXT DEFAULT 'Media',
        interes INTEGER DEFAULT 0,
        encargado_nombre TEXT DEFAULT '',
        observaciones TEXT DEFAULT '',
        fecha_creacion TEXT,
        fecha_ultima_visita TEXT,
        proximo_contacto TEXT,
        fecha_inicio_prueba TEXT DEFAULT '',
        UNIQUE(nombre, comuna)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reuniones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taller_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        tipo TEXT DEFAULT 'Presencial',
        duracion_segundos INTEGER DEFAULT 0,
        archivo_audio TEXT DEFAULT '',
        transcripcion TEXT DEFAULT '',
        resumen_ia TEXT DEFAULT '',
        notas TEXT DEFAULT '',
        acuerdos TEXT DEFAULT '',
        resultado TEXT DEFAULT 'Pendiente',
        FOREIGN KEY(taller_id) REFERENCES talleres(id) ON DELETE CASCADE
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS onboarding_pasos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taller_id INTEGER NOT NULL,
        paso_key TEXT NOT NULL,
        completado INTEGER DEFAULT 0,
        fecha_completado TEXT DEFAULT '',
        UNIQUE(taller_id, paso_key),
        FOREIGN KEY(taller_id) REFERENCES talleres(id) ON DELETE CASCADE
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS configuracion (
        clave TEXT PRIMARY KEY,
        valor TEXT
    )
    """)

    # Historial de cambios de estado: permite calcular un embudo de conversión
    # real (cuántos talleres llegaron alguna vez a cada etapa) en vez de solo
    # la foto actual, y tendencias por fecha.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS historial_estados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taller_id INTEGER NOT NULL,
        estado_anterior TEXT,
        estado_nuevo TEXT NOT NULL,
        fecha TEXT NOT NULL,
        FOREIGN KEY(taller_id) REFERENCES talleres(id) ON DELETE CASCADE
    )
    """)

    # Migración liviana para bases de datos creadas antes de este campo.
    try:
        cursor.execute("ALTER TABLE talleres ADD COLUMN fecha_inicio_prueba TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()

def save_scraped_workshops(workshops: List[Dict[str, Any]]) -> int:
    """Inserta o actualiza talleres extraídos por el scraper."""
    if not workshops:
        return 0
    conn = get_db()
    cursor = conn.cursor()
    inserted_count = 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for w in workshops:
        nombre = w.get("Nombre", "").strip()
        comuna = w.get("Comuna", "").strip()
        if not nombre or not comuna:
            continue

        cursor.execute("SELECT id FROM talleres WHERE nombre = ? AND comuna = ?", (nombre, comuna))
        already_existed = cursor.fetchone() is not None

        cursor.execute("""
        INSERT INTO talleres (
            nombre, rubro, comuna, direccion, telefono, whatsapp_link,
            calificacion, opiniones, sitio_web, maps_url, estado, fecha_creacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Por consultar', ?)
        ON CONFLICT(nombre, comuna) DO UPDATE SET
            rubro = excluded.rubro,
            direccion = CASE WHEN excluded.direccion != 'No especificada' AND excluded.direccion != '' THEN excluded.direccion ELSE talleres.direccion END,
            telefono = CASE WHEN excluded.telefono != 'No especificado' AND excluded.telefono != '' THEN excluded.telefono ELSE talleres.telefono END,
            whatsapp_link = CASE WHEN excluded.whatsapp_link != 'N/A' AND excluded.whatsapp_link != '' THEN excluded.whatsapp_link ELSE talleres.whatsapp_link END,
            calificacion = excluded.calificacion,
            opiniones = excluded.opiniones,
            maps_url = excluded.maps_url,
            sitio_web = excluded.sitio_web
        """, (
            nombre,
            w.get("Rubro", "General"),
            comuna,
            w.get("Dirección", ""),
            w.get("Teléfono", ""),
            w.get("WhatsApp Link", ""),
            w.get("Calificación", ""),
            w.get("Opiniones", "0"),
            w.get("Sitio Web", ""),
            w.get("Google Maps", ""),
            now
        ))
        if not already_existed:
            inserted_count += 1

    conn.commit()
    conn.close()
    return inserted_count

def get_seen_keys() -> set:
    """Claves nombre+comuna de todos los talleres ya guardados, en el mismo
    formato que usa el scraper para deduplicar. Se usa para sembrar el set de
    'ya vistos' antes de un nuevo rastreo, así re-escanear una comuna ya
    trabajada salta los talleres conocidos en vez de re-procesarlos."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT nombre, comuna FROM talleres")
    rows = cursor.fetchall()
    conn.close()
    return {f"{r[0].lower()}_{r[1].lower()}" for r in rows}

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
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM talleres WHERE 1=1"
    params = []

    if estado and estado != "Todos":
        query += " AND estado = ?"
        params.append(estado)
    if rubro and rubro != "Todos":
        query += " AND rubro = ?"
        params.append(rubro)
    if comuna and comuna != "Todos":
        query += " AND comuna = ?"
        params.append(comuna)
    if search:
        query += " AND (nombre LIKE ? OR direccion LIKE ? OR observaciones LIKE ? OR encargado_nombre LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s, s])
    if solo_whatsapp:
        query += " AND whatsapp_link != '' AND whatsapp_link != 'N/A'"
    if vencidos:
        placeholders = ",".join("?" for _ in ESTADOS_ABIERTOS)
        query += f" AND proximo_contacto != '' AND date(proximo_contacto) <= date('now','localtime') AND estado IN ({placeholders})"
        params.extend(ESTADOS_ABIERTOS)

    sort_spec = SORTABLE_COLUMNS.get(order_by)
    if sort_spec:
        col = sort_spec["column"]
        direction = (order_dir or sort_spec["default_dir"]).lower()
        direction = "ASC" if direction == "asc" else "DESC"
        # Los valores vacíos siempre quedan al final, sin importar la dirección
        # elegida (ej: talleres sin "próximo contacto" agendado no deberían
        # aparecer primero solo porque '' ordena antes alfabéticamente).
        query += f" ORDER BY (CASE WHEN {col} IS NULL OR {col} = '' THEN 1 ELSE 0 END), {col} {direction}, id DESC"
    else:
        query += " ORDER BY CASE estado WHEN 'Por consultar' THEN 1 WHEN 'Contactado' THEN 2 WHEN 'Interesado' THEN 3 WHEN 'En prueba 14 días' THEN 4 ELSE 5 END, id DESC"

    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_taller_by_id(taller_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM talleres WHERE id = ?", (taller_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def update_taller(taller_id: int, fields: Dict[str, Any]) -> bool:
    allowed = {
        "estado", "prioridad", "interes", "encargado_nombre",
        "observaciones", "telefono", "whatsapp_link", "proximo_contacto", "fecha_ultima_visita"
    }
    updates = []
    params = []
    for k, v in fields.items():
        if k in allowed:
            updates.append(f"{k} = ?")
            params.append(v)

    if not updates:
        return False

    params.append(taller_id)
    conn = get_db()
    cursor = conn.cursor()

    estado_anterior = None
    if "estado" in fields:
        cursor.execute("SELECT estado FROM talleres WHERE id = ?", (taller_id,))
        row = cursor.fetchone()
        estado_anterior = row["estado"] if row else None

    cursor.execute(f"UPDATE talleres SET {', '.join(updates)} WHERE id = ?", params)

    if "estado" in fields and estado_anterior and estado_anterior != fields["estado"]:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            "INSERT INTO historial_estados (taller_id, estado_anterior, estado_nuevo, fecha) VALUES (?, ?, ?, ?)",
            (taller_id, estado_anterior, fields["estado"], now)
        )

    conn.commit()
    conn.close()

    if fields.get("estado") == "En prueba 14 días":
        iniciar_prueba_si_corresponde(taller_id)

    return True

def iniciar_prueba_si_corresponde(taller_id: int) -> None:
    """Marca el día 0 de la prueba de 14 días y siembra el checklist de
    onboarding la primera vez que un taller entra a ese estado. Si ya tenía
    fecha de inicio (ej. volvió a pasar por 'En prueba' tras un cambio manual),
    no la pisa, para no reiniciar el conteo de días de una prueba en curso."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT fecha_inicio_prueba FROM talleres WHERE id = ?", (taller_id,))
    row = cursor.fetchone()
    if row is None:
        conn.close()
        return

    if not row["fecha_inicio_prueba"]:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("UPDATE talleres SET fecha_inicio_prueba = ? WHERE id = ?", (now, taller_id))

    for step in ONBOARDING_STEPS:
        cursor.execute(
            "INSERT OR IGNORE INTO onboarding_pasos (taller_id, paso_key, completado, fecha_completado) VALUES (?, ?, 0, '')",
            (taller_id, step["key"])
        )

    conn.commit()
    conn.close()

def get_onboarding(taller_id: int) -> List[Dict[str, Any]]:
    """Devuelve el checklist de onboarding del taller, creando cualquier paso
    que falte (ej. si se agregó un nuevo paso a ONBOARDING_STEPS después de que
    el taller ya había entrado a prueba)."""
    conn = get_db()
    cursor = conn.cursor()
    for step in ONBOARDING_STEPS:
        cursor.execute(
            "INSERT OR IGNORE INTO onboarding_pasos (taller_id, paso_key, completado, fecha_completado) VALUES (?, ?, 0, '')",
            (taller_id, step["key"])
        )
    conn.commit()

    cursor.execute("SELECT paso_key, completado, fecha_completado FROM onboarding_pasos WHERE taller_id = ?", (taller_id,))
    saved = {r["paso_key"]: dict(r) for r in cursor.fetchall()}
    conn.close()

    result = []
    for step in ONBOARDING_STEPS:
        saved_row = saved.get(step["key"], {})
        result.append({
            "key": step["key"],
            "label": step["label"],
            "dia_sugerido": step["dia_sugerido"],
            "completado": bool(saved_row.get("completado", 0)),
            "fecha_completado": saved_row.get("fecha_completado", "")
        })
    return result

def set_onboarding_paso(taller_id: int, paso_key: str, completado: bool) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if completado else ""
    cursor.execute(
        """INSERT INTO onboarding_pasos (taller_id, paso_key, completado, fecha_completado)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(taller_id, paso_key) DO UPDATE SET completado = excluded.completado, fecha_completado = excluded.fecha_completado""",
        (taller_id, paso_key, 1 if completado else 0, now)
    )
    conn.commit()
    conn.close()
    return True

def delete_taller(taller_id: int) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT archivo_audio FROM reuniones WHERE taller_id = ? AND archivo_audio != ''", (taller_id,))
    audio_files = [r[0] for r in cursor.fetchall()]

    cursor.execute("DELETE FROM talleres WHERE id = ?", (taller_id,))
    conn.commit()
    conn.close()

    recordings_dir = DB_PATH.parent / "recordings"
    for rel_path in audio_files:
        filename = Path(rel_path).name
        file_path = recordings_dir / filename
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass

    return True

def add_reunion(taller_id: int, data: Dict[str, Any]) -> int:
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    cursor.execute("""
    INSERT INTO reuniones (
        taller_id, fecha, tipo, duracion_segundos, archivo_audio, 
        transcripcion, resumen_ia, notas, acuerdos, resultado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        taller_id,
        data.get("fecha", now),
        data.get("tipo", "Presencial"),
        data.get("duracion_segundos", 0),
        data.get("archivo_audio", ""),
        data.get("transcripcion", ""),
        data.get("resumen_ia", ""),
        data.get("notas", ""),
        data.get("acuerdos", ""),
        data.get("resultado", "Pendiente")
    ))
    reunion_id = cursor.lastrowid
    
    # Actualizar fecha última visita en taller
    cursor.execute("UPDATE talleres SET fecha_ultima_visita = ?, estado = CASE WHEN estado = 'Por consultar' THEN 'Contactado' ELSE estado END WHERE id = ?", (now, taller_id))
    
    conn.commit()
    conn.close()
    return reunion_id

def get_reuniones(taller_id: Optional[int] = None) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    if taller_id:
        cursor.execute("SELECT r.*, t.nombre as taller_nombre FROM reuniones r JOIN talleres t ON r.taller_id = t.id WHERE r.taller_id = ? ORDER BY r.id DESC", (taller_id,))
    else:
        cursor.execute("SELECT r.*, t.nombre as taller_nombre FROM reuniones r JOIN talleres t ON r.taller_id = t.id ORDER BY r.id DESC", ())
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_stats() -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM talleres")
    total = cursor.fetchone()[0]
    
    cursor.execute("SELECT estado, COUNT(*) FROM talleres GROUP BY estado")
    por_estado = dict(cursor.fetchall())
    
    cursor.execute("SELECT COUNT(*) FROM talleres WHERE whatsapp_link != 'N/A' AND whatsapp_link != ''")
    con_whatsapp = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM reuniones")
    total_reuniones = cursor.fetchone()[0]
    
    cursor.execute("SELECT DISTINCT comuna FROM talleres ORDER BY comuna")
    comunas = [r[0] for r in cursor.fetchall() if r[0]]
    
    cursor.execute("SELECT DISTINCT rubro FROM talleres ORDER BY rubro")
    rubros = [r[0] for r in cursor.fetchall() if r[0]]

    placeholders = ",".join("?" for _ in ESTADOS_ABIERTOS)
    cursor.execute(
        f"""SELECT COUNT(*) FROM talleres
            WHERE proximo_contacto != '' AND date(proximo_contacto) <= date('now','localtime')
            AND estado IN ({placeholders})""",
        ESTADOS_ABIERTOS
    )
    seguimientos_vencidos = cursor.fetchone()[0]

    cursor.execute(
        f"""SELECT COUNT(*) FROM talleres
            WHERE proximo_contacto != '' AND date(proximo_contacto) = date('now','localtime')
            AND estado IN ({placeholders})""",
        ESTADOS_ABIERTOS
    )
    seguimientos_hoy = cursor.fetchone()[0]

    conn.close()
    return {
        "total": total,
        "por_estado": por_estado,
        "con_whatsapp": con_whatsapp,
        "total_reuniones": total_reuniones,
        "comunas": comunas,
        "rubros": rubros,
        "seguimientos_vencidos": seguimientos_vencidos,
        "seguimientos_hoy": seguimientos_hoy
    }

# Orden real del embudo de ventas (de arriba hacia abajo).
FUNNEL_STAGES = ["Por consultar", "Contactado", "Interesado", "En prueba 14 días", "Cliente Activo"]

def get_funnel_stats() -> Dict[str, Any]:
    """Embudo basado en historial real de transiciones (no solo la foto
    actual): cuenta cuántos talleres llegaron ALGUNA VEZ a cada etapa, así un
    taller que avanzó y luego se descartó sigue contando como que sí llegó a
    esa etapa. 'Por consultar' es la base: todo taller nace ahí."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM talleres")
    total = cursor.fetchone()[0]

    reached = {"Por consultar": total}
    for stage in FUNNEL_STAGES[1:]:
        cursor.execute("SELECT COUNT(DISTINCT taller_id) FROM historial_estados WHERE estado_nuevo = ?", (stage,))
        reached[stage] = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT taller_id) FROM historial_estados WHERE estado_nuevo = 'Descartado'")
    descartados_en_algun_punto = cursor.fetchone()[0]
    conn.close()

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

    return {"funnel": funnel, "total": total, "descartados_en_algun_punto": descartados_en_algun_punto}

def get_tendencia_semanal(dias: int = 14) -> List[Dict[str, Any]]:
    """Serie diaria de talleres nuevos y visitas registradas, para ver si el
    ritmo de prospección sube o baja semana a semana."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT date(fecha_creacion) as dia, COUNT(*) FROM talleres WHERE date(fecha_creacion) >= date('now', ?) GROUP BY dia",
        (f"-{dias} days",)
    )
    nuevos = dict(cursor.fetchall())

    cursor.execute(
        "SELECT date(fecha) as dia, COUNT(*) FROM reuniones WHERE date(fecha) >= date('now', ?) GROUP BY dia",
        (f"-{dias} days",)
    )
    visitas = dict(cursor.fetchall())
    conn.close()

    from datetime import timedelta
    hoy = datetime.now().date()
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
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nombre, comuna, telefono, estado FROM talleres")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

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
    terreno) que no vino del scraper. Reusa la misma restricción UNIQUE(nombre,
    comuna) para evitar duplicar uno que ya exista."""
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        cursor.execute("""
            INSERT INTO talleres (
                nombre, rubro, comuna, direccion, telefono, whatsapp_link,
                calificacion, opiniones, sitio_web, maps_url, estado, fecha_creacion
            ) VALUES (?, ?, ?, ?, ?, ?, '', '0', '', '', 'Por consultar', ?)
        """, (
            data["nombre"].strip(),
            data.get("rubro", "General"),
            data["comuna"].strip(),
            data.get("direccion", ""),
            data.get("telefono", ""),
            data.get("whatsapp_link", ""),
            now
        ))
        conn.commit()
        new_id = cursor.lastrowid
        return new_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()
