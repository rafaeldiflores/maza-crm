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

MAZA_EMULADOR=1 apunta al emulador de Firebase (ver nube.py).
"""
from __future__ import annotations

import contextvars
import copy
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import shutil
import subprocess
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Any, Dict, List, Optional

import nube
from nube import EMULADOR, PROYECTO

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


def _app():
    return nube.app()


def _db():
    return nube.firestore_db()


def _auth():
    from firebase_admin import auth
    return auth


# Correo de quien hace el request (lo fija app.py desde IAP en Cloud Run).
USUARIO: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("usuario", default=None)


def actor() -> str:
    """Quién hace los cambios, para la auditoría: la sesión de IAP en Cloud
    Run; en local, la cuenta activa de gcloud."""
    return USUARIO.get() or _actor_local()


@lru_cache(maxsize=1)
def _actor_local() -> str:
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
    # Toda escritura de cuentas pasa por acá: la salud en memoria deja de valer.
    invalidar_salud()
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


# ─── Salud de las cuentas (uso real) ──────────────────────────────────────────
# Señales baratas: el perfil (trial), el último acceso de Auth (una sola
# llamada paginada) y conteos agregados (1 lectura cada uno). Nada de bajar
# órdenes completas.

PRECIO_MENSUAL = {"pro": 24990, "ilimitado": 39990, "empresa": 59990}  # = worker.js


def _contar(query) -> int:
    return int(query.count().get()[0][0].value)


def _ultimos_accesos() -> Dict[str, Optional[datetime]]:
    auth = _auth()
    accesos = {}
    for u in auth.list_users(app=_app()).iterate_all():
        ms = u.user_metadata.last_sign_in_timestamp or u.user_metadata.last_refresh_timestamp
        accesos[u.uid] = datetime.fromtimestamp(ms / 1000, timezone.utc) if ms else None
    return accesos


def _dias_desde(d: Optional[datetime]) -> Optional[int]:
    return None if d is None else (datetime.now(timezone.utc) - d).days


def _ultimo_dia_activo(p: Dict[str, Any]) -> Optional[datetime]:
    dias = sorted(p.get("trialDiasActivos") or [])
    return _fecha(dias[-1]) if dias else None


# El 504 de /api/maza/salud (3/10/2026): la salud hacía 4 conteos POR TALLER,
# uno detrás de otro (4 × N idas y vueltas a Firestore, más el listado entero
# de Auth), y Hoy, Cobros y Métricas la piden cada una al abrirse. Con unas
# decenas de cuentas ya pasaba el plazo del balanceador de IAP. Dos arreglos:
# - los conteos van en paralelo (son lecturas independientes; el cliente de
#   Firestore es seguro entre hilos);
# - el resultado se guarda unos segundos en memoria (Cloud Run corre UNA sola
#   instancia, ver CLAUDE.md), y toda escritura de cuentas lo invalida, así
#   que lo que cambies se ve al instante.
SALUD_TTL_SEG = 60
SALUD_HILOS = 16
_cache_salud: Dict[str, Any] = {"en": 0.0, "filas": None}
_lock_salud = threading.Lock()


def invalidar_salud() -> None:
    """La próxima lectura de salud vuelve a Firestore (tras cualquier escritura)."""
    _cache_salud["filas"] = None


def _uso_taller(db, uid: str) -> Dict[str, int]:
    ref = db.collection("users").document(uid)
    return {
        "catalogo": _contar(ref.collection("services")),
        "clientes": _contar(ref.collection("clients")),
        "equipo": _contar(ref.collection("empleados")),
        "aprobaciones": _contar(db.collection("aprobaciones").where("tallerId", "==", uid)),
    }


def salud_cuentas() -> List[Dict[str, Any]]:
    # Un solo cálculo a la vez: si Hoy y Cobros piden la salud juntas, la
    # segunda espera y usa la de la primera en vez de repetir todo.
    with _lock_salud:
        filas = _cache_salud["filas"]
        if filas is not None and time.monotonic() - _cache_salud["en"] < SALUD_TTL_SEG:
            return copy.deepcopy(filas)
        filas = _calcular_salud()
        _cache_salud.update(en=time.monotonic(), filas=filas)
        return copy.deepcopy(filas)


def _calcular_salud() -> List[Dict[str, Any]]:
    db = _db()
    accesos = _ultimos_accesos()
    import ajustes
    umbrales = ajustes.leer()["salud"]
    usuarios = [(d.id, d.to_dict() or {}) for d in db.collection("users").stream()]
    referidos: Dict[str, int] = {}
    for _, p in usuarios:
        if p.get("referidoPor"):
            referidos[p["referidoPor"]] = referidos.get(p["referidoPor"], 0) + 1

    titulares = [(uid, p) for uid, p in usuarios if _es_titular(uid, p)]
    with ThreadPoolExecutor(max_workers=SALUD_HILOS) as hilos:
        usos = dict(zip((uid for uid, _ in titulares), hilos.map(lambda t: _uso_taller(db, t[0]), titulares)))

    filas = []
    for uid, p in titulares:
        uso = usos[uid]
        acceso = max([d for d in (accesos.get(uid), _ultimo_dia_activo(p)) if d], default=None)
        sin_uso = _dias_desde(acceso)
        f = _fila(uid, p)
        pasos = {
            "cuenta_creada": True,
            "primer_vehiculo": uso["clientes"] > 0 or f["trialOrdenes"] > 0,
            "usuarios_invitados": uso["equipo"] > 0,
            "primer_presupuesto": uso["aprobaciones"] > 0,
        }
        estado, motivo = _diagnostico(f, sin_uso, pasos, umbrales)
        filas.append({
            **f, "uso": uso, "pasos": pasos, "ultimoAcceso": acceso.isoformat() if acceso else None,
            "diasSinUso": sin_uso, "salud": estado, "motivo": motivo,
            "referidos": referidos.get(uid, 0),
        })
    orden = {"vencido": 0, "riesgo": 1, "renovar": 2, "tibio": 3, "sano": 4}
    filas.sort(key=lambda x: (orden.get(x["salud"], 5), -(x["diasSinUso"] or 0)))
    return filas


def _diagnostico(f: Dict[str, Any], sin_uso: Optional[int], pasos: Dict[str, bool], u: Dict[str, int]):
    modo = f["modo"]
    if modo in PLANES_PAGO:
        hasta = _fecha(f["planVigenteHasta"])
        if hasta:
            dias = (hasta - datetime.now(timezone.utc)).days
            if dias <= u["diasAvisoRenovar"]:
                return "renovar", f"Vence en {max(dias, 0)} días"
        if sin_uso is not None and sin_uso >= u["diasSinUsoPago"]:
            return "riesgo", f"Pagando, {sin_uso} días sin usar"
        return "sano", "Al día"
    if modo == "trial_expirado":
        return "vencido", "Prueba vencida sin pagar"
    if modo != "trial":
        return "sano", ""
    hechos = sum(pasos.values())
    if sin_uso is None or sin_uso >= u["diasSinUsoPrueba"]:
        return "riesgo", "Nunca entró" if sin_uso is None else f"{sin_uso} días sin entrar"
    if f["trialDiasUsados"] >= u["diasPruebaPorVencer"]:
        return "riesgo", f"Le quedan {TRIAL_DIAS - f['trialDiasUsados']} días de prueba"
    if hechos < 3 or sin_uso >= 2:
        return "tibio", f"Onboarding {hechos}/4"
    return "sano", f"Usando ({f['trialOrdenes']} órdenes)"


# ─── Pagos y renovaciones ─────────────────────────────────────────────────────

def registrar_pago(uid: str, monto: int, medio: str, meses: int, nota: str = "") -> Dict[str, Any]:
    if monto <= 0 or not 1 <= meses <= 24:
        raise ErrorAdmin("Monto mayor a 0 y entre 1 y 24 meses.")
    ref = _db().collection("users").document(uid)
    p = (ref.get().to_dict() or {})
    if p.get("plan") not in PLANES_PAGO:
        raise ErrorAdmin("Primero asigna un plan pagado a la cuenta.")
    base = max(_fecha(p.get("planVigenteHasta")) or datetime.now(timezone.utc), datetime.now(timezone.utc))
    nueva = (base + timedelta(days=30 * meses)).isoformat().replace("+00:00", "Z")
    cambios = {**{k: p.get(k) for k in CAMPOS_PLAN}, "planVigenteHasta": nueva}
    actualizar_plan(uid, cambios)
    _db().collection("crmPagos").add({
        "uid": uid, "email": p.get("email"), "monto": int(monto), "medio": medio, "meses": meses,
        "plan": p.get("plan"), "nota": nota, "fecha": _ahora_iso(), "actor": actor(), "vigenteHasta": nueva,
    })
    return {"vigenteHasta": nueva}


def listar_pagos() -> List[Dict[str, Any]]:
    """Pagos manuales (crmPagos) + los de Mercado Pago que registra el Worker."""
    db = _db()
    pagos = [{"id": d.id, "origen": "manual", **_serializable(d.to_dict() or {})} for d in db.collection("crmPagos").stream()]
    for d in db.collection("pagosMercadoPago").where("tipo", "==", "plan").stream():
        x = d.to_dict() or {}
        pagos.append({"id": d.id, "origen": "mercadopago", "uid": x.get("uid"), "monto": int(x.get("monto") or 0),
                      "medio": "Mercado Pago", "plan": x.get("plan"), "meses": 12 if x.get("ciclo") == "anual" else 1,
                      "fecha": _serializable(x.get("procesadoEn"))})
    pagos.sort(key=lambda x: str(x.get("fecha") or ""), reverse=True)
    return pagos


# ─── Métricas ─────────────────────────────────────────────────────────────────

def metricas(salud: List[Dict[str, Any]], pagos: List[Dict[str, Any]]) -> Dict[str, Any]:
    pagando = [c for c in salud if c["modo"] in PLANES_PAGO]
    mrr = sum(PRECIO_MENSUAL[c["modo"]] * ((1 - (c["descuentoFundador"] or 0)) if c["esFundador"] else 1) for c in pagando)
    ingresos: Dict[str, int] = {}
    for x in pagos:
        mes = str(x.get("fecha") or "")[:7]
        if mes:
            ingresos[mes] = ingresos.get(mes, 0) + int(x.get("monto") or 0)

    def conversion(clave):
        grupos: Dict[str, Dict[str, int]] = {}
        for c in salud:
            g = grupos.setdefault(clave(c) or "—", {"total": 0, "pagando": 0})
            g["total"] += 1
            g["pagando"] += c["modo"] in PLANES_PAGO
        return [{"grupo": k, **v, "pct": round(v["pagando"] / v["total"] * 100) if v["total"] else 0}
                for k, v in sorted(grupos.items())]

    return {
        "mrr": round(mrr),
        "pagando": len(pagando),
        "enPrueba": sum(c["modo"] == "trial" for c in salud),
        "vencidas": sum(c["modo"] == "trial_expirado" for c in salud),
        "enRiesgo": sum(c["salud"] == "riesgo" for c in salud),
        "ingresosPorMes": [{"mes": k, "monto": v} for k, v in sorted(ingresos.items())][-12:],
        "porMesDeAlta": conversion(lambda c: (c["creadoEn"] or "")[:7]),
        "porRubro": conversion(lambda c: c["tipoTaller"]),
        "porCiudad": conversion(lambda c: c["ciudad"]),
    }


# ─── Eliminar cuenta ──────────────────────────────────────────────────────────
# Mismo recorrido que /cuenta/eliminar del Worker (eliminarCuentaDueno /
# eliminarCuentaMecanico): equipo desvinculado, tokens de Mercado Pago,
# índices propios, fotos en Storage, árbol users/{uid} y la cuenta de Auth.
# Irreversible: la UI pide escribir el correo para confirmar.

def eliminar_cuenta(uid: str, confirmacion: str) -> Dict[str, Any]:
    from google.cloud.firestore_v1 import DELETE_FIELD

    db = _db()
    ref = db.collection("users").document(uid)
    snap = ref.get()
    p = (snap.to_dict() or {}) if snap.exists else {}
    email = (p.get("email") or "").lower()
    if snap.exists and confirmacion.strip().lower() != email:
        raise ErrorAdmin("Para eliminar, escribe el correo exacto de la cuenta.")

    tipo = "sin_perfil"
    if snap.exists:
        taller = p.get("tallerId")
        if taller and taller != uid:
            tipo = "mecanico"
            db.collection("users").document(taller).collection("empleados").document(uid).delete()
        else:
            tipo = "dueno"
            db.collection("mpTokens").document(uid).delete()
            for e in ref.collection("empleados").stream():
                if e.id != uid:
                    miembro = db.collection("users").document(e.id)
                    if miembro.get().exists:
                        miembro.update({"tallerId": DELETE_FIELD, "rol": DELETE_FIELD})
            for coleccion, campo_id, campo_dueno in (
                ("usernames", "username", "uid"),
                ("codigosTaller", "codigoTaller", "ownerId"),
                ("codigosReferido", "codigoReferido", "ownerId"),
            ):
                doc_id = p.get(campo_id)
                if doc_id:
                    idx = db.collection(coleccion).document(str(doc_id))
                    d = idx.get()
                    if d.exists and (d.to_dict() or {}).get(campo_dueno) == uid:
                        idx.delete()
        # Auditoría antes de borrar: después ya no queda qué mostrar.
        _auditar("eliminar_cuenta", uid, {k: _serializable(p.get(k)) for k in ("email", "nombreTaller", "plan", "planVigenteHasta")},
                 None, {"email": p.get("email"), "tipo": tipo})
        b = nube.bucket()
        if b is not None:
            for blob in b.list_blobs(prefix=f"users/{uid}/"):
                blob.delete()
        db.recursive_delete(ref)

    try:
        _auth().delete_user(uid, app=_app())
    except _auth().UserNotFoundError:
        pass
    return {"tipo": tipo, "email": p.get("email")}


# ─── Consumo de IA ────────────────────────────────────────────────────────────
# Lo escribe el Worker de MAZA (registrarUsoIA en cloudflare-worker/worker.js):
#   usoIA/{fecha}_{tallerId} = {fecha, tallerId, modo,
#     uso: {<uid>: {<funcion>: {unidades, gemini, haiku, devueltas,
#                               geminiEntrada, geminiSalida, haikuEntrada,
#                               haikuSalida, embebidos}}}}
# Acá solo se lee y se agrupa: una lectura por taller y día del período.

# Mismos topes que worker.js (LIMITE_IA_PERSONA, LIMITE_GRATIS,
# LECTURAS_DOCUMENTO_DIARIAS, LECTURAS_DOCUMENTO_GRATIS). Si cambian allá,
# cambian acá: sirven para ver qué cuentas llegan al tope.
LIMITE_CHAT_PERSONA = {"pro": 12, "ilimitado": 12, "empresa": 12}
LIMITE_CHAT_GRATIS = 2
LIMITE_DOCUMENTOS_TALLER = {"pro": 3, "ilimitado": 5, "empresa": 10}
LIMITE_DOCUMENTOS_GRATIS = 1
# Las que gastan el cupo de chat (tipo 'consulta' en /ia/reservar) y las del
# cupo de documentos. La búsqueda tiene su propio tope (300/persona) y es
# barata: se muestra, pero no cuenta para "al tope".
FUNCIONES_CHAT = ("asistente", "chat", "aviso_retiro", "otra")
FUNCIONES_DOCUMENTO = ("factura", "lista_servicios")
NOMBRE_FUNCION = {
    "asistente": "Asistente (agente)",
    "chat": "Chat clásico",
    "aviso_retiro": "Aviso de vehículo listo",
    "factura": "Lectura de factura",
    "lista_servicios": "Lista de servicios",
    "busqueda": "Búsqueda semántica",
    "otra": "Otra / app vieja",
}
# USD por millón de tokens. Haiku 4.5: 1 entrada, 5 salida (la entrada se
# cuenta toda a precio lleno, así que es un techo). Gemini: None hasta cargar
# el precio de la factura de Vertex; mientras tanto su costo no se suma.
PRECIO_HAIKU = (1.0, 5.0)
PRECIO_GEMINI: Optional[tuple] = None
METRICAS_IA = ("unidades", "gemini", "haiku", "devueltas", "geminiEntrada",
               "geminiSalida", "haikuEntrada", "haikuSalida", "embebidos")


def _vacio() -> Dict[str, int]:
    return {m: 0 for m in METRICAS_IA}


def _sumar(destino: Dict[str, int], origen: Dict[str, Any]) -> None:
    for m in METRICAS_IA:
        v = origen.get(m)
        if isinstance(v, (int, float)) and v > 0:
            destino[m] += int(v)


def _costo_usd(t: Dict[str, int]) -> Dict[str, Optional[float]]:
    haiku = (t["haikuEntrada"] * PRECIO_HAIKU[0] + t["haikuSalida"] * PRECIO_HAIKU[1]) / 1e6
    gemini = None
    if PRECIO_GEMINI:
        gemini = (t["geminiEntrada"] * PRECIO_GEMINI[0] + t["geminiSalida"] * PRECIO_GEMINI[1]) / 1e6
    return {"haikuUsd": round(haiku, 4), "geminiUsd": None if gemini is None else round(gemini, 4)}


def agregar_consumo_ia(docs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Agrupa documentos usoIA por función, por taller y por día. Pura (sin
    Firestore): recibe los dicts tal como vienen de `to_dict()`."""
    por_funcion: Dict[str, Dict[str, int]] = {}
    por_taller: Dict[str, Dict[str, Any]] = {}
    por_dia: Dict[str, int] = {}
    for doc in docs:
        fecha, taller = doc.get("fecha"), doc.get("tallerId")
        uso = doc.get("uso")
        if not isinstance(fecha, str) or not isinstance(taller, str) or not isinstance(uso, dict):
            continue
        modo = doc.get("modo") or "?"
        t = por_taller.setdefault(taller, {
            "tallerId": taller, "modo": modo, "totales": _vacio(), "funciones": {},
            "personas": {}, "dias": set(), "diasTopeChat": 0, "diasTopeDocumentos": 0,
        })
        t["modo"] = modo  # el último día leído manda (los docs vienen por fecha)
        t["dias"].add(fecha)
        docs_dia = 0
        for uid, funciones in uso.items():
            if not isinstance(funciones, dict):
                continue
            persona = t["personas"].setdefault(uid, {"uid": uid, "totales": _vacio(), "funciones": {}})
            chat_dia = 0
            for funcion, metricas in funciones.items():
                if not isinstance(metricas, dict):
                    continue
                for destino in (
                    por_funcion.setdefault(funcion, _vacio()),
                    t["totales"], t["funciones"].setdefault(funcion, _vacio()),
                    persona["totales"], persona["funciones"].setdefault(funcion, _vacio()),
                ):
                    _sumar(destino, metricas)
                unidades = int(metricas.get("unidades") or 0)
                # El gráfico por día cuenta lo que gasta cupo: las búsquedas
                # son cientos y casi gratis, y taparían todo lo demás.
                if funcion != "busqueda":
                    por_dia[fecha] = por_dia.get(fecha, 0) + unidades
                if funcion in FUNCIONES_CHAT:
                    chat_dia += unidades
                elif funcion in FUNCIONES_DOCUMENTO:
                    docs_dia += unidades
            if chat_dia >= LIMITE_CHAT_PERSONA.get(modo, LIMITE_CHAT_GRATIS):
                t["diasTopeChat"] += 1
        if docs_dia >= LIMITE_DOCUMENTOS_TALLER.get(modo, LIMITE_DOCUMENTOS_GRATIS):
            t["diasTopeDocumentos"] += 1

    talleres = []
    for t in por_taller.values():
        suma = lambda grupo: sum(v["unidades"] for k, v in t["funciones"].items() if k in grupo)  # noqa: E731
        talleres.append({
            **t, "dias": len(t["dias"]), **_costo_usd(t["totales"]),
            "consultas": suma(FUNCIONES_CHAT), "documentos": suma(FUNCIONES_DOCUMENTO), "busquedas": suma(("busqueda",)),
            "personas": sorted(t["personas"].values(), key=lambda p: -p["totales"]["unidades"]),
        })
    talleres.sort(key=lambda t: (-t["haikuUsd"], -t["totales"]["unidades"]))
    totales = _vacio()
    for f in por_funcion.values():
        for m in METRICAS_IA:
            totales[m] += f[m]
    unidades_de = lambda grupo: sum(v["unidades"] for k, v in por_funcion.items() if k in grupo)  # noqa: E731
    totales["consultas"] = unidades_de(FUNCIONES_CHAT)
    totales["documentos"] = unidades_de(FUNCIONES_DOCUMENTO)
    totales["busquedas"] = unidades_de(("busqueda",))
    funciones = [
        {"funcion": k, "nombre": NOMBRE_FUNCION.get(k, k), **v, **_costo_usd(v)}
        # La búsqueda va al final: son cientos de unidades casi gratis.
        for k, v in sorted(por_funcion.items(), key=lambda kv: (kv[0] == "busqueda", -kv[1]["unidades"]))
    ]
    return {
        "totales": {**totales, **_costo_usd(totales)},
        "funciones": funciones,
        "talleres": talleres,
        "porDia": [{"fecha": d, "unidades": n} for d, n in sorted(por_dia.items())],
        "precioGeminiCargado": PRECIO_GEMINI is not None,
    }


