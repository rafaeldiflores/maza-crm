"""
Configuración general del CRM (crmConfig/general en Firestore): firma de los
mensajes, plantillas de WhatsApp, valores por defecto del rastreo y umbrales
de salud de las cuentas. La editan solo los admin (/api/config, PUT).

Lo que es de cada dispositivo (PIN, WhatsApp normal o Business) no vive acá:
lo guarda el navegador (frontend/src/app/core/ajustes.ts).
"""
from __future__ import annotations

import copy
import threading
import time
from typing import Any, Dict

import nube
from config import WHATSAPP_TEMPLATES

POR_DEFECTO: Dict[str, Any] = {
    "firma": "Rafa de MAZA",
    "plantillas": WHATSAPP_TEMPLATES,
    "rastreo": {"zona": "valpo_gran", "maximo": 20, "evaluarIa": True},
    "salud": {"diasSinUsoPrueba": 3, "diasSinUsoPago": 7, "diasAvisoRenovar": 7, "diasPruebaPorVencer": 10},
}

_lock = threading.Lock()
_cache: Dict[str, Any] = {"t": 0.0, "v": None}


def _ref():
    return nube.firestore_db().collection("crmConfig").document("general")


def _mezclar(base: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
    r = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        r[k] = _mezclar(r[k], v) if isinstance(v, dict) and isinstance(r.get(k), dict) and k != "plantillas" else v
    return r


def leer() -> Dict[str, Any]:
    """Config vigente (por defecto + lo guardado). Caché de 30 s."""
    with _lock:
        if _cache["v"] is not None and time.time() - _cache["t"] < 30:
            return _cache["v"]
    snap = _ref().get()
    v = _mezclar(POR_DEFECTO, (snap.to_dict() or {}) if snap.exists else {})
    with _lock:
        _cache.update(t=time.time(), v=v)
    return v


def guardar(nueva: Dict[str, Any]) -> Dict[str, Any]:
    firma = str(nueva.get("firma", "")).strip()[:60]
    plantillas = {
        str(k)[:40]: {"titulo": str(p.get("titulo", ""))[:80], "mensaje": str(p.get("mensaje", ""))[:1000]}
        for k, p in (nueva.get("plantillas") or {}).items()
        if isinstance(p, dict) and p.get("mensaje")
    }
    r = nueva.get("rastreo") or {}
    s = nueva.get("salud") or {}
    limpio = {
        "firma": firma or POR_DEFECTO["firma"],
        "plantillas": plantillas or POR_DEFECTO["plantillas"],
        "rastreo": {"zona": str(r.get("zona", "valpo_gran")), "maximo": max(1, min(60, int(r.get("maximo", 20)))),
                    "evaluarIa": bool(r.get("evaluarIa", True))},
        "salud": {k: max(1, min(60, int(s.get(k, POR_DEFECTO["salud"][k])))) for k in POR_DEFECTO["salud"]},
    }
    _ref().set(limpio)
    with _lock:
        _cache.update(t=0.0, v=None)
    return leer()
