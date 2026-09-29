"""
Configuración para el Scraper Regional de Talleres Multirubro (MAZA).
Define presets regionales completos para Santiago y regiones, rubros y parámetros de extracción.
"""

PRESETS_ZONAS = {
    # SANTIAGO / REGIÓN METROPOLITANA
    "stgo_todos": {
        "nombre": "🏙️ RM — Todo el Gran Santiago (34 comunas urbanas)",
        "comunas": [
            "Santiago", "Providencia", "Las Condes", "Ñuñoa", "Vitacura", "La Reina", "Lo Barnechea",
            "Maipú", "Pudahuel", "Cerrillos", "Estación Central", "Quinta Normal", "Lo Prado", "Cerro Navia",
            "La Florida", "Puente Alto", "Peñalolén", "Macul", "San Joaquín", "San Miguel", "La Cisterna",
            "La Granja", "San Ramón", "La Pintana", "El Bosque", "Pedro Aguirre Cerda", "Lo Espejo",
            "Recoleta", "Independencia", "Conchalí", "Huechuraba", "Quilicura", "Renca", "San Bernardo"
        ]
    },
    "stgo_centro": {
        "nombre": "🏢 RM — Santiago Centro y Pericentro (Santiago, Est. Central, Quinta Normal)",
        "comunas": ["Santiago", "Estación Central", "Quinta Normal", "Recoleta", "Independencia"]
    },
    "stgo_oriente": {
        "nombre": "🌟 RM — Santiago Oriente (Providencia, Las Condes, Ñuñoa, Vitacura, La Reina, Lo Barnechea)",
        "comunas": ["Providencia", "Las Condes", "Ñuñoa", "Vitacura", "La Reina", "Lo Barnechea"]
    },
    "stgo_poniente": {
        "nombre": "🏭 RM — Santiago Poniente (Maipú, Pudahuel, Cerrillos, Lo Prado, Cerro Navia, Padre Hurtado)",
        "comunas": ["Maipú", "Pudahuel", "Cerrillos", "Lo Prado", "Cerro Navia", "Padre Hurtado"]
    },
    "stgo_norte": {
        "nombre": "🚛 RM — Santiago Norte (Quilicura, Conchalí, Huechuraba, Renca, Colina, Lampa)",
        "comunas": ["Quilicura", "Conchalí", "Huechuraba", "Renca", "Colina", "Lampa"]
    },
    "stgo_sur": {
        "nombre": "🔩 RM — Santiago Sur (San Miguel, San Joaquín, La Cisterna, PAC, El Bosque, San Bernardo)",
        "comunas": ["San Miguel", "San Joaquín", "La Cisterna", "Pedro Aguirre Cerda", "Lo Espejo", "El Bosque", "San Bernardo", "La Granja", "San Ramón", "La Pintana"]
    },
    "stgo_sur_oriente": {
        "nombre": "🏔️ RM — Santiago Sur-Oriente (La Florida, Puente Alto, Peñalolén, Macul, Pirque)",
        "comunas": ["La Florida", "Puente Alto", "Peñalolén", "Macul", "Pirque", "San José de Maipo"]
    },
    "stgo_periferia": {
        "nombre": "🌾 RM — Provincia Maipo, Talagante y Melipilla (Buin, Paine, Talagante, Peñaflor, Melipilla)",
        "comunas": ["Buin", "Paine", "Calera de Tango", "Talagante", "Peñaflor", "El Monte", "Isla de Maipo", "Melipilla", "Curacaví"]
    },

    # VALPARAÍSO & O'HIGGINS
    "valpo_litoral": {
        "nombre": "🏖️ V Región — Litoral Central (El Quisco, Algarrobo, El Tabo, San Antonio)",
        "comunas": ["El Quisco", "Algarrobo", "El Tabo", "Cartagena", "San Antonio", "Santo Domingo"]
    },
    "valpo_gran": {
        "nombre": "⚓ V Región — Gran Valparaíso (Viña del Mar, Valparaíso, Quilpué, Villa Alemana, Concón)",
        "comunas": ["Viña del Mar", "Valparaíso", "Quilpué", "Villa Alemana", "Concón"]
    },
    "valpo_interior": {
        "nombre": "🌄 V Región — Interior (Quillota, Limache, La Calera, San Felipe, Los Andes)",
        "comunas": ["Quillota", "La Calera", "Limache", "San Felipe", "Los Andes"]
    },
    "ohiggins_rancagua": {
        "nombre": "🚜 VI Región — Rancagua y alrededores (Rancagua, Machalí, Graneros, Rengo, San Fernando)",
        "comunas": ["Rancagua", "Machalí", "Graneros", "Rengo", "San Fernando"]
    }
}

