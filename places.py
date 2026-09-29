"""
Búsqueda de talleres con Places API (New) de Google, en reemplazo del scraper
de Google Maps con Playwright (frágil, pesado y fuera de los términos de uso).

Autenticación: las credenciales de Google del proceso (cuenta de servicio en
Cloud Run, `gcloud auth application-default login` en local), sin API key.
`X-Goog-User-Project` imputa el uso al proyecto de MAZA, que tiene la API
habilitada y facturación.

Costos (Google cobra por campo pedido, por eso las máscaras son mínimas):
  - buscar(): Text Search con teléfono, web y rating → SKU Enterprise.
  - detalle(): reseñas y resumen → SKU Enterprise + Atmosphere; se pide solo
    al evaluar un taller con IA, no al rastrear.
Términos: el place_id se puede guardar sin límite; el resto se refresca con
detalle() cuando hace falta (ver docs de políticas de Places).
"""
from __future__ import annotations

import unicodedata
from functools import lru_cache
from typing import Any, Dict, Iterator, List, Optional

import nube

BASE = "https://places.googleapis.com/v1"
MASCARA_BUSQUEDA = ",".join(f"places.{c}" for c in (
    "id", "displayName", "formattedAddress", "internationalPhoneNumber", "rating",
    "userRatingCount", "websiteUri", "googleMapsUri", "businessStatus", "primaryType",
)) + ",nextPageToken"
MASCARA_DETALLE = "id,displayName,types,primaryType,rating,userRatingCount,reviews,editorialSummary,regularOpeningHours.weekdayDescriptions"


@lru_cache(maxsize=1)
def _sesion():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    credenciales, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    return AuthorizedSession(credenciales)


def _llamar(metodo: str, url: str, mascara: str, cuerpo: Optional[dict] = None) -> dict:
    r = _sesion().request(metodo, url, json=cuerpo, timeout=30, headers={
        "X-Goog-FieldMask": mascara,
        "X-Goog-User-Project": nube.PROYECTO_REAL,
    })
    if r.status_code >= 400:
        raise RuntimeError(f"Places API {r.status_code}: {r.text[:300]}")
    return r.json()


def _plano(texto: str) -> str:
    """Minúsculas sin tildes, para comparar comunas ("Viña" = "Vina")."""
    return "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")


def buscar(consulta: str, comuna: str, maximo: int = 20) -> Iterator[Dict[str, Any]]:
    """Talleres de `consulta` en `comuna`, ya en el formato que guarda db.py.
    Descarta los cerrados y los que caen en otra comuna (Text Search devuelve
    también lo cercano)."""
    from scraper import clean_phone, generate_whatsapp_link

    token, entregados = None, 0
    while entregados < maximo:
        cuerpo = {"textQuery": f"{consulta} en {comuna}, Chile", "languageCode": "es", "regionCode": "CL",
                  "pageSize": min(20, maximo - entregados)}
        if token:
            cuerpo["pageToken"] = token
        datos = _llamar("POST", f"{BASE}/places:searchText", MASCARA_BUSQUEDA, cuerpo)
        for p in datos.get("places", []):
            if p.get("businessStatus") == "CLOSED_PERMANENTLY":
                continue
            direccion = p.get("formattedAddress", "")
            if _plano(comuna) not in _plano(direccion):
                continue
            nombre = (p.get("displayName") or {}).get("text", "").strip()
            telefono = clean_phone(p.get("internationalPhoneNumber"))
            entregados += 1
            yield {
                "place_id": p["id"],
                "Nombre": nombre,
                "Comuna": comuna,
                "Dirección": direccion,
                "Teléfono": telefono or "No especificado",
                "WhatsApp Link": generate_whatsapp_link(telefono, nombre) or "N/A",
                "Calificación": str(p.get("rating", "")),
                "Opiniones": str(p.get("userRatingCount", 0)),
                "Sitio Web": p.get("websiteUri", ""),
                "Google Maps": p.get("googleMapsUri", ""),
            }
        token = datos.get("nextPageToken")
        if not token:
            break


def detalle(place_id: str) -> Dict[str, Any]:
    """Reseñas y descripción de un lugar, para evaluarlo con IA."""
    d = _llamar("GET", f"{BASE}/places/{place_id}?languageCode=es", MASCARA_DETALLE)
    return {
        "nombre": (d.get("displayName") or {}).get("text", ""),
        "tipos": d.get("types", []),
        "tipo_principal": d.get("primaryType", ""),
        "rating": d.get("rating"),
        "resenas_total": d.get("userRatingCount", 0),
        "descripcion": (d.get("editorialSummary") or {}).get("text", ""),
        "horario": (d.get("regularOpeningHours") or {}).get("weekdayDescriptions", []),
        "resenas": [
            {"estrellas": r.get("rating"), "texto": (r.get("text") or r.get("originalText") or {}).get("text", "")}
            for r in d.get("reviews", [])
        ],
    }
