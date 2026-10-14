"""
Módulo de integración con Brevo (API v3) para envíos transaccionales en MAZA CRM.

Usa la librería estándar `urllib.request` para no sumar dependencias externas
y garantizar portabilidad en Cloud Run y entornos locales.
"""

from __future__ import annotations

import base64
import html
import json
import logging
import os
import urllib.error
import urllib.request


logger = logging.getLogger("brevo")

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"
GOOGLE_PLAY_TEST_URL = "https://play.google.com/apps/internaltest/4701741473879421946"
DEFAULT_SENDER_NAME = "MAZA · Gestión de Talleres"
DEFAULT_SENDER_EMAIL = "contacto@mazataller.com"
ASUNTO_INVITACION = "Acceso Taller Fundador · MAZA"


def generar_contenido_html(taller: str, codigo: str, link_web: str) -> str:
    """Genera la plantilla HTML oficial para Talleres Fundadores (colores: #1A1A2E, #FF9900, #F0F4F8)."""
    taller_limpio = (taller or "").strip()
    taller_nom = html.escape(taller_limpio) if taller_limpio else "su taller"
    saludo = f"¡Hola, equipo de {taller_nom}!" if taller_limpio else "¡Hola!"
    codigo_esc = html.escape((codigo or "").strip())
    link_web_esc = html.escape((link_web or "").strip())
    play_url_esc = html.escape(GOOGLE_PLAY_TEST_URL)

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{ASUNTO_INVITACION}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F0F4F8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1A2E; -webkit-font-smoothing: antialiased;">
  <!-- Pre-encabezado invisible para la vista previa en la bandeja de entrada -->
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
    Bienvenido al programa de Talleres Fundadores de MAZA. Aquí tienes tu código de activación y enlaces de instalación.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F0F4F8; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(26, 26, 46, 0.08); border: 1px solid #E2E8F0;">
          
          <!-- Encabezado con colores de marca -->
          <tr>
            <td style="background-color: #1A1A2E; padding: 28px 32px; border-bottom: 4px solid #FF9900;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 26px; font-weight: 800; color: #FF9900; letter-spacing: 1px;">MAZA</span>
                    <span style="font-size: 15px; color: #CBD5E1; margin-left: 8px; font-weight: 400;">· Gestión de Talleres</span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; background-color: rgba(255, 153, 0, 0.18); color: #FF9900; border: 1px solid #FF9900; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                      Taller Fundador
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Cuerpo principal -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 800; color: #1A1A2E; line-height: 1.3;">
                {saludo}
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                Nos complace confirmarles que fueron seleccionados para formar parte del programa exclusivo de <strong>Talleres Fundadores de MAZA</strong>. Tendrán acceso preferente a nuestra plataforma para digitalizar y ordenar la gestión integral de su taller.
              </p>

              <!-- Paso 1 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; margin-bottom: 20px; padding: 20px;">
                <tr>
                  <td style="vertical-align: top; width: 36px;">
                    <div style="width: 28px; height: 28px; background-color: #FF9900; color: #FFFFFF; font-weight: 800; font-size: 14px; line-height: 28px; text-align: center; border-radius: 50%;">1</div>
                  </td>
                  <td style="vertical-align: top; padding-left: 8px;">
                    <div style="font-size: 16px; font-weight: 700; color: #1A1A2E; margin-bottom: 6px;">
                      Instalar la app en Android
                    </div>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #475569;">
                      Acepten la invitación al programa de prueba interna en Google Play e instalen la app en sus dispositivos móviles:
                    </p>
                    <a href="{play_url_esc}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #1A1A2E; color: #FFFFFF; text-decoration: none; font-size: 13px; font-weight: 700; padding: 11px 20px; border-radius: 6px; letter-spacing: 0.3px;">
                      📲 Abrir en Google Play (Prueba interna)
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Paso 2 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FFFDF8; border: 1px solid #FED7AA; border-radius: 8px; margin-bottom: 24px; padding: 20px;">
                <tr>
                  <td style="vertical-align: top; width: 36px;">
                    <div style="width: 28px; height: 28px; background-color: #FF9900; color: #FFFFFF; font-weight: 800; font-size: 14px; line-height: 28px; text-align: center; border-radius: 50%;">2</div>
                  </td>
                  <td style="vertical-align: top; padding-left: 8px;">
                    <div style="font-size: 16px; font-weight: 700; color: #1A1A2E; margin-bottom: 6px;">
                      Ingresar su código de activación
                    </div>
                    <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #475569;">
                      Al abrir la app por primera vez, el sistema les solicitará el código de invitación para desbloquear su cuenta:
                    </p>
                    <div style="background-color: #FFFFFF; border: 2px dashed #FF9900; border-radius: 8px; padding: 12px 16px; text-align: center; margin: 10px 0;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 24px; font-weight: 800; color: #1A1A2E; letter-spacing: 3px;">
                        {codigo_esc}
                      </span>
                    </div>
                    <span style="font-size: 12px; color: #64748B;">
                      * Código personal de un solo uso exclusivo para su taller.
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Alternativa Web -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; border-left: 4px solid #1A1A2E; border-radius: 0 8px 8px 0; margin-bottom: 24px; padding: 16px 20px;">
                <tr>
                  <td>
                    <div style="font-size: 14px; font-weight: 700; color: #1A1A2E; margin-bottom: 4px;">
                      💻 Alternativa Web (PC / Mesón de atención)
                    </div>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #475569;">
                      Si prefieren operar directamente desde el computador de recepción o mesón, pueden crear su acceso desde este enlace directo:
                    </p>
                    <a href="{link_web_esc}" target="_blank" rel="noopener noreferrer" style="color: #FF9900; font-weight: 700; font-size: 13px; word-break: break-all; text-decoration: underline;">
                      {link_web_esc}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Soporte directo -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F0F4F8; border-radius: 8px; padding: 16px 20px;">
                <tr>
                  <td>
                    <div style="font-size: 14px; font-weight: 700; color: #1A1A2E; margin-bottom: 4px;">
                      🤝 Soporte directo y acompañamiento
                    </div>
                    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #475569;">
                      Ante cualquier duda durante la instalación o el alta del equipo, pueden <strong>responder directamente a este correo</strong> o comunicarse al <strong>WhatsApp oficial de MAZA</strong>. Nuestro equipo técnico los asistirá de inmediato.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Pie de página -->
          <tr>
            <td style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #1A1A2E;">
                MAZA · Gestión y Crecimiento para Talleres
              </p>
              <p style="margin: 0; font-size: 11px; color: #94A3B8;">
                Este correo fue despachado automáticamente tras la generación de su invitación oficial.<br>
                <a href="https://mazataller.com" target="_blank" rel="noopener noreferrer" style="color: #FF9900; text-decoration: none;">mazataller.com</a> · contacto@mazataller.com
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def generar_contenido_texto(taller: str, codigo: str, link_web: str) -> str:
    """Genera la versión en texto plano para clientes de correo sin soporte HTML."""
    taller_limpio = (taller or "").strip()
    saludo = f"¡Hola, equipo de {taller_limpio}!" if taller_limpio else "¡Hola!"
    return (
        f"{saludo}\n\n"
        "Nos complace confirmarles que fueron seleccionados para formar parte del "
        "programa exclusivo de Talleres Fundadores de MAZA.\n\n"
        "A continuación, los pasos para activar su acceso e iniciar la configuración:\n\n"
        "============================================================\n"
        "PASO 1: Instalar la app en Android (Prueba interna)\n"
        "============================================================\n"
        "Acepten la invitación e instalen la app desde Google Play:\n"
        f"{GOOGLE_PLAY_TEST_URL}\n\n"
        "============================================================\n"
        "PASO 2: Ingresar su código de activación\n"
        "============================================================\n"
        "Al abrir la app, ingresen su código único de invitación:\n"
        f"Código: {codigo}\n\n"
        "* Código de un solo uso exclusivo para su taller.\n\n"
        "------------------------------------------------------------\n"
        "ALTERNATIVA WEB (PC / Mesón de atención):\n"
        "Si prefieren registrarse u operar desde el computador del mesón, "
        "pueden ingresar directamente aquí:\n"
        f"{link_web}\n"
        "------------------------------------------------------------\n\n"
        "SOPORTE DIRECTO:\n"
        "Ante cualquier duda durante la instalación o el inicio del sistema, pueden "
        "responder directamente a este correo o comunicarse al WhatsApp oficial de MAZA.\n\n"
        "--\n"
        "MAZA · Gestión de Talleres\n"
        "contacto@mazataller.com | https://mazataller.com\n"
    )


