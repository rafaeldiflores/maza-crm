import { WaPipe } from '../compartido/wa.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Api, Sesion, mensajeError } from '../core/api';
import { CuentaSalud, NOMBRE_PLAN, Presets, Taller } from '../core/modelos';
import { linkWa, telLink, tieneWa } from '../core/utiles';
import { FichaCuenta } from './ficha-cuenta';
import { FichaTaller } from '../prospectos/ficha-taller';
import { PASOS, SALUD, waCuenta } from './comun';

/** A quién llamar hoy: cuentas con problemas de uso y prospectos atrasados. */
@Component({
  selector: 'app-hoy',
  imports: [FichaCuenta, FichaTaller, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 divide-y divide-borde overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-4 sm:py-3.5">
        <div>
          <p class="titulo-seccion">Hoy</p>
          <h1 class="text-xl font-bold text-slate-900">A quién llamar</h1>
        </div>
        <button class="btn !bg-white !text-slate-700 shadow-2xs" [disabled]="cargando()" (click)="cargar()">
          <span>↻</span> {{ cargando() ? 'Actualizando…' : 'Actualizar cola' }}
        </button>
      </div>

      <div class="flex items-center gap-1.5 overflow-x-auto bg-slate-50/75 px-3 py-2 text-xs font-semibold sm:px-4">
        <button class="rounded-md px-3 py-1.5 transition-colors"
                [class]="filtro() === 'todos' ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'"
                (click)="filtro.set('todos')">
          Todo ({{ accion().length + vencidos().length }})
        </button>
        <button class="rounded-md px-3 py-1.5 transition-colors"
                [class]="filtro() === 'cuentas' ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'"
                (click)="filtro.set('cuentas')">
          ⚠️ Cuentas en riesgo ({{ accion().length }})
        </button>
        <button class="rounded-md px-3 py-1.5 transition-colors"
                [class]="filtro() === 'prospectos' ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'"
                (click)="filtro.set('prospectos')">
          ⏰ Prospectos vencidos ({{ vencidos().length }})
        </button>
      </div>
    </section>

    @if (cargando()) {
      <div class="space-y-3 mb-4">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wider">Revisando salud de cuentas y agenda…</p>
        <div class="space-y-2">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="tarjeta animate-pulse flex items-center justify-between p-3.5">
              <div class="space-y-1.5 flex-1">
                <div class="h-4 w-44 rounded bg-slate-200"></div>
                <div class="h-3 w-64 rounded bg-slate-100"></div>
              </div>
              <div class="h-7 w-24 rounded bg-slate-200"></div>
            </div>
          }
        </div>
      </div>
    } @else {
      @if (filtro() !== 'prospectos') {
        <p class="titulo-seccion mb-2">Cuentas que necesitan un llamado ({{ accion().length }})</p>
        <div class="mb-5 space-y-2">
          @for (c of accion(); track c.uid) {
            <article class="tarjeta flex flex-wrap items-center justify-between gap-3 p-3 transition-shadow hover:shadow-md">
              <button class="min-w-0 text-left flex-1 space-y-1" (click)="abierta.set(c.uid)">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-bold text-slate-900 hover:text-marca-500">{{ c.nombreTaller || c.email }}</span>
                  <span class="insignia" [class]="salud[c.salud][1]">{{ salud[c.salud][0] }}</span>
                  <span class="insignia border-borde bg-fondo text-slate-600">{{ plan[c.modo] }}</span>
                </div>
                <p class="text-xs text-slate-600">{{ c.motivo }}</p>
                <div class="flex flex-wrap gap-1 pt-0.5">
                  @for (p of pasosDe(c); track p.k) {
                    <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                          [class]="p.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'">
                      {{ p.ok ? '✓' : '·' }} {{ p.t }}
                    </span>
                  }
                </div>
              </button>
              <div class="flex items-center gap-1.5 shrink-0">
                @if (telC(c); as telUrl) {
                  <a class="btn !px-2.5 !text-slate-700 hover:!bg-slate-100" [href]="telUrl" title="Llamar directamente">📞</a>
                }
                @if (wa(c); as w) {
                  <a class="btn-wa btn !px-2.5" target="_blank" rel="noopener" [href]="w | wa">WhatsApp</a>
                } @else {
                  <span class="text-xs text-slate-400">sin WhatsApp</span>
                }
                <button class="btn-primario btn !px-2.5" (click)="abierta.set(c.uid)">Cuenta</button>
              </div>
            </article>
          } @empty {
            <p class="tarjeta p-4 text-sm text-slate-500">🎉 Todas las cuentas activas van al día.</p>
          }
        </div>
      }

      @if (filtro() !== 'cuentas') {
        <p class="titulo-seccion mb-2">Prospectos con seguimiento vencido ({{ vencidos().length }})</p>
        <div class="space-y-2">
          @for (t of vencidos(); track t.id) {
            <article class="tarjeta flex flex-wrap items-center justify-between gap-3 p-3 transition-shadow hover:shadow-md">
              <button class="min-w-0 text-left flex-1 space-y-0.5" (click)="tallerAbierto.set(t.id)">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-bold text-slate-900 hover:text-marca-500">{{ t.nombre }}</span>
                  <span class="insignia border-borde bg-fondo text-slate-600">{{ t.comuna }}</span>
                  <span class="insignia border-amber-200 bg-amber-50 text-amber-800">{{ t.estado }}</span>
                </div>
                <p class="text-xs text-slate-500">
                  ⏰ Tocaba el <b>{{ (t.proximo_contacto || '').slice(0, 10) }}</b>
                  @if (t.telefono && t.telefono !== 'No especificado') { · 📞 {{ t.telefono }} }
                </p>
              </button>
              <div class="flex items-center gap-1.5 shrink-0">
                @if (telT(t); as telUrl) {
                  <a class="btn !px-2.5 !text-slate-700 hover:!bg-slate-100" [href]="telUrl" title="Llamar directamente">📞</a>
                }
                @if (conWa(t)) {
                  <a class="btn-wa btn !px-2.5" target="_blank" rel="noopener" [href]="waT(t) | wa">WhatsApp</a>
                }
                <button class="btn-primario btn !px-2.5" (click)="tallerAbierto.set(t.id)">Ficha</button>
              </div>
            </article>
          } @empty {
            <p class="tarjeta p-4 text-sm text-slate-500">🎉 Ningún prospecto tiene seguimiento vencido.</p>
          }
        </div>
      }
    }

    @if (abierta(); as uid) { <app-ficha-cuenta [uid]="uid" (cerrar)="abierta.set(null); cargar()" /> }
    @if (tallerAbierto(); as tid) { <app-ficha-taller [id]="tid" [presets]="presets()" (cerrar)="tallerAbierto.set(null); cargar()" (cambio)="cargar()" /> }
  `,
})
export class Hoy implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  readonly salud = SALUD;
  readonly plan = NOMBRE_PLAN;
  filtro = signal<'todos' | 'cuentas' | 'prospectos'>('todos');
  accion = signal<CuentaSalud[]>([]);
  vencidos = signal<Taller[]>([]);
  cargando = signal(true);
  presets = signal<Presets | null>(null);
  abierta = signal<string | null>(null);
  tallerAbierto = signal<number | null>(null);

  async ngOnInit() {
    this.api.presets().then((p) => this.presets.set(p)).catch(() => {});
    await this.cargar();
  }
  async cargar() {
    this.cargando.set(true);
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
  telC = (c: CuentaSalud) => telLink(c.telefono);
  telT = (t: Taller) => telLink(t.telefono);
}
