"""
Gestión de cuentas de MAZA (lo que antes era /admin dentro de la app).

Vive acá y no en la app porque es una herramienta interna: corre solo en este
PC (app.py escucha en 127.0.0.1), habla con Firebase con las credenciales de
`gcloud auth application-default login` del dueño (sin archivos de clave) y
cada cambio deja una fila en `adminAuditoria` (colección que las reglas de
Firestore no dejan leer ni escribir a ningún cliente).

Las formas de los documentos copian lo que escribe MAZA:
  - users/{uid}                    perfil del titular (plan, vigencia, fundador…)
  - users/{uid}/empleados/{uid}    espejo del plan para el equipo
  - errores/, tickets/             telemetría y soporte
Las reglas del trial son las de PlanService / worker.js (TRIAL_*): si cambian
allá, cambian acá.

MAZA_EMULADOR=1 apunta al emulador de Firebase (proyecto demo-litoralbikes,
puertos por defecto) para probar sin tocar producción.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Any, Dict, List, Optional

EMULADOR = os.environ.get("MAZA_EMULADOR") == "1"
if EMULADOR:
    os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "localhost:8080")
    os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")

PROYECTO = "demo-litoralbikes" if EMULADOR else "litoralbikes-7d29d"

PLANES_PAGO = ("pro", "ilimitado", "empresa")
PLANES_VALIDOS = ("trial", "basico", *PLANES_PAGO)
NOMBRE_PLAN = {
    "trial": "Prueba",
    "basico": "Básico (legado)",
    "pro": "Taller Solo",
    "ilimitado": "Taller Pro",
    "empresa": "Empresa",
    "trial_expirado": "Prueba vencida",
}
TRIAL_DIAS = 14
TRIAL_ORDENES = 30
TRIAL_TOPE_DIAS = 60
ASIENTOS_INCLUIDOS = 3  # Empresa: dueño + 2 mecánicos
FUNDADORES_MAX = 20

# Campos del perfil que toca el editor de plan. Nada fuera de esta lista se
# escribe desde el CRM.
CAMPOS_PLAN = (
    "plan", "planVigenteHasta", "asientosContratados",
    "esFundador", "numeroFundador", "descuentoFundador", "mpConnectHabilitado",
)


class ErrorAdmin(Exception):
    """Error de validación: el mensaje se muestra tal cual en la UI."""


@lru_cache(maxsize=1)
def _app():
    import firebase_admin
    return firebase_admin.initialize_app(options={"projectId": PROYECTO})


def _db():
    from firebase_admin import firestore
    return firestore.client(_app())


def _auth():
    from firebase_admin import auth
    return auth


@lru_cache(maxsize=1)
def actor() -> str:
    """Quién hace los cambios, para la auditoría: la cuenta activa de gcloud."""
    if EMULADOR:
        return "emulador"
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if gcloud:
        try:
            salida = subprocess.run(
                [gcloud, "config", "get-value", "account"],
                capture_output=True, text=True, timeout=15,
            ).stdout.strip()
            if salida:
                return salida
        except Exception:
            pass
    return f"crm-local:{os.environ.get('USERNAME', '?')}"


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _fecha(valor: Any) -> Optional[datetime]:
    if not valor:
        return None
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _serializable(valor: Any) -> Any:
    """Timestamps de Firestore → ISO, recursivo (para JSON)."""
    if isinstance(valor, datetime):
        return valor.isoformat()
    if isinstance(valor, dict):
        return {k: _serializable(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_serializable(v) for v in valor]
    return valor


def modo_efectivo(p: Dict[str, Any]) -> str:
    """El plan con que la app trata hoy a la cuenta (PlanService.modo)."""
    plan = p.get("plan")
    if plan in PLANES_PAGO:
        hasta = _fecha(p.get("planVigenteHasta"))
        if hasta is None:
            return plan  # sin fecha = sin vencimiento
        return plan if hasta >= datetime.now(timezone.utc) else "trial_expirado"
    if plan == "basico":
        return "basico"
    dias = len(p.get("trialDiasActivos") or [])
    ordenes = int(p.get("trialOrdenes") or 0)
    if dias >= TRIAL_DIAS or ordenes >= TRIAL_ORDENES:
        return "trial_expirado"
    inicio = _fecha(p.get("trialInicio"))
    if inicio and datetime.now(timezone.utc) - inicio > timedelta(days=TRIAL_TOPE_DIAS):
        return "trial_expirado"
    return "trial"


def _fila(uid: str, p: Dict[str, Any]) -> Dict[str, Any]:
    modo = modo_efectivo(p)
    return {
        "uid": uid,
        "email": p.get("email") or "",
        "nombreTaller": p.get("nombreTaller") or "",
        "tipoTaller": p.get("tipoTaller") or "",
        "ciudad": p.get("ciudad") or "",
        "pais": p.get("pais") or "",
        "telefono": p.get("telefono") or "",
        "plan": p.get("plan") or "trial",
        "modo": modo,
        "modoNombre": NOMBRE_PLAN.get(modo, modo),
        "planVigenteHasta": _serializable(p.get("planVigenteHasta")),
        "asientosContratados": p.get("asientosContratados"),
        "esFundador": bool(p.get("esFundador")),
        "numeroFundador": p.get("numeroFundador"),
        "descuentoFundador": p.get("descuentoFundador"),
        "mpConnectHabilitado": bool(p.get("mpConnectHabilitado")),
        "trialDiasUsados": len(p.get("trialDiasActivos") or []),
        "trialOrdenes": int(p.get("trialOrdenes") or 0),
        "trialInicio": _serializable(p.get("trialInicio")),
        "creadoEn": _serializable(p.get("creadoEn")),
        "rol": p.get("rol"),
        "tallerId": p.get("tallerId"),
    }


def _es_titular(uid: str, p: Dict[str, Any]) -> bool:
    return not p.get("tallerId") or p.get("tallerId") == uid


# ─── Lectura ──────────────────────────────────────────────────────────────────

def listar_cuentas() -> Dict[str, Any]:
    """Titulares (una fila por taller) + métricas. Los miembros de un equipo
    se ven dentro del detalle de su taller."""
    filas, miembros = [], 0
    for d in _db().collection("users").stream():
        p = d.to_dict() or {}
        if _es_titular(d.id, p):
            filas.append(_fila(d.id, p))
        else:
            miembros += 1
    filas.sort(key=lambda f: f.get("creadoEn") or "", reverse=True)

    por_modo: Dict[str, int] = {}
    for f in filas:
        por_modo[f["modo"]] = por_modo.get(f["modo"], 0) + 1
    return {
        "cuentas": filas,
        "metricas": {
            "talleres": len(filas),
            "miembros": miembros,
            "porModo": por_modo,
            "pagando": sum(por_modo.get(p, 0) for p in PLANES_PAGO),
            "fundadores": sum(1 for f in filas if f["esFundador"]),
        },
    }


def detalle_cuenta(uid: str) -> Dict[str, Any]:
    db = _db()
    ref = db.collection("users").document(uid)
    snap = ref.get()
    if not snap.exists:
        raise ErrorAdmin("No existe esa cuenta.")
    p = snap.to_dict() or {}

    clientes = list(ref.collection("clients").stream())
    ordenes_abiertas = 0
    ordenes_total = 0
    for c in clientes:
        for o in (c.to_dict() or {}).get("ordenes") or []:
            ordenes_total += 1
            if o.get("estado") != "Entregada":
                ordenes_abiertas += 1

    from google.cloud.firestore_v1 import Query
    ultimas = [
        {"id": t.id, **_serializable(t.to_dict() or {})}
        for t in ref.collection("transactions")
        .order_by("date", direction=Query.DESCENDING).limit(5).stream()
    ]
    equipo = [
        {"uid": e.id, **_serializable(e.to_dict() or {})}
        for e in ref.collection("empleados").stream()
    ]

    ultimo_acceso = None
    try:
        u = _auth().get_user(uid, app=_app())
        ms = u.user_metadata.last_sign_in_timestamp
        ultimo_acceso = datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat() if ms else None
    except Exception:
        pass

    return {
        "cuenta": _fila(uid, p),
        "ultimoAcceso": ultimo_acceso,
        "resumen": {
            "clientes": len(clientes),
            "ordenesTotal": ordenes_total,
            "ordenesAbiertas": ordenes_abiertas,
            "inventario": ref.collection("inventario").count().get()[0][0].value,
            "ultimasTransacciones": ultimas,
        },
        "equipo": equipo,
    }


def buscar_por_email(email: str) -> Optional[Dict[str, Any]]:
    email = (email or "").strip()
    if not email:
        return None
    for d in _db().collection("users").where("email", "==", email).limit(1).stream():
        return _fila(d.id, d.to_dict() or {})
    return None


# ─── Escritura (todas auditadas) ──────────────────────────────────────────────

def _auditar(accion: str, uid: Optional[str], antes: Any, despues: Any, extra: Optional[dict] = None):
    _db().collection("adminAuditoria").add({
        "accion": accion,
        "uid": uid,
        "actor": actor(),
        "origen": "crm-local",
        "fecha": _ahora_iso(),
        "antes": antes,
        "despues": despues,
        **(extra or {}),
    })


def _normalizar_plan(cambios: Dict[str, Any]) -> Dict[str, Any]:
    plan = cambios.get("plan")
    if plan not in PLANES_VALIDOS:
        raise ErrorAdmin(f"Plan no válido: {plan}")

    vigencia = cambios.get("planVigenteHasta") or None
    if vigencia:
        # Del input de fecha (AAAA-MM-DD) al fin de ese día, como el panel viejo.
        if len(vigencia) == 10:
            vigencia = datetime.fromisoformat(vigencia + "T23:59:59").astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        elif _fecha(vigencia) is None:
            raise ErrorAdmin("Fecha de vigencia inválida.")

    asientos = None
    if plan == "empresa":
        asientos = int(cambios.get("asientosContratados") or 0)
        if asientos < ASIENTOS_INCLUIDOS:
            raise ErrorAdmin(f"Empresa parte en {ASIENTOS_INCLUIDOS} asientos (dueño + 2 mecánicos).")
        if asientos > 50:
            raise ErrorAdmin("Máximo 50 asientos.")

    es_fundador = bool(cambios.get("esFundador"))
    numero = descuento = None
    if es_fundador:
        numero = int(cambios.get("numeroFundador") or 0)
        if not 1 <= numero <= FUNDADORES_MAX:
            raise ErrorAdmin(f"N° de fundador debe ser entre 1 y {FUNDADORES_MAX}.")
        descuento = float(cambios.get("descuentoFundador") if cambios.get("descuentoFundador") is not None else 0.5)
        if not 0 <= descuento <= 1:
            raise ErrorAdmin("El descuento de fundador va entre 0 y 1 (0,5 = 50 %).")

    return {
        "plan": plan,
        "planVigenteHasta": vigencia,
        "asientosContratados": asientos,
        "esFundador": es_fundador,
        "numeroFundador": numero,
        "descuentoFundador": descuento,
        "mpConnectHabilitado": bool(cambios.get("mpConnectHabilitado")),
    }


def actualizar_plan(uid: str, cambios: Dict[str, Any]) -> Dict[str, Any]:
    db = _db()
    ref = db.collection("users").document(uid)
    snap = ref.get()
    if not snap.exists:
        raise ErrorAdmin("No existe esa cuenta.")
    p = snap.to_dict() or {}
    if not _es_titular(uid, p):
        raise ErrorAdmin("Esa cuenta es miembro de un equipo: el plan se cambia en el taller titular.")

    nuevo = _normalizar_plan(cambios)

    if nuevo["esFundador"]:
        for d in db.collection("users").where("numeroFundador", "==", nuevo["numeroFundador"]).stream():
            if d.id != uid and (d.to_dict() or {}).get("esFundador"):
                raise ErrorAdmin(f"El N° de fundador {nuevo['numeroFundador']} ya es de {(d.to_dict() or {}).get('email')}.")

    antes = {k: _serializable(p.get(k)) for k in CAMPOS_PLAN}
    if antes == nuevo:
        return {"cambio": False, "cuenta": _fila(uid, p)}

    # Trial nuevo desde el CRM: arranca hoy (mismo shape que el registro).
    extra = {}
    if nuevo["plan"] == "trial" and not p.get("trialInicio"):
        extra["trialInicio"] = _ahora_iso()

    ref.set({**nuevo, **extra, "actualizadoEn": _ahora_iso()}, merge=True)

    # Espejo del plan para el equipo: sin esto los mecánicos ven el plan viejo
    # hasta que el titular abre la app (sincronizarPlanDelEquipo).
    miembros = 0
    ahora = _ahora_iso()
    for e in ref.collection("empleados").stream():
        e.reference.update({
            "tallerPlan": nuevo["plan"],
            "tallerPlanVigenteHasta": nuevo["planVigenteHasta"],
            "tallerAsientos": nuevo["asientosContratados"] or 0,
            "tallerPlanActualizadoEn": ahora,
        })
        miembros += 1

    _auditar("actualizar_plan", uid, antes, nuevo, {"email": p.get("email"), "miembrosEspejados": miembros})
    return {"cambio": True, "miembrosEspejados": miembros, "cuenta": _fila(uid, {**p, **nuevo, **extra})}


def crear_cuenta(email: str, password: str, nombre_taller: str, plan: str = "trial") -> Dict[str, Any]:
    email = (email or "").strip().lower()
    nombre_taller = (nombre_taller or "").strip()
    if not email or "@" not in email:
        raise ErrorAdmin("Correo inválido.")
    if len(password or "") < 8:
        raise ErrorAdmin("La contraseña debe tener al menos 8 caracteres.")
    if plan not in ("trial", *PLANES_PAGO):
        raise ErrorAdmin(f"Plan inicial no válido: {plan}")

    auth = _auth()
    try:
        usuario = auth.create_user(email=email, password=password, display_name=nombre_taller or None, app=_app())
    except auth.EmailAlreadyExistsError:
        raise ErrorAdmin("Ya existe una cuenta con ese correo.")

    ahora = _ahora_iso()
    perfil = {
        "uid": usuario.uid,
        "email": email,
        "nombreTaller": nombre_taller,
        "plan": plan,
        "creadoEn": ahora,
        "actualizadoEn": ahora,
    }
    if plan == "trial":
        perfil["trialInicio"] = ahora
    if plan == "empresa":
        perfil["asientosContratados"] = ASIENTOS_INCLUIDOS
    try:
        _db().collection("users").document(usuario.uid).create(perfil)
    except Exception as e:
        raise ErrorAdmin(f"La cuenta quedó creada en Auth (uid {usuario.uid}) pero falló el perfil: {e}")

    _auditar("crear_cuenta", usuario.uid, None, {"email": email, "plan": plan, "nombreTaller": nombre_taller})
    return {"uid": usuario.uid, "cuenta": _fila(usuario.uid, perfil)}


def resetear_password(uid: str, nueva: str) -> None:
    if len(nueva or "") < 8:
        raise ErrorAdmin("La contraseña debe tener al menos 8 caracteres.")
    _auth().update_user(uid, password=nueva, app=_app())
    # Nunca se guarda la contraseña: solo que se cambió.
    _auditar("resetear_password", uid, None, None)


# ─── Errores y tickets ────────────────────────────────────────────────────────

def listar_errores(maximo: int = 200) -> List[Dict[str, Any]]:
    from google.cloud.firestore_v1 import Query
    return [
        {"id": d.id, **_serializable(d.to_dict() or {})}
        for d in _db().collection("errores").order_by("fecha", direction=Query.DESCENDING).limit(maximo).stream()
    ]


def eliminar_error(error_id: str) -> None:
    _db().collection("errores").document(error_id).delete()


def listar_tickets() -> List[Dict[str, Any]]:
    tickets = [{"id": d.id, **_serializable(d.to_dict() or {})} for d in _db().collection("tickets").stream()]
    abiertos = sorted([t for t in tickets if t.get("estado") == "abierto"], key=lambda t: t.get("fecha") or "", reverse=True)
    resto = sorted([t for t in tickets if t.get("estado") != "abierto"], key=lambda t: t.get("fecha") or "", reverse=True)
    return abiertos + resto


def resolver_ticket(ticket_id: str, respuesta: str = "") -> None:
    ref = _db().collection("tickets").document(ticket_id)
    snap = ref.get()
    if not snap.exists:
        raise ErrorAdmin("No existe ese ticket.")
    datos = {"estado": "resuelto", "resueltoEn": _ahora_iso()}
    if respuesta.strip():
        datos["respuesta"] = respuesta.strip()
    ref.update(datos)
    _auditar("resolver_ticket", (snap.to_dict() or {}).get("uid"), {"estado": (snap.to_dict() or {}).get("estado")}, datos, {"ticketId": ticket_id})


def listar_auditoria(maximo: int = 100) -> List[Dict[str, Any]]:
    from google.cloud.firestore_v1 import Query
    return [
        {"id": d.id, **_serializable(d.to_dict() or {})}
        for d in _db().collection("adminAuditoria").order_by("fecha", direction=Query.DESCENDING).limit(maximo).stream()
    ]


def estado_crm_para(cuenta: Dict[str, Any]) -> Optional[str]:
    """Etapa del embudo del CRM que corresponde al plan real de la cuenta."""
    modo = cuenta.get("modo")
    if modo in PLANES_PAGO or modo == "basico":
        return "Cliente Activo"
    if modo == "trial":
        return "En prueba 14 días"
    return None  # prueba vencida: se deja la etapa que puso el vendedor
