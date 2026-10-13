"""
API de /cuentas: gestión de cuentas de MAZA desde el CRM (ver maza_admin.py).

Las rutas son `def` (no `async`): firebase-admin es bloqueante y FastAPI las
corre en su pool de hilos. Los ErrorAdmin salen como 400 con el mensaje tal
cual para la UI; cualquier otro error, como 502 (casi siempre credenciales de
gcloud vencidas o sin red).
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
import maza_admin

router = APIRouter(prefix="/api/maza")


def _llamar(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except maza_admin.ErrorAdmin as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — se muestra en la UI
        raise HTTPException(
            status_code=502,
            detail=f"Firebase no respondió ({type(e).__name__}: {e}). "
                   "Si es de credenciales: gcloud auth application-default login",
        )


class PlanCambio(BaseModel):
    plan: str
    planVigenteHasta: Optional[str] = None
    asientosContratados: Optional[int] = None
    esFundador: bool = False
    numeroFundador: Optional[int] = None
    descuentoFundador: Optional[float] = None
    mpConnectHabilitado: bool = False


class CuentaNueva(BaseModel):
    email: str
    password: str
    nombreTaller: str = ""
    plan: str = "trial"
    tallerCrmId: Optional[int] = None


class InvitacionNueva(BaseModel):
    taller: str
    nota: str = ""


class PasswordNueva(BaseModel):
    password: str


class TicketRespuesta(BaseModel):
    respuesta: str = ""


class Vinculo(BaseModel):
    tallerCrmId: int
    uid: Optional[str] = None  # None = desvincular


@router.get("/estado")
def estado():
    return {"proyecto": maza_admin.PROYECTO, "emulador": maza_admin.EMULADOR}


@router.get("/cuentas")
def cuentas():
    datos = _llamar(maza_admin.listar_cuentas)
    vinculos = db.get_vinculos_maza()
    for c in datos["cuentas"]:
        c["crm"] = vinculos.get(c["uid"])
    return datos


@router.get("/cuentas/{uid}")
def cuenta(uid: str):
    datos = _llamar(maza_admin.detalle_cuenta, uid)
    datos["crm"] = db.get_vinculos_maza().get(uid)
    return datos


@router.post("/cuentas/{uid}/plan")
def cambiar_plan(uid: str, cambio: PlanCambio):
    r = _llamar(maza_admin.actualizar_plan, uid, cambio.model_dump())
    _sincronizar_uno(uid, r["cuenta"])
    return r


@router.post("/cuentas")
def crear(nueva: CuentaNueva):
    r = _llamar(maza_admin.crear_cuenta, nueva.email, nueva.password, nueva.nombreTaller, nueva.plan)
    if nueva.tallerCrmId:
        db.update_taller(nueva.tallerCrmId, {"maza_uid": r["uid"]})
        _sincronizar_uno(r["uid"], r["cuenta"])
    return r


@router.get("/invitaciones")
def invitaciones():
    return _llamar(maza_admin.listar_invitaciones)


@router.post("/invitaciones")
def crear_invitacion(nueva: InvitacionNueva):
    return _llamar(maza_admin.crear_invitacion, nueva.taller, nueva.nota)


@router.post("/invitaciones/{codigo}/anular")
def anular_invitacion(codigo: str):
    _llamar(maza_admin.anular_invitacion, codigo)
    return {"ok": True}


@router.post("/cuentas/{uid}/password")
def cambiar_password(uid: str, nueva: PasswordNueva):
    _llamar(maza_admin.resetear_password, uid, nueva.password)
    return {"ok": True}


@router.post("/vincular")
def vincular(v: Vinculo):
    if not db.get_taller_by_id(v.tallerCrmId):
        raise HTTPException(status_code=404, detail="Taller del CRM no encontrado")
    if v.uid:
        otro = db.get_vinculos_maza().get(v.uid)
        if otro and otro["id"] != v.tallerCrmId:
            raise HTTPException(status_code=400, detail=f"Esa cuenta ya está vinculada a «{otro['nombre']}».")
    db.update_taller(v.tallerCrmId, {"maza_uid": v.uid or ""})
    if v.uid:
        _sincronizar_uno(v.uid)
    return {"ok": True}


@router.post("/sincronizar")
def sincronizar():
    """Pasa la etapa del embudo de cada taller vinculado al plan real."""
    cuentas = {c["uid"]: c for c in _llamar(maza_admin.listar_cuentas)["cuentas"]}
    cambios = 0
    for uid in db.get_vinculos_maza():
        if uid in cuentas and _sincronizar_uno(uid, cuentas[uid]):
            cambios += 1
    return {"ok": True, "cambios": cambios}


def _sincronizar_uno(uid: str, cuenta: Optional[Dict[str, Any]] = None) -> bool:
    vinculo = db.get_vinculos_maza().get(uid)
    if not vinculo:
        return False
    if cuenta is None:
        cuenta = _llamar(maza_admin.detalle_cuenta, uid)["cuenta"]
    etapa = maza_admin.estado_crm_para(cuenta)
    if etapa and etapa != vinculo["estado"]:
        db.update_taller(vinculo["id"], {"estado": etapa})
        return True
    return False


@router.get("/errores")
def errores():
    return _llamar(maza_admin.listar_errores)


@router.delete("/errores/{error_id}")
def borrar_error(error_id: str):
    _llamar(maza_admin.eliminar_error, error_id)
    return {"ok": True}


@router.get("/tickets")
def tickets():
    return _llamar(maza_admin.listar_tickets)


@router.post("/tickets/{ticket_id}/resolver")
def resolver(ticket_id: str, r: TicketRespuesta):
    _llamar(maza_admin.resolver_ticket, ticket_id, r.respuesta)
    return {"ok": True}


@router.get("/auditoria")
def auditoria():
    return _llamar(maza_admin.listar_auditoria)


# ─── Salud, cobros y métricas ─────────────────────────────────────────────────

class Pago(BaseModel):
    monto: int
    medio: str = "Transferencia"
    meses: int = 1
    nota: str = ""


def _aplicar_onboarding(salud):
    """Marca solos en el checklist del CRM los pasos que MAZA confirma."""
    vinculos = db.get_vinculos_maza()
    for c in salud:
        v = vinculos.get(c["uid"])
        c["crm"] = v
        if not v:
            continue
        hechos = {p["key"] for p in db.get_onboarding(v["id"]) if p["completado"]}
        for clave, ok in c["pasos"].items():
            if ok and clave not in hechos:
                db.set_onboarding_paso(v["id"], clave, True)


@router.get("/salud")
def salud():
    filas = _llamar(maza_admin.salud_cuentas)
    _aplicar_onboarding(filas)
    return filas


@router.get("/pagos")
def pagos():
    return _llamar(maza_admin.listar_pagos)


@router.post("/cuentas/{uid}/pago")
def registrar_pago(uid: str, pago: Pago):
    r = _llamar(maza_admin.registrar_pago, uid, pago.monto, pago.medio, pago.meses, pago.nota)
    _sincronizar_uno(uid)
    return r


@router.get("/metricas")
def metricas():
    return maza_admin.metricas(_llamar(maza_admin.salud_cuentas), _llamar(maza_admin.listar_pagos))


class Eliminacion(BaseModel):
    confirmacion: str


@router.post("/cuentas/{uid}/eliminar")
def eliminar(uid: str, e: Eliminacion):
    r = _llamar(maza_admin.eliminar_cuenta, uid, e.confirmacion)
    vinculo = db.get_vinculos_maza().get(uid)
    if vinculo:
        db.update_taller(vinculo["id"], {"maza_uid": ""})
    return r


@router.get("/consumo-ia")
def consumo_ia(dias: int = 30):
    return _llamar(maza_admin.consumo_ia, dias)
