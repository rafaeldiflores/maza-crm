"""
Conexión a Firebase compartida por el CRM (db.py) y Cuentas MAZA (maza_admin.py).

Credenciales: las de `gcloud auth application-default login` del dueño, sin
archivos de clave. MAZA_EMULADOR=1 apunta al emulador de Firebase (proyecto
demo-litoralbikes, puertos por defecto) para probar sin tocar producción.

Los datos del CRM viven en colecciones `crm*` del mismo proyecto de MAZA. Las
reglas de Firestore y Storage de MAZA terminan en "todo lo demás, cerrado", así
que ninguna app cliente puede leerlas: solo firebase-admin, que las saltea.
"""
from __future__ import annotations

import os
from functools import lru_cache

EMULADOR = os.environ.get("MAZA_EMULADOR") == "1"
if EMULADOR:
    os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "localhost:8080")
    os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")

PROYECTO = "demo-litoralbikes" if EMULADOR else "litoralbikes-7d29d"
BUCKET = f"{PROYECTO}.firebasestorage.app"


@lru_cache(maxsize=1)
def app():
    import firebase_admin
    return firebase_admin.initialize_app(options={"projectId": PROYECTO, "storageBucket": BUCKET})


def firestore_db():
    from firebase_admin import firestore
    return firestore.client(app())


def bucket():
    """Storage del proyecto. En modo emulador no hay: los audios quedan solo
    en disco (el emulador de Storage no se levanta para el CRM)."""
    if EMULADOR:
        return None
    from firebase_admin import storage
    return storage.bucket(app=app())
