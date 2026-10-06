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
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Hoy</p><h1 class="text-xl font-bold">A quién llamar</h1></section>
    @if (cargando()) {
      <div class="space-y-3 mb-4">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wider">Revisando salud de cuentas…</p>
        <div class="space-y-2">
          @for (i of [1, 2, 3]; track i) {
            <div class="tarjeta animate-pulse flex items-center justify-between p-3.5">
              <div class="space-y-1.5 flex-1">
                <div class="h-4 w-44 rounded bg-slate-200"></div>
                <div class="h-3 w-64 rounded bg-slate-100"></div>
              </div>
              <div class="h-7 w-20 rounded bg-slate-200"></div>
            </div>
          }
        </div>
      </div>
    }
    @else {
      <p class="titulo-seccion mb-2">Cuentas que necesitan un llamado ({{ accion().length }})</p>
      <div class="mb-5 space-y-2">
        @for (c of accion(); track c.uid) {
          <article class="tarjeta flex flex-wrap items-center justify-between gap-2 p-3">
            <button class="min-w-0 text-left flex-1" (click)="abierta.set(c.uid)">
              <p class="font-bold hover:text-marca-500">{{ c.nombreTaller || c.email }} <span class="insignia" [class]="salud[c.salud][1]">{{ salud[c.salud][0] }}</span></p>
              <p class="text-xs text-slate-500">{{ c.motivo }} · {{ plan[c.modo] }} ·
                @for (p of pasosDe(c); track p.k) { <span class="mr-1.5">{{ p.ok ? '✓' : '·' }} {{ p.t }}</span> }</p>
            </button>
            <div class="flex items-center gap-1.5 shrink-0">
              @if (telC(c); as telUrl) {
                <a class="btn !px-2.5 !text-slate-700 hover:!bg-slate-100" [href]="telUrl" title="Llamar directamente">📞</a>
              }
              @if (wa(c); as w) { <a class="btn-wa btn !px-2.5" target="_blank" rel="noopener" [href]="w | wa">WhatsApp</a> } @else { <span class="text-xs text-slate-400">sin WhatsApp</span> }
              <button class="btn !px-2.5" (click)="abierta.set(c.uid)">Cuenta</button>
            </div>
          </article>
        } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Todas las cuentas van bien.</p> }
      </div>
      <p class="titulo-seccion mb-2">Prospectos con seguimiento vencido ({{ vencidos().length }})</p>
      <div class="space-y-2">
        @for (t of vencidos(); track t.id) {
          <article class="tarjeta flex flex-wrap items-center justify-between gap-2 p-3">
            <button class="min-w-0 text-left flex-1" (click)="tallerAbierto.set(t.id)">
              <p class="font-bold hover:text-marca-500">{{ t.nombre }} <span class="text-xs font-normal text-slate-500">{{ t.comuna }} · {{ t.estado }}</span></p>
              <p class="text-xs text-slate-500">Tocaba el {{ (t.proximo_contacto || '').slice(0, 10) }}@if (t.telefono && t.telefono !== 'No especificado') { · {{ t.telefono }} }</p>
            </button>
            <div class="flex items-center gap-1.5 shrink-0">
              @if (telT(t); as telUrl) {
                <a class="btn !px-2.5 !text-slate-700 hover:!bg-slate-100" [href]="telUrl" title="Llamar directamente">📞</a>
              }
              @if (conWa(t)) { <a class="btn-wa btn !px-2.5" target="_blank" rel="noopener" [href]="waT(t) | wa">WhatsApp</a> }
              <button class="btn !px-2.5" (click)="tallerAbierto.set(t.id)">Ficha</button>
            </div>
          </article>
        } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Nada vencido.</p> }
      </div>
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
