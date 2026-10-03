import { Cuenta, CuentaSalud } from '../core/modelos';
import { fecha, linkWa, prefs } from '../core/utiles';

export const SALUD: Record<string, [string, string]> = {
  vencido: ['Prueba vencida', 'border-red-200 bg-red-50 text-red-700'],
  riesgo: ['En riesgo', 'border-red-200 bg-red-50 text-red-700'],
  renovar: ['Renovar', 'border-amber-200 bg-amber-50 text-amber-700'],
  tibio: ['Tibio', 'border-amber-200 bg-amber-50 text-amber-700'],
  sano: ['Sano', 'border-emerald-200 bg-emerald-50 text-emerald-700'],
};

export const COLOR_PLAN: Record<string, string> = {
  trial: 'border-sky-200 bg-sky-50 text-sky-700',
  trial_expirado: 'border-red-200 bg-red-50 text-red-700',
  pro: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ilimitado: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  empresa: 'border-violet-200 bg-violet-50 text-violet-700',
  basico: 'border-slate-200 bg-slate-100 text-slate-600',
};

export const PASOS: Record<string, string> = {
  cuenta_creada: 'Cuenta', primer_vehiculo: '1ª orden', usuarios_invitados: 'Equipo', primer_presupuesto: 'Link aprobado',
};

const saludo = (c: Cuenta) => `Hola${c.nombreTaller ? ' ' + c.nombreTaller : ''}, soy ${prefs.firma}.`;
const MENSAJES: Record<string, (c: Cuenta) => string> = {
  vencido: (c) => `${saludo(c)} Tu prueba terminó: ¿te ayudo a dejar el plan activo para que no pierdas tus órdenes?`,
  riesgo: (c) => `${saludo(c)} Vi que no has entrado estos días, ¿te trabaste en algo? Te ayudo en 5 minutos a dejar tu primera orden lista.`,
  renovar: (c) => `${saludo(c)} Tu plan vence el ${fecha(c.planVigenteHasta)}; te dejo los datos para renovar y seguir sin cortes.`,
  tibio: (c) => `${saludo(c)} ¿Probaste mandar un presupuesto por link? Al cliente le llega por WhatsApp y lo aprueba desde el celular.`,
};

export const waCuenta = (c: CuentaSalud | Cuenta, tipo: string) => linkWa(c.telefono, (MENSAJES[tipo] ?? MENSAJES['tibio'])(c));

export function textoUso(c: Cuenta) {
  if (['pro', 'ilimitado', 'empresa'].includes(c.plan)) {
    if (!c.planVigenteHasta) return 'Sin vencimiento';
    const dias = Math.ceil((new Date(c.planVigenteHasta).getTime() - Date.now()) / 864e5);
    return dias >= 0 ? `${fecha(c.planVigenteHasta)} · ${dias} d` : `Venció ${fecha(c.planVigenteHasta)}`;
  }
  if (c.plan === 'basico') return '—';
  return `${c.trialDiasUsados}/14 días · ${c.trialOrdenes}/30 órdenes`;
}