def _obtener_api_key() -> str:
    """Obtiene la clave API de Brevo, soportando clave directa xkeysib-... o token Base64 JSON de Brevo."""
    raw = os.environ.get("BREVO_API_KEY", "").strip()
    if not raw:
        return ""
    if raw.startswith("eyJ") or raw.startswith("{"):
        try:
            texto = base64.b64decode(raw).decode("utf-8") if raw.startswith("eyJ") else raw
            datos = json.loads(texto)
            if isinstance(datos, dict) and "api_key" in datos:
                return str(datos["api_key"]).strip()
        except Exception:
            pass
    return raw


def enviar_correo_invitacion(
    taller: str,
    email: str,
    codigo: str,
    link_web: str,
) -> bool:
    """
    Envía el correo transaccional de invitación a través de la API v3 de Brevo.

    Retorna True si el correo fue despachado exitosamente, False en caso contrario.
    Nunca propaga excepciones para no interrumpir el flujo del negocio.
    """
    email_dest = (email or "").strip()
    if not email_dest:
        logger.warning("No se puede enviar invitación por Brevo: email vacío.")
        return False

    api_key = _obtener_api_key()
    if not api_key:
        logger.warning(
            "BREVO_API_KEY no está configurada en las variables de entorno. "
            "No se enviará el correo a %s.", email_dest
        )
        return False


    sender_name = os.environ.get("BREVO_SENDER_NAME", DEFAULT_SENDER_NAME).strip() or DEFAULT_SENDER_NAME
    sender_email = os.environ.get("BREVO_SENDER_EMAIL", DEFAULT_SENDER_EMAIL).strip() or DEFAULT_SENDER_EMAIL

    payload = {
        "sender": {
            "name": sender_name,
            "email": sender_email,
        },
        "to": [
            {
                "email": email_dest,
                "name": (taller or "").strip() or email_dest,
            }
        ],
        "subject": ASUNTO_INVITACION,
        "htmlContent": generar_contenido_html(taller, codigo, link_web),
        "textContent": generar_contenido_texto(taller, codigo, link_web),
    }

    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url=BREVO_API_URL,
            data=data_bytes,
            headers={
                "accept": "application/json",
                "api-key": api_key,
                "content-type": "application/json",
                "user-agent": "MAZA-CRM/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            status_code = resp.getcode()
            if 200 <= status_code < 300:
                logger.info(
                    "Correo de invitación Brevo enviado a %s para '%s' (HTTP %s)",
                    email_dest, taller, status_code
                )
                return True
            logger.warning(
                "Respuesta inesperada de Brevo para %s (HTTP %s)",
                email_dest, status_code
            )
            return False

    except urllib.error.HTTPError as e:
        detalle = ""
        try:
            detalle = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        logger.error(
            "Error HTTP al enviar correo por Brevo a %s (%s): %s",
            email_dest, e.code, detalle or e.reason
        )
        return False
    except urllib.error.URLError as e:
        logger.error(
            "Error de red/conexión con Brevo al enviar a %s: %s",
            email_dest, e.reason
        )
        return False
    except Exception as e:
        logger.error(
            "Error inesperado al despachar correo por Brevo a %s: %s",
            email_dest, e
        )
        return False
