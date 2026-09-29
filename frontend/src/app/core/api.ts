import { HttpClient, HttpInterceptorFn, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, catchError, throwError } from 'rxjs';
import {
  Cuenta, CuentaSalud, DetalleCuenta, DetalleTaller, Presets, Salud, Stats, Taller,
} from './modelos';

/**
 * Toda escritura a /api lleva X-Maza-CRM (ver solo_desde_el_crm en app.py).
 * Si la sesión de IAP venció, la llamada vuelve redirigida al login de Google
 * (el navegador la corta por CORS y llega con status 0): se recarga la página
 * para que IAP pida la cuenta de nuevo.
 */
export const interceptorCrm: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { 'X-Maza-CRM': '1' } })).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 0 || e.status === 401) location.reload();
      return throwError(() => e);
    }),
  );

/** Mensaje legible de un error de la API (FastAPI manda `detail`). */
export function mensajeError(e: unknown): string {
  const err = e as HttpErrorResponse;
  const d = err?.error?.detail;
  return typeof d === 'string' ? d : err?.message || 'Error inesperado';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private get = <T>(url: string, params?: Record<string, string | number | boolean>) =>
    firstValueFrom(this.http.get<T>(url, { params: params ? new HttpParams({ fromObject: params }) : undefined }));
  private post = <T>(url: string, body: unknown = {}) => firstValueFrom(this.http.post<T>(url, body));
  private patch = <T>(url: string, body: unknown) => firstValueFrom(this.http.patch<T>(url, body));
  private delete = <T>(url: string) => firstValueFrom(this.http.delete<T>(url));

  // ─── Prospección ───
  salud = () => this.get<Salud>('/api/salud');
  presets = () => this.get<Presets>('/api/presets');
  stats = () => this.get<Stats>('/api/stats');
  talleres = (filtros: Record<string, string | boolean>) => {
    const p: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(filtros)) if (v !== '' && v !== false && v !== 'Todos') p[k] = v;
    return this.get<Taller[]>('/api/talleres', p);
  };
  taller = (id: number) => this.get<DetalleTaller>(`/api/talleres/${id}`);
  crearTaller = (d: Partial<Taller>) => this.post<{ ok: boolean; taller: Taller }>('/api/talleres', d);
  actualizarTaller = (id: number, d: Partial<Taller>) => this.patch<{ ok: boolean; taller: Taller }>(`/api/talleres/${id}`, d);
  borrarTaller = (id: number) => this.delete(`/api/talleres/${id}`);
  pasoOnboarding = (id: number, key: string, completado: boolean) =>
    this.patch<{ onboarding: DetalleTaller['onboarding'] }>(`/api/talleres/${id}/onboarding/${key}`, { completado });
  evaluarIa = (id: number) => this.post<{ taller: Taller }>(`/api/talleres/${id}/evaluar-ia`);
  guardarReunion = (form: FormData) => firstValueFrom(this.http.post<{ ok: boolean }>('/api/reuniones', form));
  embudo = () => this.get<{ funnel: { estado: string; count: number; pct_total: number; pct_etapa_anterior: number }[]; total: number; descartados_en_algun_punto: number }>('/api/stats/embudo');
  tendencia = (dias = 14) => this.get<{ fecha: string; nuevos: number; visitas: number }[]>('/api/stats/tendencia', { dias });
  optimizarRuta = (lat: number, lng: number, ids: number[], volver: boolean) =>
    this.post<{ ids: number[]; coords: { lat: number; lng: number }[]; km: number; minutos: number }>('/api/ruta/optimizar', { lat, lng, ids, volver });
  visitaRapida = (id: number) => this.post<{ ok: boolean; reunion_id: number }>(`/api/talleres/${id}/visita-rapida`);
  deshacerVisitaRapida = (id: number, reunionId?: number) => this.delete(`/api/talleres/${id}/visita-rapida${reunionId != null ? '/' + reunionId : ''}`);
  duplicados = () => this.get<{ motivo: string; detalle: string; talleres: Pick<Taller, 'id' | 'nombre' | 'comuna' | 'telefono' | 'estado'>[] }[]>('/api/duplicados');
  iniciarRastreo = (d: { comunas: string[]; rubros: string[]; max_per_query: number; evaluar_ia: boolean }) => this.post('/api/scrape/start', d);
  detenerRastreo = () => this.post('/api/scrape/stop');
  estadoRastreo = () => this.get<{ running: boolean; stopping: boolean; logs: string[] }>('/api/scrape/status');

  // ─── Cuentas MAZA (solo admin) ───
  cuentas = () => this.get<{ cuentas: Cuenta[]; metricas: any }>('/api/maza/cuentas');
  cuenta = (uid: string) => this.get<DetalleCuenta>(`/api/maza/cuentas/${encodeURIComponent(uid)}`);
  saludCuentas = () => this.get<CuentaSalud[]>('/api/maza/salud');
  guardarPlan = (uid: string, d: unknown) => this.post<{ cambio: boolean; miembrosEspejados?: number }>(`/api/maza/cuentas/${encodeURIComponent(uid)}/plan`, d);
  registrarPago = (uid: string, d: unknown) => this.post<{ vigenteHasta: string }>(`/api/maza/cuentas/${encodeURIComponent(uid)}/pago`, d);
  cambiarClave = (uid: string, password: string) => this.post(`/api/maza/cuentas/${encodeURIComponent(uid)}/password`, { password });
  eliminarCuenta = (uid: string, confirmacion: string) => this.post<{ tipo: string }>(`/api/maza/cuentas/${encodeURIComponent(uid)}/eliminar`, { confirmacion });
  crearCuenta = (d: unknown) => this.post<{ uid: string }>('/api/maza/cuentas', d);
  vincular = (tallerCrmId: number, uid: string | null) => this.post('/api/maza/vincular', { tallerCrmId, uid });
  sincronizar = () => this.post<{ cambios: number }>('/api/maza/sincronizar');
  pagos = () => this.get<any[]>('/api/maza/pagos');
  metricas = () => this.get<any>('/api/maza/metricas');
  tickets = () => this.get<any[]>('/api/maza/tickets');
  resolverTicket = (id: string, respuesta: string) => this.post(`/api/maza/tickets/${encodeURIComponent(id)}/resolver`, { respuesta });
  errores = () => this.get<any[]>('/api/maza/errores');
  borrarError = (id: string) => this.delete(`/api/maza/errores/${encodeURIComponent(id)}`);
  auditoria = () => this.get<any[]>('/api/maza/auditoria');
}

/** Sesión (quién entró por IAP y si es admin) y avisos flotantes. */
@Injectable({ providedIn: 'root' })
export class Sesion {
  private api = inject(Api);
  readonly salud = signal<Salud | null>(null);
  readonly toast = signal<{ texto: string; ok: boolean } | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  async cargar() {
    try { this.salud.set(await this.api.salud()); } catch { /* el interceptor se encarga */ }
  }

  avisar(texto: string, ok = true) {
    this.toast.set({ texto, ok });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.toast.set(null), ok ? 2500 : 6000);
  }
}
