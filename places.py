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
    "userRatingCount", "websiteUri", "googleMapsUri", "businessStatus", "primaryType", "location",
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
            loc = p.get("location") or {}
            lat = loc.get("latitude")
            lng = loc.get("longitude")
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
                "lat": lat,
                "lng": lng,
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


def optimizar_ruta(origen: Dict[str, float], paradas: List[str], volver: bool) -> Dict[str, Any]:
    """Orden de visita que minimiza el recorrido (Routes API, optimizeWaypointOrder).
    `origen` = {lat, lng} del vendedor; `paradas` = direcciones. Con `volver`, la
    ruta termina donde empezó; si no, en la última parada del orden óptimo."""
    punto = {"location": {"latLng": {"latitude": origen["lat"], "longitude": origen["lng"]}}}
    if volver:
        destino, intermedias = punto, paradas
    else:
        # Sin vuelta, Routes necesita un destino fijo: se usa la última parada
        # elegida y se optimiza el orden de las demás.
        destino, intermedias = {"address": paradas[-1]}, paradas[:-1]
    cuerpo = {
        "origin": punto,
        "destination": destino,
        "intermediates": [{"address": a} for a in intermedias],
        "travelMode": "DRIVE",
        "optimizeWaypointOrder": True,
        "languageCode": "es",
        "regionCode": "CL",
    }
    r = _sesion().post("https://routes.googleapis.com/directions/v2:computeRoutes", json=cuerpo, timeout=30, headers={
        "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.endLocation",
        "X-Goog-User-Project": nube.PROYECTO_REAL,
    })
    if r.status_code >= 400:
        raise RuntimeError(f"Routes API {r.status_code}: {r.text[:300]}")
    ruta = (r.json().get("routes") or [{}])[0]
    idx = ruta.get("optimizedIntermediateWaypointIndex") or list(range(len(intermedias)))
    orden = [idx[i] for i in range(len(intermedias))] + ([] if volver else [len(paradas) - 1])
    # En una vuelta el total es igual en ambos sentidos: se parte por la parada
    # más cercana al vendedor (primer tramo vs. tramo de regreso).
    tramos = [l.get("distanceMeters", 0) for l in ruta.get("legs", [])]
    # Coordenadas de cada parada (fin de cada tramo), para avisar por cercanía.
    fines = [((l.get("endLocation") or {}).get("latLng") or {}) for l in ruta.get("legs", [])]
    coords = [{"lat": f.get("latitude"), "lng": f.get("longitude")} for f in fines[:len(orden)]]
    if volver and len(tramos) >= 2 and tramos[-1] < tramos[0]:
        orden.reverse()
        coords.reverse()
    return {"orden": orden, "coords": coords, "metros": ruta.get("distanceMeters", 0), "segundos": int(str(ruta.get("duration", "0s")).rstrip("s") or 0)}
