"""
Reserva en `nombresTaller` el nombre de los talleres creados antes del índice
(ver maza_admin.reservar_nombres_existentes). Una sola vez.

    .venv\Scripts\python reservar_nombres_taller.py            # simulación: solo informa
    .venv\Scripts\python reservar_nombres_taller.py --aplicar  # escribe y audita

MAZA_EMULADOR=1 para probar contra el emulador.
"""
import sys

import maza_admin

if __name__ == "__main__":
    aplicar = "--aplicar" in sys.argv
    r = maza_admin.reservar_nombres_existentes(aplicar=aplicar)
    titulo = "Reservados" if aplicar else "Se reservarían"
    print(f"{titulo}: {len(r['reservados'])}")
    for f in r["reservados"]:
        print(f"  {f['clave']:<40} {f['nombre']}  ({f['uid']})")
    print(f"Conflictos (mismo nombre, resolver a mano): {len(r['conflictos'])}")
    for f in r["conflictos"]:
        print(f"  {f['clave']:<40} {f['nombre']}  ({f['uid']}) — tomado por {f['tomadoPor']}")
    if not aplicar:
        print("\nSimulación. Para escribir: --aplicar")
