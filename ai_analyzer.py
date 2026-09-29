"""
Módulo de Inteligencia y Análisis de Reuniones para MAZA CRM.
Procesa transcripciones de visitas, notas y audios para generar resúmenes ejecutivos,
dolores detectados, objeciones y próximos pasos.
"""

import os
import re
from typing import Dict, Any, Optional

def analyze_meeting(taller_nombre: str, rubro: str, text: str) -> Dict[str, Any]:
    """
    Analiza las notas o transcripción de una visita al taller.
    Utiliza LLM si hay API Key disponible (Groq, Anthropic, OpenAI) o motor heurístico local.
    """
    if not text or len(text.strip()) < 5:
        return {
            "resumen": "No se proporcionaron notas o transcripción suficientes.",
            "dolores": [],
            "objeciones": [],
            "proximo_paso": "Contactar para primera llamada o visita.",
            "temperatura": "Indeterminada"
        }

    # 0. Gemini en Vertex AI (credenciales de Google, sin API key).
    if not os.environ.get("CRM_SIN_VERTEX"):
        try:
            import ia_prospectos
            r = ia_prospectos._cliente().models.generate_content(
                model=ia_prospectos.MODELO,
                contents=f"""Eres el asesor comercial de MAZA (app de gestión para talleres multirubro en Chile).
Analiza la visita al taller '{taller_nombre}' (rubro: {rubro}):

\"\"\"{text}\"\"\"

Responde en español neutro, breve, con exactamente este formato:
- PERFIL: (1 línea sobre cómo opera)
- DOLORES: (dolores reales del taller)
- OBJECIONES: (dudas u objeciones del dueño)
- ACUERDOS Y PRÓXIMO PASO: (qué se acordó y cuándo volver a contactar)
- TEMPERATURA: (Frío / Tibio / Caliente)""",
                config={"temperature": 0.3},
            )
            if r.text:
                return parse_structured_report(r.text)
        except Exception as e:
            print(f"[AI] Error llamando a Vertex AI: {e}")

    # 1. Intentar con Groq si está disponible (rápido y gratuito)
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)
            prompt = f"""Eres el asesor comercial de MAZA (SaaS para talleres mecánicos en Chile).
Analiza las siguientes notas/transcripción de una visita al taller '{taller_nombre}' (Rubro: {rubro}):

TEXTO DE LA VISITA:
\"\"\"{text}\"\"\"

Genera un informe breve y estructurado con exactamente este formato:
- PERFIL: (1 línea sobre cómo opera)
- DOLORES: (Lista de dolores reales que tiene el taller, ej: desorden de cuaderno, llamadas constantes)
- OBJECIONES: (Objeciones o dudas que puso el dueño)
- ACUERDOS Y PRÓXIMO PASO: (Qué se acordó y cuándo volver a contactar)
- TEMPERATURA: (Frío / Tibio / Caliente)
"""
            chat = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.3-70b-versatile",
                temperature=0.3
            )
            report = chat.choices[0].message.content
            return parse_structured_report(report)
        except Exception as e:
            print(f"[AI] Error llamando a Groq: {e}")

    # 2. Intentar con Anthropic Claude si está disponible
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            msg = client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=600,
                temperature=0.3,
                messages=[{
                    "role": "user",
                    "content": f"Eres asesor comercial de MAZA (app para talleres en Chile). Analiza esta visita a '{taller_nombre}' ({rubro}):\n\n{text}\n\nEntrega: Perfil, Dolores, Objeciones, Próximos pasos y Temperatura (Frío/Tibio/Caliente)."
                }]
            )
            report = msg.content[0].text
            return parse_structured_report(report)
        except Exception as e:
            print(f"[AI] Error llamando a Anthropic: {e}")

    # 3. Motor heurístico local (100% offline, sin dependencias externas)
    return heuristic_analysis(taller_nombre, rubro, text)

