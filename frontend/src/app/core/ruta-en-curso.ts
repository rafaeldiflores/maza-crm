import { Injectable, computed, inject, signal } from '@angular/core';
import { Api, Sesion, mensajeError } from './api';

export interface Parada {
  id: number;
  nombre: string;
  direccion: string;
  comuna: string;
  lat: number | null;
  lng: number | null;
  estado: 'pendiente' | 'visitado' | 'saltado';
}

interface Ruta { paradas: Parada[]; volver: boolean; km: number; minutos: number }

const CLAVE = 'maza_crm_ruta';
const RADIO_M = 120;

function distancia(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const direccion = (p: Parada) => encodeURIComponent(`${p.direccion}, ${p.comuna}, Chile`);

/**
 * Ruta del día en curso: el orden óptimo como checklist. Se guarda en el
 * dispositivo (sobrevive a cerrar la app). Con la app abierta sigue el GPS y
 * avisa al llegar a menos de RADIO_M de una parada pendiente; el navegador no
 * permite seguirlo en segundo plano.
 */
@Injectable({ providedIn: 'root' })
export class RutaEnCurso {
  private api = inject(Api);
  private sesion = inject(Sesion);
  readonly ruta = signal<Ruta | null>(this.leer());
  readonly abierta = signal(false);
  readonly cerca = signal<Parada | null>(null);
  private vigia: number | null = null;
  private ignoradas = new Set<number>();

  readonly pendientes = computed(() => this.ruta()?.paradas.filter((p) => p.estado === 'pendiente') ?? []);
  readonly hechas = computed(() => (this.ruta()?.paradas.length ?? 0) - this.pendientes().length);

  constructor() { if (this.ruta()) this.vigilar(); }

  private leer(): Ruta | null { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch { return null; } }
  private guardar(r: Ruta | null) {
    this.ruta.set(r);
    try { r ? localStorage.setItem(CLAVE, JSON.stringify(r)) : localStorage.removeItem(CLAVE); } catch { /* sin storage */ }
  }

  iniciar(paradas: Omit<Parada, 'estado'>[], volver: boolean, km: number, minutos: number) {
    this.guardar({ paradas: paradas.map((p) => ({ ...p, estado: 'pendiente' as const })), volver, km, minutos });
    this.ignoradas.clear();
    this.abierta.set(true);
    this.vigilar();
  }

  /** Link de Maps con las paradas pendientes en orden, desde la posición dada. */
  urlMaps(desde?: { lat: number; lng: number }, soloHasta?: Parada) {
    const r = this.ruta();
    if (!r) return null;
    const lista = soloHasta ? [soloHasta] : this.pendientes();
    const inicio = desde ? `${desde.lat},${desde.lng}` : '';
    const vuelta = !soloHasta && r.volver && desde ? '/' + inicio : '';
    return `https://www.google.com/maps/dir/${inicio}/${lista.map(direccion).join('/')}${vuelta}`;
  }

  async marcar(p: Parada, estado: 'visitado' | 'saltado') {
    if (estado === 'visitado') {
      try { await this.api.visitaRapida(p.id); } catch (e) { this.sesion.avisar(mensajeError(e), false); return; }
    }
    const r = this.ruta()!;
    this.guardar({ ...r, paradas: r.paradas.map((x) => (x.id === p.id ? { ...x, estado } : x)) });
    if (this.cerca()?.id === p.id) this.cerca.set(null);
    this.sesion.avisar(estado === 'visitado' ? `${p.nombre}: visitado` : `${p.nombre}: saltado`);
    if (!this.pendientes().length) this.sesion.avisar('¡Ruta completada!');
  }

  ignorarCerca() { const c = this.cerca(); if (c) this.ignoradas.add(c.id); this.cerca.set(null); }

  terminar() { this.detenerVigia(); this.cerca.set(null); this.abierta.set(false); this.guardar(null); }

  /** Vuelve a ordenar lo que falta desde donde estás ahora. */
  reoptimizar(): Promise<void> {
    const r = this.ruta();
    const pend = this.pendientes();
    if (!r || pend.length < 2) { if (r && pend.length === 1) this.abrirMaps(); return Promise.resolve(); }
    return new Promise((ok) => navigator.geolocation.getCurrentPosition(async (pos) => {
      const desde = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try {
        const o = await this.api.optimizarRuta(desde.lat, desde.lng, pend.map((p) => p.id), r.volver);
        const porId = new Map(pend.map((p) => [p.id, p]));
        const nuevas = o.ids.map((id, i) => ({ ...porId.get(id)!, lat: o.coords[i]?.lat ?? porId.get(id)!.lat, lng: o.coords[i]?.lng ?? porId.get(id)!.lng }));
        this.guardar({ ...r, km: o.km, minutos: o.minutos, paradas: [...r.paradas.filter((p) => p.estado !== 'pendiente'), ...nuevas] });
        window.open(this.urlMaps(desde)!, '_blank', 'noopener');
      } catch (e) { this.sesion.avisar(mensajeError(e), false); }
      ok();
    }, () => { this.sesion.avisar('Permite el acceso a tu ubicación', false); ok(); }, { enableHighAccuracy: true, timeout: 15000 }));
  }

  abrirMaps(hasta?: Parada) {
    navigator.geolocation.getCurrentPosition(
      (pos) => window.open(this.urlMaps({ lat: pos.coords.latitude, lng: pos.coords.longitude }, hasta)!, '_blank', 'noopener'),
      () => window.open(this.urlMaps(undefined, hasta)!, '_blank', 'noopener'),
      { timeout: 8000 });
  }

  private vigilar() {
    if (this.vigia !== null || !navigator.geolocation) return;
    this.vigia = navigator.geolocation.watchPosition((pos) => {
      const aqui = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const p = this.pendientes().find((x) => x.lat != null && x.lng != null && !this.ignoradas.has(x.id) &&
        distancia(aqui, { lat: x.lat!, lng: x.lng! }) <= RADIO_M);
      if (p && this.cerca()?.id !== p.id) this.cerca.set(p);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 30000 });
  }

  private detenerVigia() { if (this.vigia !== null) navigator.geolocation.clearWatch(this.vigia); this.vigia = null; }
}
