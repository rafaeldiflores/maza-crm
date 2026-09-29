# MAZA — CRM & Suite de Prospección Regional de Talleres 🛠️📱

Herramienta comercial completa para **MAZA**, diseñada para la prospección en terreno de talleres multirubro (Mecánica, Motos, Bicicletas, Detailing, Desabolladura y Lubricentros).

Combina **extracción automatizada de Google Maps**, un **panel CRM interactivo**, **grabadora de reuniones con transcripción de voz** y **generación automática de informes de visita**.

---

## 🌟 Características Principales

1. **Dashboard y CRM de Prospección**:
   - Clasificación por estados: *Por consultar*, *Contactado*, *En prueba 14 días*, *Interesado*, *Cliente Activo*, *Descartado*.
   - Filtros dinámicos por comuna, rubro, estado y buscador en tiempo real.
   - Indicadores KPI (total talleres, contactados, clientes y porcentaje con WhatsApp directo).
   - Acceso inmediato con 1 clic a **WhatsApp** (con mensaje precargado) y **Google Maps** (GPS).

2. **Grabadora de Visitas / Reuniones y Transcripción**:
   - Graba notas de voz o reuniones directamente desde el navegador (en tu laptop o celular).
   - **Transcripción de voz en tiempo real** utilizando el micrófono y la Web Speech API en español.
   - Almacenamiento local de audios en la carpeta `recordings/`.

3. **Generación Automática de Informes de Visita**:
   - Detecta automáticamente los **dolores del tallerista** (ej: pérdida de tiempo en llamadas, presupuestos en el aire, desorden de cuaderno).
   - Identifica **objeciones** (tiempo, resistencia tecnológica, costo).
   - Define el **próximo paso acordado** y calcula la **temperatura comercial** (*Frío*, *Tibio*, *Caliente*).
   - Compatible con **LLMs** (Groq / Anthropic / OpenAI) y con motor heurístico local 100% offline.

4. **Lanzador de Scraping Integrado en la Interfaz**:
   - Lanza nuevos rastreos regionales directamente desde la web sin tocar la consola.
   - Presets para Litoral Central, Gran Valparaíso, Santiago Poniente/Sur, Santiago Centro/Oriente y Rancagua.
   - Terminal en vivo con logs de avance.
   - Sincronización automática de nuevos talleres a la base de datos SQLite (`crm_talleres.db`).

5. **Exportación Ejecutiva**:
   - Descarga en 1 clic la base de datos completa o filtrada en **Excel (`.xlsx`)** con hipervínculos a WhatsApp y en **CSV**.

---

## 🚀 Cómo Iniciar la Interfaz Gráfica

### Opción 1 — Ejecutable compilado (`MazaCRM.exe`):
Doble clic sobre `dist/MazaCRM/MazaCRM.exe`. **No aparece ninguna ventana de consola**: el programa vive como un ícono en la bandeja del sistema (junto al reloj de Windows) mientras el panel se abre solo en tu navegador. Desde ese ícono puedes:
- Clic izquierdo / "Abrir MAZA CRM": reabre el panel si cerraste la pestaña.
- "Salir": cierra el servidor y termina el programa.

Si algo no abre, revisa `maza_crm.log` (se crea junto al `.exe`) — ahí queda todo lo que antes se veía en la consola.

> Todo lo que el CRM guarda (`crm_talleres.db`, `exports/`, `recordings/`, `maza_crm.log`) vive junto al `.exe`, nunca en una carpeta temporal. Puedes copiar toda la carpeta `dist/MazaCRM/` completa a un pendrive u otro equipo y seguirá funcionando con los mismos datos.
>
> ⚠️ El rastreo de talleres (Google Maps) necesita Chromium instalado en el equipo (`playwright install chromium` una sola vez — ver más abajo). El panel y el CRM funcionan igual sin eso; solo la extracción de nuevos talleres lo requiere.

### Opción 2 — Doble clic (modo script, con consola):
```
D:\proyectos stgo\scraper-talleres\iniciar_crm.bat
```

### Opción 3 — Desde tu terminal PowerShell (modo desarrollo):
```powershell
cd "D:\proyectos stgo\scraper-talleres"
python -m pip install -r requirements.txt
python -m playwright install chromium   # solo la primera vez, habilita el scraping
python run_crm.py
```

Luego abre en tu navegador:
👉 **[http://localhost:8000](http://localhost:8000)**

*(También puedes abrirlo desde el navegador de tu celular si ambos dispositivos están conectados a la misma red Wi-Fi o Hotspot, usando la IP local de tu notebook).*

---

## 🛠️ Compilar tu propio `.exe`

```powershell
python -m pip install -r requirements.txt
python -m PyInstaller MazaCRM.spec --noconfirm
```

El resultado queda en `dist/MazaCRM/`. La ventana de consola está desactivada a propósito (`console=False` en `MazaCRM.spec`) — la app se maneja desde el ícono de bandeja (`run_crm.py`).

---

## 📁 Estructura del Proyecto

```
D:\proyectos stgo\scraper-talleres\
├── app.py                  # Servidor FastAPI y API REST
├── db.py                   # Base de datos SQLite (crm_talleres.db)
├── ai_analyzer.py          # Motor de análisis, dolores y resúmenes de visitas
├── scraper.py              # Motor Playwright de extracción en Google Maps
├── config.py               # Presets regionales y configuración de rubros
├── main.py                 # Modo CLI para terminal
├── iniciar_crm.bat         # Acceso directo para iniciar en Windows
├── templates/
│   └── index.html          # Interfaz gráfica moderna (Tailwind + Lucide)
├── recordings/             # Audios grabados de las visitas
└── exports/                # Archivos Excel y CSV exportados
```

---

## 🎯 Flujo de Trabajo Recomendado en la Calle

1. **Antes de salir**: En el panel web, haz clic en **"Nuevo Rastreo"** y selecciona la comuna que vas a recorrer (ej. El Quisco, San Antonio o Maipú).
2. **Durante la ruta**:
   - Abre el panel web en tu notebook.
   - Filtra los talleres *"Por consultar"*.
   - Pulsa el botón **Maps** para ver cómo llegar.
3. **Al terminar la visita**:
   - Abre la ficha del taller y pulsa **"Visita / Grabar"**.
   - Graba un audio de 30 segundos resumiendo lo que habló el dueño (*"Don Juan tiene 2 mecánicos, anota en cuaderno, le gustó la demo de WhatsApp, volver el viernes a cobrar"*).
   - Pulsa **"Guardar Visita"**: el sistema generará automáticamente el informe de dolores, objeciones y próximo paso, y actualizará el estado del prospecto.
4. **Seguimiento**:
   - Usa el botón directo de **WhatsApp** para mandarle el link de la orden demo:  
     `mazataller.com/o/demo?r=auto&n=Taller%20Central`
