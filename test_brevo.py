"""
Pruebas unitarias para brevo.py y la integración en maza_admin y maza_rutas.
"""

import io
import json
import os
import sys
import types
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

# Asegurar mock para google.api_core.exceptions si el entorno local no tiene google instalado
if "google.api_core.exceptions" not in sys.modules:
    mock_mod = types.ModuleType("google.api_core.exceptions")
    class AlreadyExists(Exception):
        pass
    mock_mod.AlreadyExists = AlreadyExists
    sys.modules["google.api_core.exceptions"] = mock_mod

if "fastapi" not in sys.modules:
    mock_fastapi = types.ModuleType("fastapi")
    class APIRouter:
        def __init__(self, *args, **kwargs): pass
        def get(self, *args, **kwargs): return lambda f: f
        def post(self, *args, **kwargs): return lambda f: f
        def delete(self, *args, **kwargs): return lambda f: f
    mock_fastapi.APIRouter = APIRouter
    class HTTPException(Exception):
        def __init__(self, status_code, detail=""):
            self.status_code = status_code
            self.detail = detail
    mock_fastapi.HTTPException = HTTPException
    sys.modules["fastapi"] = mock_fastapi

if "pydantic" not in sys.modules:
    mock_pydantic = types.ModuleType("pydantic")
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
    mock_pydantic.BaseModel = BaseModel
    sys.modules["pydantic"] = mock_pydantic

import brevo




