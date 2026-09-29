// Formas que devuelve la API de FastAPI (app.py, maza_rutas.py). Si cambia un
// campo allá, cambia acá.

export type Estado =
  | 'Por consultar' | 'Contactado' | 'Interesado' | 'En prueba 14 días' | 'Cliente Activo' | 'Descartado';

export const ETAPAS: Estado[] = ['Por consultar', 'Contactado', 'Interesado', 'En prueba 14 días', 'Cliente Activo'];

export interface Taller {
  id: number;
  nombre: string;
  rubro: string;
  comuna: string;
  direccion: string;
  telefono: string;
  whatsapp_link: string;
  calificacion: string;
  opiniones: string;
  sitio_web: string;
  maps_url: string;
  estado: Estado;
  prioridad: 'Alta' | 'Media' | 'Baja';
  interes: number;
  encargado_nombre: string;
  observaciones: string;
  fecha_creacion: string | null;
  fecha_ultima_visita: string | null;
  proximo_contacto: string | null;
  fecha_inicio_prueba: string;
  maza_uid: string;
  place_id: string;
  puntaje_ia: number | null;
  ia_calza: boolean | null;
  ia_multirubro: boolean | null;
  ia_rubros: string[];
  ia_dolores: string[];
  ia_motivo: string;
  ia_mensaje: string;
}

export interface Reunion {
  id: number;
  taller_id: number;
  fecha: string;
  tipo: string;
  duracion_segundos: number;
  archivo_audio: string;
  transcripcion: string;
  resumen_ia: string;
  notas: string;
  acuerdos: string;
  resultado: string;
}

export interface PasoOnboarding {
  key: string;
  label: string;
  dia_sugerido: number;
  completado: boolean;
  fecha_completado: string;
}

export interface DetalleTaller {
  taller: Taller;
  reuniones: Reunion[];
  onboarding: PasoOnboarding[];
}

export interface Stats {
  total: number;
  por_estado: Record<string, number>;
  con_whatsapp: number;
  total_reuniones: number;
  comunas: string[];
  rubros: string[];
  seguimientos_vencidos: number;
  seguimientos_hoy: number;
}

export interface Presets {
  zonas: Record<string, { nombre: string; comunas: string[] }>;
  rubros: Record<string, { codigo: string; nombre: string; queries: string[] }>;
  whatsapp_templates: Record<string, { titulo: string; mensaje: string }>;
}

export interface Salud {
  ok: boolean;
  error: string | null;
  usuario: string | null;
  admin: boolean;
}

// ─── Cuentas MAZA ─────────────────────────────────────────────────────────────

export type Modo = 'trial' | 'trial_expirado' | 'pro' | 'ilimitado' | 'empresa' | 'basico';

export interface Cuenta {
  uid: string;
  email: string;
  nombreTaller: string;
  tipoTaller: string;
  ciudad: string;
  pais: string;
  telefono: string;
  plan: string;
  modo: Modo;
  planVigenteHasta: string | null;
  asientosContratados: number | null;
  esFundador: boolean;
  numeroFundador: number | null;
  descuentoFundador: number | null;
  mpConnectHabilitado: boolean;
  trialDiasUsados: number;
  trialOrdenes: number;
  creadoEn: string | null;
  crm?: { id: number; nombre: string; comuna: string; estado: string } | null;
}

export interface CuentaSalud extends Cuenta {
  uso: { catalogo: number; clientes: number; equipo: number; aprobaciones: number };
  pasos: Record<string, boolean>;
  ultimoAcceso: string | null;
  diasSinUso: number | null;
  salud: 'vencido' | 'riesgo' | 'renovar' | 'tibio' | 'sano';
  motivo: string;
  referidos: number;
}

export interface DetalleCuenta {
  cuenta: Cuenta;
  ultimoAcceso: string | null;
  resumen: { clientes: number; ordenesTotal: number; ordenesAbiertas: number; inventario: number; ultimasTransacciones: any[] };
  equipo: { uid: string; nombre?: string; email?: string; rol?: string; activo?: boolean }[];
  crm: { id: number; nombre: string; comuna: string; estado: string } | null;
}

export const NOMBRE_PLAN: Record<string, string> = {
  trial: 'Prueba', trial_expirado: 'Prueba vencida', pro: 'Taller Solo', ilimitado: 'Taller Pro',
  empresa: 'Empresa', basico: 'Básico (legado)',
};
