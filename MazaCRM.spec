# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

# firebase-admin y el cliente de Firestore cargan módulos, datos (protos) y
# metadatos de paquetes por nombre: collect_all los arrastra completos.
_extra_datas, _extra_bins, _extra_hidden = [], [], []
for _paquete in ('firebase_admin', 'google.cloud.firestore', 'google.cloud.firestore_v1', 'grpc'):
    _d, _b, _h = collect_all(_paquete)
    _extra_datas += _d
    _extra_bins += _b
    _extra_hidden += _h


a = Analysis(
    ['run_crm.py'],
    pathex=[],
    binaries=_extra_bins,
    datas=[('templates', 'templates'), ('static', 'static')] + _extra_datas,
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        'openpyxl',
        'sqlite3',
        'multipart',
        'playwright',
        'playwright.async_api',
        'scraper',
        'config',
        'ai_analyzer',
        'db',
        'maza_admin',
        'maza_rutas',
        'pystray',
        'pystray._win32',
        'PIL',
        'PIL.Image',
    ] + _extra_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='MazaCRM',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # Sin ventana de consola: la app vive como ícono de bandeja del sistema
    # (ver run_crm.py). Si algo falla antes de que el ícono aparezca, revisa
    # maza_crm.log junto al .exe.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='static/icon.ico',
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='MazaCRM',
)
