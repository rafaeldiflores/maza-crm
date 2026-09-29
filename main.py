"""
Punto de entrada interactivo y por argumentos para el Scraper de Talleres Multirubro.
Permite seleccionar regiones preconfiguradas o ingresar comunas personalizadas.
"""

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from typing import List

# Asegurar codificación UTF-8 en consolas Windows (cp1252)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.async_api import async_playwright

from config import PRESETS_ZONAS, RUBROS_MAP, BROWSER_CONFIG
from scraper import WorkshopScraper

def banner():
    print("""
============================================================
       MAZA - SCRAPER REGIONAL DE TALLERES MULTIRUBRO       
   Prospección de Mecánica, Motos, Bicis, Detailing y más   
============================================================
""")

def select_zone_interactive() -> List[str]:
    print("\n--- PASO 1: SELECCIONA LA ZONA GEOGRÁFICA ---")
    default_key = next(iter(PRESETS_ZONAS))
    for key, data in PRESETS_ZONAS.items():
        print(f" [{key}] {data['nombre']} ({', '.join(data['comunas'][:3])}...)")
    print(" [C] Ingresar comunas manualmente (separadas por coma)")

    raw_choice = input(f"\nElige el código de zona o C [Default: {default_key}]: ").strip() or default_key
    choice_key = raw_choice.lower()

    if choice_key in PRESETS_ZONAS:
        comunas = PRESETS_ZONAS[choice_key]["comunas"]
        print(f"\n[OK] Seleccionaste: {PRESETS_ZONAS[choice_key]['nombre']}")
        print(f"    Comunas: {', '.join(comunas)}")
        return comunas
    else:
        raw = input("Escribe el nombre de las comunas (ej: San Antonio, El Quisco): ").strip()
        if not raw:
            return ["El Quisco", "Algarrobo", "San Antonio"]
        return [c.strip() for c in raw.split(",") if c.strip()]

def select_rubros_interactive() -> List[dict]:
    print("\n--- PASO 2: SELECCIONA LOS RUBROS A PROSPECTAR ---")
    print(" [T] TODOS los rubros compatibles con MAZA")
    for key, data in RUBROS_MAP.items():
        print(f" [{key}] {data['nombre']}")
    
    choice = input("\nElige rubros (ej: T para todos, o '1,2,4') [Default: T]: ").strip().upper() or "T"
    
    if choice == "T":
        return list(RUBROS_MAP.values())
    
    selected = []
    keys = [k.strip() for k in choice.split(",") if k.strip()]
    for k in keys:
        if k in RUBROS_MAP:
            selected.append(RUBROS_MAP[k])
    
    if not selected:
        return list(RUBROS_MAP.values())
    return selected

async def run_scraper(comunas: List[str], rubros: List[dict], max_per_query: int = 15, headless: bool = True, concurrency: int = 3):
    import db
    scraper = WorkshopScraper(headless=headless, max_results_per_query=max_per_query, seen_keys=db.get_seen_keys())

    output_dir = Path("exports")
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    excel_path = output_dir / f"talleres_prospeccion_{timestamp}.xlsx"
    csv_path = output_dir / f"talleres_prospeccion_{timestamp}.csv"

    jobs = [
        {"query": query, "rubro_nombre": rubro["nombre"], "comuna": comuna}
        for comuna in comunas
        for rubro in rubros
        for query in rubro["queries"]
    ]
    total_searches = len(jobs)
    effective_concurrency = 1 if not headless else max(1, min(concurrency, 5))
    print(f"\n[i] Iniciando motor con Playwright (Headless={headless}, Pestañas en paralelo={effective_concurrency})...")
    print(f"    Total de comunas: {len(comunas)}")
    print(f"    Total de rubros: {len(rubros)}")
    print(f"    Límite por búsqueda: {max_per_query} talleres")
    print(f"    Total de búsquedas: {total_searches}\n")

    done_count = 0

    async def on_job_done(job, res):
        nonlocal done_count
        done_count += 1
        print(f"[{done_count}/{total_searches}] Comuna: {job['comuna']} | Rubro: {job['rubro_nombre']} -> {len(res)} talleres")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context(**BROWSER_CONFIG)

        all_results = await scraper.scrape_batch(context, jobs, concurrency=effective_concurrency, on_job_done=on_job_done)

        await browser.close()
        
    print(f"\n{'='*60}")
    print(f" EXTRACCIÓN FINALIZADA: {len(all_results)} TALLERES ÚNICOS REGISTRADOS")
    print(f"{'='*60}")
    
    if all_results:
        # Métricas rápidas
        con_telefono = sum(1 for x in all_results if x["Teléfono"] != "No especificado")
        con_whatsapp = sum(1 for x in all_results if x["WhatsApp Link"] != "N/A")
        
        print(f" * Talleres con teléfono: {con_telefono} ({con_telefono/len(all_results)*100:.1f}%)")
        print(f" * Talleres con WhatsApp directo: {con_whatsapp} ({con_whatsapp/len(all_results)*100:.1f}%)")
        
        scraper.export_excel(all_results, excel_path)
        scraper.export_csv(all_results, csv_path)
    else:
        print("[!] No se encontraron resultados con los filtros seleccionados.")

def main():
    banner()
    
    parser = argparse.ArgumentParser(description="Scraper Regional de Talleres Multirubro para MAZA")
    parser.add_argument("--comunas", type=str, help="Comunas separadas por coma (ej: 'El Quisco,Algarrobo')")
    parser.add_argument("--preset", type=str, choices=list(PRESETS_ZONAS.keys()), help="ID de preset regional (1 a 6)")
    parser.add_argument("--rubro", type=str, help="Código de rubro o 'todos' (mecanica, motos, bicicletas, detailing, desabolladura, lubricentro)")
    parser.add_argument("--max", type=int, default=15, help="Máximo de talleres por búsqueda (default: 15)")
    parser.add_argument("--visual", action="store_true", help="Abre el navegador de forma visible")
    parser.add_argument("--concurrency", type=int, default=3, help="Búsquedas simultáneas en modo headless (default: 3, máx: 5)")
    
    args = parser.parse_args()
    
    headless = not args.visual
    
    # Modo CLI con argumentos
    if args.comunas or args.preset:
        if args.preset:
            comunas = PRESETS_ZONAS[args.preset]["comunas"]
        else:
            comunas = [c.strip() for c in args.comunas.split(",") if c.strip()]
            
        if args.rubro and args.rubro != "todos":
            selected_rubros = [r for r in RUBROS_MAP.values() if r["codigo"] == args.rubro]
            if not selected_rubros:
                selected_rubros = list(RUBROS_MAP.values())
        else:
            selected_rubros = list(RUBROS_MAP.values())
            
        asyncio.run(run_scraper(comunas, selected_rubros, max_per_query=args.max, headless=headless, concurrency=args.concurrency))
        return

    # Modo Interactivo
    comunas = select_zone_interactive()
    rubros = select_rubros_interactive()

    max_input = input("\nMáximo de talleres por búsqueda [Default: 15]: ").strip()
    max_val = int(max_input) if max_input.isdigit() else 15

    vis_input = input("¿Deseas ver el navegador mientras trabaja? (s/N) [Default: No]: ").strip().lower()
    headless = vis_input != "s"

    asyncio.run(run_scraper(comunas, rubros, max_per_query=max_val, headless=headless))

if __name__ == "__main__":
    main()
