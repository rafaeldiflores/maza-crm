# MAZA CRM

Prospección de talleres multirubro y back office de MAZA, en https://crm-maza-668610164530.southamerica-west1.run.app (entra con tu Google; acceso por IAP).

## Qué hace

- **Prospectos**: talleres en tarjetas o pipeline, filtros, etapa del embudo con un clic, notas, WhatsApp con plantillas, ficha con grabadora de visita (audio + transcripción) e informe con IA.
- **Rastrear talleres**: busca por comuna y rubro con Google Places; los nuevos entran priorizados con Gemini (puntaje, dolores sacados de sus reseñas y primer mensaje).
- **Herramientas**: panel de conversión, plan de ruta del día en Google Maps, posibles duplicados, guía de pitch.
- **Hoy / Cuentas / Cobros / Métricas / Soporte / Errores / Auditoría** (solo admin): salud de cada cuenta de MAZA por su uso real, planes, pagos, MRR, tickets y registro de cada cambio.

## Instalar en el celular o el PC

Abre la URL en Chrome o Brave → menú → **Instalar app** (o "Agregar a pantalla de inicio"). Se actualiza sola con cada deploy.

## Desarrollo

Ver `CLAUDE.md` (arquitectura, desarrollo local contra el emulador y deploy).

## Datos viejos

`python migrar_a_nube.py <ruta a crm_talleres.db> [--simular]` sube una base SQLite del CRM anterior, juntando por nombre + comuna.