class TestBrevoModule(unittest.TestCase):
    def setUp(self):
        self.taller = "Taller Los Tuercas"
        self.email = "lostuercas@example.com"
        self.codigo = "MAZA-ABCD-1234"
        self.link_web = "https://mazataller.com/app/registrar?inv=MAZA-ABCD-1234"

    def test_generar_contenido_html(self):
        html = brevo.generar_contenido_html(self.taller, self.codigo, self.link_web)
        
        # Validación de datos clave
        self.assertIn("Taller Los Tuercas", html)
        self.assertIn("MAZA-ABCD-1234", html)
        self.assertIn("https://mazataller.com/app/registrar?inv=MAZA-ABCD-1234", html)
        self.assertIn("https://play.google.com/apps/internaltest/4701741473879421946", html)
        
        # Validación de colores de marca requeridos
        self.assertIn("#1A1A2E", html)
        self.assertIn("#FF9900", html)
        self.assertIn("#F0F4F8", html)

        # Validación de los 5 pasos/secciones
        self.assertIn("Talleres Fundadores", html)
        self.assertIn("Instalar la app en Android", html)
        self.assertIn("código de activación", html)
        self.assertIn("Alternativa Web", html)
        self.assertIn("Soporte directo", html)

    def test_generar_contenido_texto(self):
        texto = brevo.generar_contenido_texto(self.taller, self.codigo, self.link_web)
        
        self.assertIn("Taller Los Tuercas", texto)
        self.assertIn("MAZA-ABCD-1234", texto)
        self.assertIn(self.link_web, texto)
        self.assertIn("https://play.google.com/apps/internaltest/4701741473879421946", texto)
        self.assertIn("PASO 1", texto)
        self.assertIn("PASO 2", texto)
        self.assertIn("ALTERNATIVA WEB", texto)
        self.assertIn("SOPORTE DIRECTO", texto)

    def test_obtener_api_key_formatos(self):
        # Raw
        with patch.dict(os.environ, {"BREVO_API_KEY": "xkeysib-abc-123"}):
            self.assertEqual(brevo._obtener_api_key(), "xkeysib-abc-123")
        # Base64 JSON token dummy
        token_b64 = "eyJhcGlfa2V5IjogInhrZXlzaWItZHVtbXkta2V5In0="
        with patch.dict(os.environ, {"BREVO_API_KEY": token_b64}):
            self.assertEqual(brevo._obtener_api_key(), "xkeysib-dummy-key")


    def test_sin_api_key_retorna_false(self):

        with patch.dict(os.environ, {}, clear=True):
            resultado = brevo.enviar_correo_invitacion(
                self.taller, self.email, self.codigo, self.link_web
            )
            self.assertFalse(resultado)

    def test_con_email_vacio_retorna_false(self):
        with patch.dict(os.environ, {"BREVO_API_KEY": "dummy_key"}):
            resultado = brevo.enviar_correo_invitacion(
                self.taller, "", self.codigo, self.link_web
            )
            self.assertFalse(resultado)

    @patch("urllib.request.urlopen")
    def test_envio_exitoso(self, mock_urlopen):
        # Mock de respuesta HTTP 201 de Brevo
        mock_resp = MagicMock()
        mock_resp.getcode.return_value = 201
        mock_resp.read.return_value = json.dumps({"messageId": "<test-id@smtp-relay.mailin.fr>"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        with patch.dict(os.environ, {"BREVO_API_KEY": "xkeysib-test-1234"}):
            resultado = brevo.enviar_correo_invitacion(
                self.taller, self.email, self.codigo, self.link_web
            )
            self.assertTrue(resultado)

            # Verificar argumentos de la llamada HTTP
            mock_urlopen.assert_called_once()
            req = mock_urlopen.call_args[0][0]
            self.assertEqual(req.full_url, "https://api.brevo.com/v3/smtp/email")
            self.assertEqual(req.get_header("Api-key"), "xkeysib-test-1234")
            self.assertEqual(req.get_header("Content-type"), "application/json")
            self.assertEqual(req.get_header("Accept"), "application/json")

            cuerpo = json.loads(req.data.decode("utf-8"))
            self.assertEqual(cuerpo["sender"]["name"], "MAZA · Gestión de Talleres")
            self.assertEqual(cuerpo["sender"]["email"], "contacto@mazataller.com")
            self.assertEqual(cuerpo["to"][0]["email"], "lostuercas@example.com")
            self.assertEqual(cuerpo["subject"], "Acceso Taller Fundador · MAZA")
            self.assertIn("htmlContent", cuerpo)
            self.assertIn("textContent", cuerpo)

    @patch("urllib.request.urlopen")
    def test_error_http_brevo_capturado_sin_excepcion(self, mock_urlopen):
        # Mock de error HTTP 401
        err_stream = io.BytesIO(b'{"code":"unauthorized","message":"Key not found"}')
        http_error = urllib.error.HTTPError(
            url="https://api.brevo.com/v3/smtp/email",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=err_stream,
        )
        mock_urlopen.side_effect = http_error

        with patch.dict(os.environ, {"BREVO_API_KEY": "bad-key"}):
            resultado = brevo.enviar_correo_invitacion(
                self.taller, self.email, self.codigo, self.link_web
            )
            self.assertFalse(resultado)


class TestMazaAdminCrearInvitacion(unittest.TestCase):
    @patch("maza_admin._db")
    @patch("maza_admin._auditar")
    @patch("brevo.enviar_correo_invitacion")
    def test_crear_invitacion_con_email_exitoso(self, mock_enviar, mock_auditar, mock_db):
        mock_doc = MagicMock()
        mock_coll = MagicMock()
        mock_coll.document.return_value = mock_doc
        mock_firestore = MagicMock()
        mock_firestore.collection.return_value = mock_coll
        mock_db.return_value = mock_firestore

        mock_enviar.return_value = True

        import maza_admin
        resultado = maza_admin.crear_invitacion(
            taller="Taller San Miguel",
            nota="Nota de prueba",
            email="sanmiguel@taller.cl",
        )

        self.assertTrue(resultado["codigo"].startswith("MAZA-"))
        self.assertEqual(resultado["taller"], "Taller San Miguel")
        self.assertEqual(resultado["email"], "sanmiguel@taller.cl")
        self.assertTrue(resultado["correoEnviado"])

        # Verificar que se persistió en Firestore con email
        mock_doc.create.assert_called_once()
        datos_guardados = mock_doc.create.call_args[0][0]
        self.assertEqual(datos_guardados["email"], "sanmiguel@taller.cl")
        self.assertEqual(datos_guardados["taller"], "Taller San Miguel")

        # Verificar que se llamó a enviar_correo_invitacion
        mock_enviar.assert_called_once_with(
            taller="Taller San Miguel",
            email="sanmiguel@taller.cl",
            codigo=resultado["codigo"],
            link_web=resultado["link"],
        )

    @patch("maza_admin._db")
    @patch("maza_admin._auditar")
    @patch("brevo.enviar_correo_invitacion")
    def test_crear_invitacion_sin_email(self, mock_enviar, mock_auditar, mock_db):
        mock_doc = MagicMock()
        mock_coll = MagicMock()
        mock_coll.document.return_value = mock_doc
        mock_firestore = MagicMock()
        mock_firestore.collection.return_value = mock_coll
        mock_db.return_value = mock_firestore

        import maza_admin
        resultado = maza_admin.crear_invitacion(
            taller="Taller Sin Email",
            nota="Nota",
            email=None,
        )

        self.assertFalse(resultado["correoEnviado"])
        self.assertNotIn("email", resultado)
        mock_enviar.assert_not_called()

    @patch("maza_admin._db")
    @patch("maza_admin._auditar")
    @patch("brevo.enviar_correo_invitacion")
    def test_falla_brevo_no_impide_creacion_firestore(self, mock_enviar, mock_auditar, mock_db):
        mock_doc = MagicMock()
        mock_coll = MagicMock()
        mock_coll.document.return_value = mock_doc
        mock_firestore = MagicMock()
        mock_firestore.collection.return_value = mock_coll
        mock_db.return_value = mock_firestore

        # Simular que Brevo explota con excepción de red
        mock_enviar.side_effect = RuntimeError("Conexión perdida a Brevo")

        import maza_admin
        resultado = maza_admin.crear_invitacion(
            taller="Taller Resiliente",
            email="resiliente@taller.cl",
        )

        # El código se creó y se guardó en Firestore a pesar del error de Brevo
        mock_doc.create.assert_called_once()
        self.assertTrue(resultado["codigo"].startswith("MAZA-"))
        self.assertEqual(resultado["correoEnviado"], False)


class TestMazaRutas(unittest.TestCase):
    @patch("maza_admin.crear_invitacion")
    def test_endpoint_crear_invitacion(self, mock_crear):
        import maza_rutas
        mock_crear.return_value = {
            "codigo": "MAZA-TEST-1234",
            "taller": "Taller API",
            "nota": "Desde API",
            "email": "api@taller.cl",
            "correoEnviado": True,
        }

        payload = maza_rutas.InvitacionNueva(
            taller="Taller API",
            nota="Desde API",
            email="api@taller.cl",
        )
        resp = maza_rutas.crear_invitacion(payload)

        mock_crear.assert_called_once_with("Taller API", "Desde API", "api@taller.cl")
        self.assertEqual(resp["codigo"], "MAZA-TEST-1234")
        self.assertEqual(resp["email"], "api@taller.cl")
        self.assertTrue(resp["correoEnviado"])


if __name__ == "__main__":
    unittest.main()

