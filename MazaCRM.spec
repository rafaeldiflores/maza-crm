# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['run_crm.py'],
    pathex=[],
    binaries=[],
    datas=[('templates', 'templates'), ('static', 'static')],
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
        'pystray',
        'pystray._win32',
        'PIL',
        'PIL.Image',
    ],
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