def heuristic_analysis(taller_nombre: str, rubro: str, text: str) -> Dict[str, Any]:
    """Genera un análisis estructurado local basado en patrones y palabras clave."""
    lower = text.lower()
    
    dolores = []
    if any(w in lower for w in ["cuaderno", "papel", "anotaba", "anotar", "libreta"]):
        dolores.append("Uso de cuaderno físico propenso a desorden y extravío de registros.")
    if any(w in lower for w in ["llamada", "llaman", "preguntan", "cuándo está", "cuando esta", "interrump"]):
        dolores.append("Interrupciones frecuentes de clientes preguntando por el estado del vehículo.")
    if any(w in lower for w in ["presupuesto", "precio", "aprueba", "autoriza", "repuesto"]):
        dolores.append("Demora o fricción en la aprobación de presupuestos y repuestos adicionales.")
    if any(w in lower for w in ["caja", "cobro", "plata", "pago", "cuadrar", "deuda"]):
        dolores.append("Dificultad para llevar el control diario de caja y cobros pendientes.")
    if not dolores:
        dolores.append("Optimización general del tiempo en mesón y orden en piso.")

    objeciones = []
    if any(w in lower for w in ["tiempo", "ocupado", "lleno", "apurado"]):
        objeciones.append("Falta de tiempo para configurar o aprender un sistema nuevo.")
    if any(w in lower for w in ["tecnolog", "computador", "celular", "viejo", "edad", "mano"]):
        objeciones.append("Resistencia tecnológica o temor a la complejidad digital.")
    if any(w in lower for w in ["caro", "costo", "precio", "pagar", "mensual"]):
        objeciones.append("Sensibilidad al costo mensual o suscripción.")
    if any(w in lower for w in ["socio", "esposa", "jefe", "preguntar", "consultar"]):
        objeciones.append("Requiere consultar la decisión con socio o encargado.")
    if not objeciones:
        objeciones.append("Evaluando si se adapta a su flujo diario de trabajo.")

    # Temperatura
    caliente_score = sum(1 for w in ["gustó", "gusto", "bueno", "excelente", "probar", "interesa", "cuenta", "demo", "qr"] if w in lower)
    frio_score = sum(1 for w in ["no", "después", "despues", "nada", "caro", "folleto", "tarjeta", "ocupado"] if w in lower)
    
    if caliente_score > frio_score:
        temperatura = "Caliente (Alta probabilidad de prueba)"
    elif caliente_score == frio_score:
        temperatura = "Tibio (Requiere seguimiento en 48h)"
    else:
        temperatura = "Frío (Poca receptividad inicial)"

    # Próximo paso sugerido
    if "caliente" in temperatura.lower():
        proximo_paso = "Enviar enlace de demo por WhatsApp y coordinar carga del primer vehículo real."
    elif "tibio" in temperatura.lower():
        proximo_paso = "Reenviar WhatsApp con caso de éxito similar y consultar el jueves/viernes."
    else:
        proximo_paso = "Dejar en lista de espera y recontactar en el próximo ciclo regional."

    resumen = (
        f"**Informe de Visita - {taller_nombre} ({rubro})**\n\n"
        f"**Diagnóstico**: El taller presenta interés en optimizar su operación. "
        f"Se le presentó la propuesta de valor centrada en seguimiento en vivo y mesón conectado.\n\n"
        f"**Dolores Detectados**:\n" + "\n".join(f"• {d}" for d in dolores) + "\n\n"
        f"**Objeciones**:\n" + "\n".join(f"• {o}" for o in objeciones) + "\n\n"
        f"**Próximo Paso Acordado**: {proximo_paso}\n\n"
        f"**Temperatura Comercial**: {temperatura}"
    )

    return {
        "resumen": resumen,
        "dolores": dolores,
        "objeciones": objeciones,
        "proximo_paso": proximo_paso,
        "temperatura": temperatura
    }

def parse_structured_report(report_text: str) -> Dict[str, Any]:
    """Parsea el texto retornado por el LLM en una estructura limpia."""
    return {
        "resumen": report_text,
        "dolores": ["Detectados en informe IA"],
        "objeciones": ["Ver detalles en resumen"],
        "proximo_paso": "Seguimiento según informe",
        "temperatura": "Extraída por IA"
    }
