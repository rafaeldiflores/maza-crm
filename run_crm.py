"""
Lanzador ejecutable para MAZA CRM & Scraper Regional de Talleres.
Inicia el servidor local y abre automáticamente el navegador en http://localhost:8000.

En el ejecutable compilado (.exe) corre sin ventana de consola: vive como un
ícono en la bandeja del sistema (system tray) con opciones para reabrir el
panel o salir, en vez de dejar una ventana negra de fondo.
"""

import os
import sys
import time
import webbrowser
import threading
from pathlib import Path

# Ajustar directorio base en modo congelado (PyInstaller). Todo lo que el CRM
# guarda (db, exports, recordings, log) vive junto al .exe, nunca en una ruta
# temporal — así la carpeta completa se puede copiar/mover a otro equipo o pendrive
# y seguir funcionando con los mismos datos.
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent

os.chdir(str(BASE_DIR))

# En el .exe compilado SIN consola (windowed), sys.stdout/sys.stderr son None.
# Cualquier print() sin este resguardo haría crashear la app apenas alguien
# usara el scraper (que imprime su progreso). Se redirige todo a un log file
# junto al ejecutable: además sirve como bitácora para soporte técnico.
if getattr(sys, 'frozen', False):
    _log_path = BASE_DIR / "maza_crm.log"
    _log_file = open(_log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = _log_file
    sys.stderr = _log_file
else:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Configurar ruta de navegadores de Playwright
local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser(r"~\AppData\Local"))
system_browsers = Path(local_appdata) / "ms-playwright"

if getattr(sys, 'frozen', False):
    bundle_browsers = BASE_DIR / "_internal" / "playwright" / "driver" / "package" / ".local-browsers"
    if bundle_browsers.exists() and any(bundle_browsers.glob("chromium*")):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(bundle_browsers)
    elif system_browsers.exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(system_browsers)
else:
    if system_browsers.exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(system_browsers)

import uvicorn
import db
from app import app

SERVER_URL = "http://localhost:8000"
_server = None  # referencia al uvicorn.Server en curso, para poder detenerlo


def open_browser():
    time.sleep(1.2)
    print(f"\n[+] Abriendo panel en tu navegador: {SERVER_URL} ...")
    try:
        webbrowser.open(SERVER_URL)
    except Exception as e:
        print(f"[!] No se pudo abrir automáticamente el navegador: {e}")


def start_server():
    """Corre uvicorn en un hilo de fondo. uvicorn detecta automáticamente que
    no está en el hilo principal y evita instalar signal handlers (que solo
    funcionan en el hilo principal), por lo que este patrón es seguro."""
    global _server
    config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="info")
    _server = uvicorn.Server(config)
    _server.run()


def stop_and_exit(icon=None, item=None):
    print("[i] Cerrando MAZA CRM...")
    if _server is not None:
        _server.should_exit = True
    if icon is not None:
        icon.stop()
    # Red de seguridad: garantiza que el proceso termine del todo aunque quede
    # algún hilo colgado (ej. un scraping de Playwright en curso).
    threading.Timer(2.0, lambda: os._exit(0)).start()


def run_tray_icon():
    """Ícono de bandeja del sistema: reemplaza la ventana de consola en el
    ejecutable compilado. Clic izquierdo reabre el panel; el menú permite
    salir de forma controlada (cierra el servidor antes de terminar)."""
    import pystray
    from PIL import Image

    icon_path = BASE_DIR / "static" / "icon.ico"
    try:
        image = Image.open(icon_path) if icon_path.exists() else Image.new("RGB", (64, 64), (245, 158, 11))
    except Exception:
        image = Image.new("RGB", (64, 64), (245, 158, 11))

    menu = pystray.Menu(
        pystray.MenuItem("Abrir MAZA CRM", lambda: webbrowser.open(SERVER_URL), default=True),
        pystray.MenuItem("Salir", stop_and_exit),
    )
    icon = pystray.Icon("MazaCRM", image, "MAZA CRM & Prospección", menu)
    icon.run()


def main():
    print("=" * 60)
    print("       MAZA CRM & SUITE DE PROSPECCIÓN DE TALLERES       ")
    print("=" * 60)
    print(f"Ruta de datos: {BASE_DIR}")
    print(f"Servidor activo en: {SERVER_URL}")
    print("=" * 60 + "\n")

    # El CRM se carga desde Firestore al importar app (db.init_db); si falla,
    # la interfaz lo muestra en un aviso en vez de cerrar el programa.

    # Servidor y navegador en hilos de fondo
    threading.Thread(target=start_server, daemon=True).start()
    threading.Thread(target=open_browser, daemon=True).start()

    if getattr(sys, 'frozen', False):
        # Ejecutable compilado sin consola: vive como ícono de bandeja hasta
        # que el usuario elija "Salir".
        run_tray_icon()
    else:
        print("Modo desarrollo: presiona Ctrl + C en esta consola para salir.\n")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            stop_and_exit()


if __name__ == "__main__":
    main()
