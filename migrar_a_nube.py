"""
Sube una base SQLite vieja del CRM (crm_talleres.db) a Firestore.

    python migrar_a_nube.py                      # la crm_talleres.db de esta carpeta
    python migrar_a_nube.py "D:\\ruta\\crm_talleres.db"
    python migrar_a_nube.py --simular            # muestra qué haría, sin escribir

Se puede correr en cada PC que tenga una base propia: los talleres se juntan
por nombre + comuna (la misma unicidad del CRM), así que un taller que ya está
en la nube no se duplica:
  - taller nuevo en la nube     → se crea con todos sus datos y un id nuevo
  - taller que ya existía       → solo se completan los campos vacíos en la
                                  nube; la etapa del embudo no se toca
  - reuniones, historial y checklist de onboarding se reasignan al id de la
    nube; una reunión o un cambio de estado ya subido (misma fecha) se salta
  - las grabaciones de recordings/ se suben a Storage

No borra ni modifica la base SQLite: queda como respaldo.
"""
import sqlite3
import sys
from pathlib import Path

import db
import nube

# Campos que se completan en un taller que ya estaba en la nube, si allá
# están vacíos. estado/prioridad/interes no: los decide quien lo trabaja.
COMPLETABLES = (
    "direccion", "telefono", "whatsapp_link", "sitio_web", "maps_url", "encargado_nombre",
    "observaciones", "fecha_ultima_visita", "proximo_contacto", "fecha_inicio_prueba", "maza_uid",
)


def leer(conn, tabla):
    try:
        return [dict(r) for r in conn.execute(f"SELECT * FROM {tabla}")]
    except sqlite3.OperationalError:
        return []  # base vieja sin esa tabla


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    simular = "--simular" in sys.argv
    origen = Path(args[0]) if args else db.BASE_DIR / "crm_talleres.db"
    if not origen.exists():
        sys.exit(f"No existe {origen}")
    grabaciones = origen.parent / "recordings"

    print(f"Origen:  {origen}")
    print(f"Destino: Firestore {nube.PROYECTO}{' (EMULADOR)' if nube.EMULADOR else ''}")
    print("Modo simulación: no se escribe nada.\n" if simular else "")

    conn = sqlite3.connect(origen)
    conn.row_factory = sqlite3.Row
    talleres = leer(conn, "talleres")
    reuniones = leer(conn, "reuniones")
    historial = leer(conn, "historial_estados")
    onboarding = leer(conn, "onboarding_pasos")
    conn.close()

    db.init_db()
    fs = nube.firestore_db()

    ids = {}  # id local → id en la nube
    creados = completados = 0
    for t in talleres:
        existente = db._buscar_por_nombre_comuna(t["nombre"], t["comuna"])
        if existente:
            ids[t["id"]] = existente["id"]
            cambios = {k: t[k] for k in COMPLETABLES if t.get(k) and not existente.get(k)}
            if cambios:
                completados += 1
                if not simular:
                    db._actualizar_taller_doc(existente["id"], cambios)
            continue
        creados += 1
        if simular:
            ids[t["id"]] = -t["id"]
            continue
        datos = {k: t[k] for k in db.CAMPOS_TALLER if k in t and t[k] is not None}
        nuevo = db._crear_taller({**datos, "nombre": t["nombre"], "comuna": t["comuna"]})
        if nuevo is None:  # lo creó otro PC en este mismo momento
            nuevo = db._buscar_por_nombre_comuna(t["nombre"], t["comuna"])["id"]
        ids[t["id"]] = nuevo

    # Reuniones: una ya subida (mismo taller y misma fecha) no se repite.
    ya = {(r["taller_id"], r["fecha"]) for r in db.get_reuniones()}
    subidas_r = audios = 0
    for r in reuniones:
        destino = ids.get(r["taller_id"])
        if destino is None or (destino, r["fecha"]) in ya:
            continue
        subidas_r += 1
        if simular:
            continue
        nuevo_id = db._siguiente_id("reuniones")
        fila = {k: r.get(k, v) for k, v in db.CAMPOS_REUNION.items()}
        fila["taller_id"] = destino
        fs.collection(db.COL_REUNIONES).document(str(nuevo_id)).set(fila)
        if r.get("archivo_audio"):
            nombre = Path(r["archivo_audio"]).name
            local = grabaciones / nombre
            if local.exists():
                db.RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
                copia = db.RECORDINGS_DIR / nombre
                if local.resolve() != copia.resolve() and not copia.exists():
                    copia.write_bytes(local.read_bytes())
                db.subir_audio(nombre)
                audios += 1

    ya_h = {(h.get("taller_id"), h.get("estado_nuevo"), h.get("fecha")) for h in db._historial.values()}
    subidos_h = 0
    lote, ops = fs.batch(), 0
    for h in historial:
        destino = ids.get(h["taller_id"])
        if destino is None or (destino, h["estado_nuevo"], h["fecha"]) in ya_h:
            continue
        subidos_h += 1
        if simular:
            continue
        lote.set(fs.collection(db.COL_HISTORIAL).document(), {
            "taller_id": destino, "estado_anterior": h["estado_anterior"],
            "estado_nuevo": h["estado_nuevo"], "fecha": h["fecha"],
        })
        ops += 1
        if ops % 400 == 0:
            lote.commit()
            lote = fs.batch()
    if not simular and ops % 400:
        lote.commit()

    pasos_subidos = 0
    for p in onboarding:
        destino = ids.get(p["taller_id"])
        if destino is None or not p.get("completado"):
            continue  # un paso sin fila ya cuenta como pendiente
        pasos_subidos += 1
        if not simular:
            fs.collection(db.COL_ONBOARDING).document(str(destino)).set(
                {"pasos": {p["paso_key"]: {"completado": True, "fecha_completado": p.get("fecha_completado") or ""}}},
                merge=True,
            )

    print(f"Talleres:  {creados} nuevos, {completados} completados, {len(talleres) - creados - completados} sin cambios")
    print(f"Reuniones: {subidas_r} subidas ({audios} con audio)")
    print(f"Historial: {subidos_h} cambios de estado")
    print(f"Onboarding: {pasos_subidos} pasos completados")
    print("\nListo." if not simular else "\nSimulación terminada: corre sin --simular para subir.")


if __name__ == "__main__":
    main()
