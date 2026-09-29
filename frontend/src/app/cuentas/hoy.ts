import { WaPipe } from '../compartido/wa.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Api, Sesion, mensajeError } from '../core/api';
import { CuentaSalud, NOMBRE_PLAN, Taller } from '../core/modelos';
import { linkWa, tieneWa } from '../core/utiles';
import { FichaCuenta } from './ficha-cuenta';
import { PASOS, SALUD, waCuenta } from './comun';

/** A quién llamar hoy: cuentas con problemas de uso y prospectos atrasados. */
@Component({
  selector: 'app-hoy',
  imports: [FichaCuenta, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Hoy</p><h1 class="text-xl font-bold">A quién llamar</h1></section>
    @if (cargando()) { <p class="py-10 text-center text-sm text-slate-500">Revisando el uso de cada cuenta…</p> }
    @else {
      <p class="titulo-seccion mb-2">Cuentas que necesitan un llamado ({{ accion().length }})</p>
      <div class="mb-5 space-y-2">
        @for (c of accion(); track c.uid) {
          <article class="tarjeta flex flex-wrap items-center justify-between gap-2 p-3">
            <button class="min-w-0 text-left" (click)="abierta.set(c.uid)">
              <p class="font-bold">{{ c.nombreTaller || c.email }} <span class="insignia" [class]="salud[c.salud][1]">{{ salud[c.salud][0] }}</span></p>
              <p class="text-xs text-slate-500">{{ c.motivo }} · {{ plan[c.modo] }} ·
                @for (p of pasosDe(c); track p.k) { <span class="mr-1.5">{{ p.ok ? '✓' : '·' }} {{ p.t }}</span> }</p>
            </button>
            @if (wa(c); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">WhatsApp</a> } @else { <span class="text-xs text-slate-400">sin teléfono</span> }
          </article>
        } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Todas las cuentas van bien.</p> }
      </div>
      <p class="titulo-seccion mb-2">Prospectos con seguimiento vencido ({{ vencidos().length }})</p>
      <div class="space-y-2">
        @for (t of vencidos(); track t.id) {
          <article class="tarjeta flex items-center justify-between gap-2 p-3">
            <div><p class="font-bold">{{ t.nombre }} <span class="text-xs font-normal text-slate-500">{{ t.comuna }} · {{ t.estado }}</span></p>
              <p class="text-xs text-slate-500">Tocaba el {{ (t.proximo_contacto || '').slice(0, 10) }}</p></div>
            @if (conWa(t)) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="waT(t) | wa">WhatsApp</a> }
          </article>
        } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Nada vencido.</p> }
      </div>
    }
    @if (abierta(); as uid) { <app-ficha-cuenta [uid]="uid" (cerrar)="abierta.set(null); cargar()" /> }
  `,
})
export class Hoy implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  readonly salud = SALUD;
  readonly plan = NOMBRE_PLAN;
  accion = signal<CuentaSalud[]>([]);
  vencidos = signal<Taller[]>([]);
  cargando = signal(true);
  abierta = signal<string | null>(null);

  async ngOnInit() { await this.cargar(); }
  async cargar() {
    try {
      const [s, v] = await Promise.all([this.api.saludCuentas(), this.api.talleres({ vencidos: true })]);
      this.accion.set(s.filter((c) => c.salud !== 'sano'));
      this.vencidos.set(v.slice(0, 30));
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.cargando.set(false); }
  }
  pasosDe = (c: CuentaSalud) => Object.entries(c.pasos).map(([k, ok]) => ({ k, ok, t: PASOS[k] ?? k }));
  wa = (c: CuentaSalud) => waCuenta(c, c.salud);
  conWa = (t: Taller) => tieneWa(t);
  waT = (t: Taller) => linkWa(t.whatsapp_link);
}
