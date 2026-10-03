import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { prefs } from './utiles';

export interface ConfigGeneral {
  firma: string;
  plantillas: Record<string, { titulo: string; mensaje: string }>;
  rastreo: { zona: string; maximo: number; evaluarIa: boolean };
  salud: { diasSinUsoPrueba: number; diasSinUsoPago: number; diasAvisoRenovar: number; diasPruebaPorVencer: number };
}

interface Dispositivo {
  waBusiness: boolean;
  pinHash: string | null;
  pinSal: string | null;
  bloqueoMin: number;
}

const CLAVE = 'maza_crm_dispositivo';
const POR_DEFECTO: Dispositivo = { waBusiness: false, pinHash: null, pinSal: null, bloqueoMin: 5 };

async function hash(pin: string, sal: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sal}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ajustes de dos niveles:
 *  - de este dispositivo (PIN, WhatsApp normal o Business): en localStorage,
 *    porque son del teléfono o PC, no de la cuenta;
 *  - generales (firma, plantillas, rastreo, umbrales): en el servidor
 *    (/api/config), los edita un admin y valen para todos.
 * El PIN se guarda como hash con sal; es un candado local sobre la sesión de
 * Google (IAP), no reemplaza el login.
 */
@Injectable({ providedIn: 'root' })
export class Ajustes {
  private http = inject(HttpClient);
  readonly dispositivo = signal<Dispositivo>(this.leerLocal());
  readonly general = signal<ConfigGeneral | null>(null);
  readonly bloqueada = signal(!!this.dispositivo().pinHash);
  private ocultaDesde = 0;

  constructor() {
    this.aplicar();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ocultaDesde = Date.now();
      else if (this.dispositivo().pinHash && this.ocultaDesde &&
        Date.now() - this.ocultaDesde > this.dispositivo().bloqueoMin * 60_000) this.bloqueada.set(true);
    });
  }

  private leerLocal(): Dispositivo {
    try { return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch { return { ...POR_DEFECTO }; }
  }

  private guardarLocal(cambios: Partial<Dispositivo>) {
    this.dispositivo.update((d) => ({ ...d, ...cambios }));
    try { localStorage.setItem(CLAVE, JSON.stringify(this.dispositivo())); } catch { /* sin storage */ }
    this.aplicar();
  }

  private aplicar() {
    prefs.waBusiness = this.dispositivo().waBusiness;
    if (this.general()) prefs.firma = this.general()!.firma;
  }

  setWaBusiness(on: boolean) { this.guardarLocal({ waBusiness: on }); }
  setBloqueoMin(min: number) { this.guardarLocal({ bloqueoMin: Math.max(1, Math.min(120, min)) }); }

  async fijarPin(pin: string) {
    const sal = crypto.getRandomValues(new Uint32Array(2)).join('-');
    this.guardarLocal({ pinSal: sal, pinHash: await hash(pin, sal) });
  }

  quitarPin() { this.guardarLocal({ pinHash: null, pinSal: null }); this.bloqueada.set(false); }

  async desbloquear(pin: string) {
    const d = this.dispositivo();
    const ok = !!d.pinHash && (await hash(pin, d.pinSal || '')) === d.pinHash;
    if (ok) this.bloqueada.set(false);
    return ok;
  }

  async cargarGeneral() {
    try {
      this.general.set(await firstValueFrom(this.http.get<ConfigGeneral>('/api/config')));
      this.aplicar();
    } catch { /* sin config: se usan los valores por defecto del servidor */ }
  }

  async guardarGeneral(c: ConfigGeneral) {
    this.general.set(await firstValueFrom(this.http.put<ConfigGeneral>('/api/config', c)));
    this.aplicar();
  }
}