RUBROS_MAP = {
    "1": {
        "codigo": "mecanica",
        "nombre": "Mecánica Automotriz",
        "queries": ["taller mecanico", "mecanica automotriz"]
    },
    "2": {
        "codigo": "motos",
        "nombre": "Motos",
        "queries": ["taller de motos", "mecanica de motos"]
    },
    "3": {
        "codigo": "bicicletas",
        "nombre": "Bicicletas",
        "queries": ["taller de bicicletas", "taller de bicis"]
    },
    "4": {
        "codigo": "detailing",
        "nombre": "Detailing y Lavado",
        "queries": ["detailing automotriz", "lavado de autos"]
    },
    "5": {
        "codigo": "desabolladura",
        "nombre": "Desabolladura y Pintura",
        "queries": ["desabolladura y pintura"]
    },
    "6": {
        "codigo": "lubricentro",
        "nombre": "Lubricentro",
        "queries": ["lubricentro"]
    }
}

BROWSER_CONFIG = {
    "viewport": {"width": 1280, "height": 900},
    "locale": "es-CL",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

# Plantillas de acercamiento por WhatsApp. Sistematizan la llegada en frío y el
# seguimiento comercial para que no dependa de la memoria/estilo de cada vendedor.
# {nombre} se reemplaza por el nombre del taller.
WHATSAPP_TEMPLATES = {
    "frio": {
        "titulo": "🧊 Primer contacto (frío)",
        "mensaje": "Hola! 👋 Pasé por el taller {nombre}. Soy de *MAZA*, una app chilena para talleres mecánicos que ordena recepciones, presupuestos y cobros por WhatsApp. ¿Tienes 2 minutos para mostrarte cómo funciona? Es gratis probarla 14 días, sin tarjeta."
    },
    "sin_contacto_directo": {
        "titulo": "📋 Encontrado en Google Maps",
        "mensaje": "Hola! Los encontré como {nombre} en Google Maps. Soy de *MAZA*, una app para ordenar el taller (recepciones, presupuestos por WhatsApp y control de mecánicos). ¿Con quién podría hablar 2 minutos sobre esto?"
    },
    "seguimiento_prueba": {
        "titulo": "🚀 Seguimiento de prueba",
        "mensaje": "Hola! ¿Cómo te ha ido con MAZA en {nombre} estos días de prueba? Cualquier duda me escribes, quiero ayudarte a sacarle el jugo antes de que termine tu prueba de 14 días."
    },
    "cierre_prueba": {
        "titulo": "⏰ Cierre de prueba (últimos días)",
        "mensaje": "Hola! Ya se te está por terminar la prueba de 14 días de MAZA en {nombre} 🙌 ¿Conversamos hoy o mañana para ver cómo te fue y dejar tu cuenta activada?"
    },
    "recontacto": {
        "titulo": "🔄 Reconectar (taller frío hace tiempo)",
        "mensaje": "Hola! Pasé hace un tiempo por {nombre} a conversar sobre MAZA. ¿Cómo va todo? Me encantaría retomar la conversación si te interesa ordenar mejor las recepciones y cobros del taller."
    },
}

# Checklist de activación post-venta. Se instancia automáticamente cuando un
# taller entra a "En prueba 14 días", para que el seguimiento de los primeros
# días no dependa de que el vendedor se acuerde de cada paso.
ONBOARDING_STEPS = [
    {"key": "cuenta_creada", "label": "Cuenta MAZA creada y enviada por WhatsApp", "dia_sugerido": 0},
    {"key": "primer_vehiculo", "label": "Primer vehículo/orden cargada en el sistema", "dia_sugerido": 1},
    {"key": "usuarios_invitados", "label": "Mecánicos / usuarios del taller invitados", "dia_sugerido": 2},
    {"key": "primer_presupuesto", "label": "Primer presupuesto enviado por WhatsApp desde la app", "dia_sugerido": 3},
    {"key": "seguimiento_dia7", "label": "Llamada/visita de seguimiento (día 7)", "dia_sugerido": 7},
    {"key": "cierre_prueba", "label": "Conversación de cierre y decisión (día 13-14)", "dia_sugerido": 13},
]
