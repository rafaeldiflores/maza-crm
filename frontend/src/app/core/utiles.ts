import { Presets, Taller } from './modelos';

export const fecha = (iso?: string | null) =>
  iso ? new Date(iso.replace(' ', 'T')).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fechaHora = (iso?: string | null) =>
  iso ? new Date(iso.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const plata = (n?: number | null) => '$' + Number(n || 0).toLocaleString('es-CL');

export function generarClave() {
  const a = crypto.getRandomValues(new Uint8Array(9));
  return 'Maza-' + btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '').slice(0, 10);
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

export const digitosWa = (link?: string | null) => (link || '').match(/wa\.me\/(\d+)/)?.[1] ?? null;

/** Preferencias de este dispositivo que afectan a los links (las fija el
 * servicio Ajustes). */
export const prefs = { waBusiness: false, firma: 'Rafa de MAZA' };

/**
 * Link de WhatsApp. Con «WhatsApp Business» activado, en Android se usa un
 * intent al paquete com.whatsapp.w4b (si no está instalado, cae al link
 * normal). En PC y iPhone no se puede elegir: se abre el WhatsApp instalado.
 */
export function linkWa(telefonoOLink: string | null | undefined, texto = ''): string | null {
  const d = digitosWa(telefonoOLink) ?? (String(telefonoOLink || '').replace(/\D/g, '') || null);
  if (!d) return null;
  const web = `https://wa.me/${d}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
  if (prefs.waBusiness && /Android/i.test(navigator.userAgent)) {
    const q = `phone=${d}${texto ? '&text=' + encodeURIComponent(texto) : ''}`;
    return `intent://send/?${q}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(web)};end`;
  }
  return web;
}

export function linkPlantilla(t: Pick<Taller, 'whatsapp_link' | 'nombre'>, presets: Presets | null, clave: string) {
  const tpl = presets?.whatsapp_templates?.[clave];
  return linkWa(t.whatsapp_link, tpl ? tpl.mensaje.replace(/\{nombre\}/g, t.nombre || '') : '');
}

/** La plantilla que corresponde a la etapa: el botón principal ya sale con el
 * mensaje correcto (llegada en frío, seguimiento de prueba, recontacto). */
export function waPorDefecto(t: Taller, presets: Presets | null) {
  const clave = t.estado === 'Por consultar' ? 'frio' : t.estado === 'En prueba 14 días' ? 'seguimiento_prueba' : t.estado === 'Descartado' ? 'recontacto' : null;
  return (clave && linkPlantilla(t, presets, clave)) || linkWa(t.whatsapp_link);
}

export const tieneWa = (t: Pick<Taller, 'whatsapp_link'>) => !!digitosWa(t.whatsapp_link);

// ─── Prueba de 14 días y seguimientos ────────────────────────────────────────

export function infoPrueba(inicio?: string | null) {
  if (!inicio) return null;
  const d = new Date(inicio.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  const dias = Math.floor((Date.now() - d.getTime()) / 864e5);
  const restante = Math.max(14 - dias - 1, 0);
  const vencida = dias >= 14;
  const color = vencida || restante <= 2 ? 'bg-red-50 text-red-700 border-red-200'
    : restante <= 5 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return { dia: Math.min(dias + 1, 14), restante, vencida, color };
}

export function seguimiento(t: Pick<Taller, 'proximo_contacto'>) {
  if (!t.proximo_contacto) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const f = new Date(String(t.proximo_contacto).slice(0, 10) + 'T00:00:00');
  if (isNaN(f.getTime())) return null;
  const dif = Math.round((f.getTime() - hoy.getTime()) / 864e5);
  if (dif < 0) return { texto: `⏰ Atrasado (${f.toLocaleDateString('es-CL')})`, color: 'bg-red-50 text-red-700 border-red-200' };
  if (dif === 0) return { texto: '📅 Contactar hoy', color: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { texto: `📅 ${f.toLocaleDateString('es-CL')}`, color: 'bg-slate-50 text-slate-500 border-slate-200' };
}

export const COLOR_ESTADO: Record<string, string> = {
  'Por consultar': 'bg-blue-50 text-blue-700 border-blue-200',
  'Contactado': 'bg-amber-50 text-amber-800 border-amber-200',
  'Interesado': 'bg-teal-50 text-teal-700 border-teal-200',
  'En prueba 14 días': 'bg-purple-50 text-purple-700 border-purple-200',
  'Cliente Activo': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Descartado': 'bg-slate-100 text-slate-500 border-slate-200',
};

export const direccionValida = (t: Pick<Taller, 'direccion'>) =>
  !!(t.direccion && t.direccion.trim() && t.direccion !== 'No especificada');

/** Google Maps arma rutas multi-parada encadenando direcciones en la URL. */
export function urlRuta(talleres: Pick<Taller, 'direccion' | 'comuna'>[]) {
  const puntos = talleres.filter(direccionValida).map((t) => encodeURIComponent(`${t.direccion}, ${t.comuna}, Chile`));
  return puntos.length ? `https://www.google.com/maps/dir/${puntos.join('/')}` : null;
}

/** Enlace directo para llamada telefónica con un clic */
export function telLink(tel?: string | null): string | null {
  if (!tel || tel === 'No especificado') return null;
  const limpio = tel.replace(/[^\d+]/g, '');
  return limpio.length >= 7 ? `tel:${limpio}` : null;
}
