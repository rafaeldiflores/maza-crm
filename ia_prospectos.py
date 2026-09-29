"""
Prioriza prospectos con Gemini en Vertex AI: lee lo que Places sabe de un
taller (tipos, descripción, reseñas) y devuelve si calza con MAZA, sus
dolores probables, un puntaje 0-100 y un primer mensaje de WhatsApp.

Credenciales de Google (sin API key). VERTEX_MODELO cambia el modelo.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any, Dict

import nube

MODELO = os.environ.get("VERTEX_MODELO", "gemini-3.6-flash")

INSTRUCCIONES = """Eres el analista comercial de MAZA, app de gestión para talleres multirubro en Chile
(bicicletas, motos y autos): órdenes de trabajo, presupuesto que el cliente aprueba por un link de WhatsApp,
aviso cuando el vehículo está listo, caja e inventario. El cliente ideal es un taller independiente, con
movimiento, que hoy se organiza con cuaderno o WhatsApp suelto.

No es cliente: concesionarios de marca, cadenas grandes, vulcanizaciones puras, lavados sin taller,
tiendas que solo venden repuestos.

Con los datos del taller responde SOLO un JSON con esta forma:
{"calza": true|false,
 "rubros": ["auto"|"moto"|"bici"|"otro", ...],
 "multirubro": true|false,
 "dolores": ["dolor concreto sacado de las reseñas", ...],   // máx. 3, vacío si no hay evidencia
 "puntaje": 0-100,          // prioridad de contacto: calce + tamaño (reseñas) + dolores que MAZA resuelve
 "motivo": "una línea que explique el puntaje",
 "mensaje": "primer WhatsApp al dueño, 2-3 líneas, español neutro sin voseo, menciona un dolor real si lo hay, sin sonar a spam"}"""


@lru_cache(maxsize=1)
def _cliente():
    from google import genai
    return genai.Client(vertexai=True, project=nube.PROYECTO_REAL,
                        location=os.environ.get("VERTEX_UBICACION", "global"))


def evaluar(taller: Dict[str, Any], detalle: Dict[str, Any]) -> Dict[str, Any]:
    datos = {
        "nombre": taller.get("nombre"), "comuna": taller.get("comuna"), "rubro_buscado": taller.get("rubro"),
        "sitio_web": taller.get("sitio_web"), **detalle,
    }
    r = _cliente().models.generate_content(
        model=MODELO,
        contents=f"{INSTRUCCIONES}\n\nDATOS DEL TALLER:\n{json.dumps(datos, ensure_ascii=False)}",
        config={"temperature": 0.2, "response_mime_type": "application/json"},
    )
    x = json.loads(r.text)
    return {
        "ia_calza": bool(x.get("calza")),
        "ia_rubros": [str(v) for v in x.get("rubros", [])][:4],
        "ia_multirubro": bool(x.get("multirubro")),
        "ia_dolores": [str(v) for v in x.get("dolores", [])][:3],
        "puntaje_ia": max(0, min(100, int(x.get("puntaje", 0)))),
        "ia_motivo": str(x.get("motivo", ""))[:300],
        "ia_mensaje": str(x.get("mensaje", ""))[:600],
    }