def consumo_ia(dias: int = 30) -> Dict[str, Any]:
    """Consumo de IA de los últimos `dias` (UTC), con nombre del taller y correo
    de cada persona. Lecturas: un doc por taller-día + un get por taller."""
    dias = max(1, min(int(dias), 366))
    desde = (datetime.now(timezone.utc) - timedelta(days=dias - 1)).date().isoformat()
    db = _db()
    docs = [d.to_dict() or {} for d in db.collection("usoIA").where("fecha", ">=", desde).stream()]
    docs.sort(key=lambda d: d.get("fecha") or "")
    r = agregar_consumo_ia(docs)

    # Nombres: perfiles de los talleres que aparecen (no todos los users) y
    # correos de las personas desde Auth, en lotes de 100 (límite de get_users).
    ids = [t["tallerId"] for t in r["talleres"]]
    perfiles = {s.id: (s.to_dict() or {}) for s in db.get_all([db.collection("users").document(i) for i in ids])} if ids else {}
    uids = sorted({p["uid"] for t in r["talleres"] for p in t["personas"]})
    correos: Dict[str, str] = {}
    try:
        from firebase_admin import auth
        for i in range(0, len(uids), 100):
            lote = auth.get_users([auth.UidIdentifier(u) for u in uids[i:i + 100]], app=_app())
            correos.update({u.uid: u.email or "" for u in lote.users})
    except Exception:  # noqa: BLE001 — sin correos se muestra el uid
        pass
    for t in r["talleres"]:
        p = perfiles.get(t["tallerId"], {})
        t["nombreTaller"] = p.get("nombreTaller") or p.get("username") or t["tallerId"]
        for persona in t["personas"]:
            persona["email"] = correos.get(persona["uid"], "")
            persona["esDueno"] = persona["uid"] == t["tallerId"]
    r["nombresFuncion"] = NOMBRE_FUNCION
    r["desde"] = desde
    r["dias"] = dias
    return r
