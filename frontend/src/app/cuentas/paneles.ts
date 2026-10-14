import { WaPipe } from '../compartido/wa.pipe';
// Cobros, métricas, soporte, errores y auditoría: vistas de lectura con alguna
// acción puntual, todas contra /api/maza (solo admin).
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { CuentaSalud, NOMBRE_PLAN } from '../core/modelos';
import { fecha, fechaHora, linkWa, plata } from '../core/utiles';
import { FichaCuenta } from './ficha-cuenta';
import { waCuenta } from './comun';

@Component({
  selector: 'app-cobros',
  imports: [FormsModule, FichaCuenta, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p class="titulo-seccion">Cobros</p><h1 class="text-xl font-bold text-slate-900">Pagos y renovaciones</h1></div>
      <button class="btn" [disabled]="cargando()" (click)="ngOnInit()">↻ Actualizar</button>
    </section>

    <section class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div class="tarjeta p-3">
        <p class="text-[11px] font-bold uppercase text-slate-500">Vencen en 7 días</p>
        <p class="text-2xl font-extrabold text-amber-700">{{ renovar().length }}</p>
      </div>
      <div class="tarjeta p-3">
        <p class="text-[11px] font-bold uppercase text-slate-500">Pagos registrados</p>
        <p class="text-2xl font-extrabold text-slate-900">{{ pagosFiltrados().length }}</p>
      </div>
      <div class="tarjeta p-3">
        <p class="text-[11px] font-bold uppercase text-slate-500">Total recaudado (vista)</p>
        <p class="text-2xl font-extrabold text-emerald-700">{{ p(totalRecaudado()) }}</p>
      </div>
    </section>

    <p class="titulo-seccion mb-2">Vencen en 7 días ({{ renovar().length }})</p>
    <div class="mb-5 space-y-2">
      @if (cargando()) {
        <div class="tarjeta animate-pulse p-4"><div class="h-4 w-48 rounded bg-slate-200"></div></div>
      } @else {
        @for (c of renovar(); track c.uid) {
          <article class="tarjeta flex flex-wrap items-center justify-between gap-2 border-l-4 !border-l-amber-400 p-3">
            <button class="text-left" (click)="abierta.set(c.uid)">
              <p class="font-bold text-slate-900 hover:text-marca-500">{{ c.nombreTaller || c.email }}</p>
              <p class="text-xs text-slate-500">{{ plan[c.modo] }} · {{ c.motivo }}</p>
            </button>
            <div class="flex items-center gap-1.5">
              @if (wa(c); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">WhatsApp</a> }
              <button class="btn-primario btn" (click)="abierta.set(c.uid)">Ficha</button>
            </div>
          </article>
        } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Nada por vencer en los próximos 7 días.</p> }
      }
    </div>

    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p class="titulo-seccion">Historial de pagos</p>
      <input class="campo !w-64 !py-1.5 text-xs" placeholder="Filtrar por taller, plan o medio…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
    </div>
    <div class="tarjeta overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="bg-fondo text-left uppercase text-slate-500">
          <tr><th class="px-3 py-2.5">Fecha</th><th class="px-3 py-2.5">Taller</th><th class="px-3 py-2.5">Plan</th><th class="px-3 py-2.5">Meses</th><th class="px-3 py-2.5">Medio</th><th class="px-3 py-2.5 text-right">Monto</th></tr>
        </thead>
        <tbody>
          @if (cargando()) {
            @for (i of [1, 2, 3]; track i) {
              <tr class="animate-pulse border-t border-borde"><td colspan="6" class="px-3 py-3"><div class="h-4 w-full rounded bg-slate-100"></div></td></tr>
            }
          } @else {
            @for (x of pagosFiltrados(); track x.id) {
              <tr class="border-t border-borde hover:bg-marca-50/50 cursor-pointer" (click)="abierta.set(x.uid)">
                <td class="px-3 py-2.5 whitespace-nowrap">{{ f(x.fecha) }}</td>
                <td class="px-3 py-2.5 font-semibold text-slate-800">{{ quien(x.uid) }}</td>
                <td class="px-3 py-2.5">{{ plan[x.plan] || x.plan }}</td>
                <td class="px-3 py-2.5">{{ x.meses }}</td>
                <td class="px-3 py-2.5">{{ x.medio }}</td>
                <td class="px-3 py-2.5 text-right font-bold text-emerald-700">{{ p(x.monto) }}</td>
              </tr>
            } @empty { <tr><td colspan="6" class="px-3 py-8 text-center text-slate-500">Sin pagos registrados.</td></tr> }
          }
        </tbody>
      </table>
    </div>
    @if (abierta(); as uid) { <app-ficha-cuenta [uid]="uid" (cerrar)="abierta.set(null); ngOnInit()" /> }
  `,
})
export class Cobros implements OnInit {
  private api = inject(Api);
  readonly plan = NOMBRE_PLAN;
  pagos = signal<any[]>([]);
  salud = signal<CuentaSalud[]>([]);
  cargando = signal(true);
  q = signal('');
  abierta = signal<string | null>(null);
  renovar = computed(() => this.salud().filter((c) => c.salud === 'renovar'));
  pagosFiltrados = computed(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return this.pagos();
    return this.pagos().filter((x) =>
      [this.quien(x.uid), this.plan[x.plan] || x.plan, x.medio, x.nota].some((v) => String(v || '').toLowerCase().includes(q)),
    );
  });
  totalRecaudado = computed(() => this.pagosFiltrados().reduce((acc, x) => acc + Number(x.monto || 0), 0));
  f = fecha; p = plata;
  async ngOnInit() {
    this.cargando.set(true);
    try {
      const [p, s] = await Promise.all([this.api.pagos(), this.api.saludCuentas()]);
      this.pagos.set(p); this.salud.set(s);
    } finally { this.cargando.set(false); }
  }
  quien = (uid: string) => { const c = this.salud().find((x) => x.uid === uid); return c ? c.nombreTaller || c.email : uid; };
  wa = (c: CuentaSalud) => waCuenta(c, 'renovar');
}

@Component({
  selector: 'app-metricas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Métricas</p><h1 class="text-xl font-bold">Cómo va MAZA</h1></section>
    @if (m(); as m) {
      <section class="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        @for (k of [['MRR', p(m.mrr)], ['Pagando', m.pagando], ['En prueba', m.enPrueba], ['Pruebas vencidas', m.vencidas], ['En riesgo', m.enRiesgo]]; track k[0]) {
          <div class="tarjeta p-3"><p class="text-[11px] font-bold uppercase text-slate-500">{{ k[0] }}</p><p class="text-2xl font-extrabold">{{ k[1] }}</p></div>
        }
      </section>
      <div class="tarjeta mb-3 p-3">
        <p class="mb-2 text-sm font-bold">Ingresos por mes</p>
        @for (x of m.ingresosPorMes; track x.mes) {
          <div class="flex items-center gap-2 py-0.5 text-xs"><span class="w-16">{{ x.mes }}</span><div class="h-2 flex-1 rounded bg-fondo"><div class="h-2 rounded bg-marca-500" [style.width.%]="x.monto / maxIngreso() * 100"></div></div><span class="w-24 text-right">{{ p(x.monto) }}</span></div>
        } @empty { <p class="text-xs text-slate-500">Sin pagos todavía.</p> }
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        @for (t of [['Conversión por mes de alta', m.porMesDeAlta], ['Por rubro', m.porRubro], ['Por ciudad', m.porCiudad]]; track t[0]) {
          <div class="tarjeta p-3">
            <p class="mb-2 text-sm font-bold">{{ t[0] }}</p>
            @for (f of $any(t[1]); track f.grupo) {
              <div class="flex items-center gap-2 py-0.5 text-xs"><span class="w-24 truncate">{{ f.grupo }}</span><div class="h-2 flex-1 rounded bg-fondo"><div class="h-2 rounded bg-emerald-500" [style.width.%]="f.pct"></div></div><span class="w-20 text-right">{{ f.pagando }}/{{ f.total }} · {{ f.pct }}%</span></div>
            } @empty { <p class="text-xs text-slate-500">Sin datos.</p> }
          </div>
        }
      </div>
    } @else { <p class="py-10 text-center text-sm text-slate-500">Calculando…</p> }
  `,
})
export class Metricas implements OnInit {
  private api = inject(Api);
  m = signal<any>(null);
  p = plata;
  maxIngreso = computed(() => Math.max(1, ...(this.m()?.ingresosPorMes ?? []).map((x: any) => x.monto)));
  async ngOnInit() { this.m.set(await this.api.metricas()); }
}

@Component({
  selector: 'app-soporte',
  imports: [FormsModule, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 divide-y divide-borde overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-4 sm:py-3.5">
        <div><p class="titulo-seccion">Soporte</p><h1 class="text-xl font-bold text-slate-900">Tickets de los talleres</h1></div>
        <button class="btn" [disabled]="cargando()" (click)="ngOnInit()">↻ Actualizar</button>
      </div>
      <div class="flex items-center gap-1.5 bg-slate-50/75 px-3 py-2 text-xs font-semibold sm:px-4">
        <button class="rounded-md px-3 py-1.5" [class]="filtro() === 'abierto' ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'" (click)="filtro.set('abierto')">
          Abiertos ({{ abiertos() }})
        </button>
        <button class="rounded-md px-3 py-1.5" [class]="filtro() === 'resuelto' ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'" (click)="filtro.set('resuelto')">
          Resueltos ({{ tickets().length - abiertos() }})
        </button>
        <button class="rounded-md px-3 py-1.5" [class]="filtro() === 'todos' ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'" (click)="filtro.set('todos')">
          Todos ({{ tickets().length }})
        </button>
      </div>
    </section>

    <div class="space-y-2">
      @if (cargando()) {
        @for (i of [1, 2, 3]; track i) {
          <div class="tarjeta animate-pulse p-4 space-y-2"><div class="h-4 w-48 rounded bg-slate-200"></div><div class="h-3 w-full rounded bg-slate-100"></div></div>
        }
      } @else {
        @for (x of lista(); track x.id) {
          <article class="tarjeta space-y-2 p-3.5" [class.!border-l-4]="x.estado === 'abierto'" [class.!border-l-amber-400]="x.estado === 'abierto'">
            <div class="flex justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="insignia" [class]="x.estado === 'abierto' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'">
                  {{ x.estado === 'abierto' ? 'Abierto' : 'Resuelto' }}
                </span>
                <p class="font-bold text-slate-900">{{ x.asunto }}</p>
              </div>
              <span class="text-xs text-slate-500">{{ fh(x.fecha) }}</span>
            </div>
            <p class="text-xs text-slate-500">{{ x.nombreTaller }} · {{ x.email }}</p>
            <p class="whitespace-pre-wrap text-sm text-slate-800">{{ x.descripcion }}</p>
            @if (x.estado === 'abierto') {
              <textarea rows="2" class="campo" placeholder="Respuesta (opcional, la ve el taller)" [(ngModel)]="respuestas[x.id]"></textarea>
              <div class="flex flex-wrap gap-2">
                <button class="btn-primario btn" (click)="resolver(x)">✓ Marcar resuelto</button>
                @if (wa(x); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">💬 Consultar por WhatsApp</a> }
              </div>
            } @else {
              <p class="text-xs font-medium text-emerald-700">Resuelto{{ x.respuesta ? ': ' + x.respuesta : '' }}</p>
              @if (wa(x); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">Avisar por WhatsApp</a> }
            }
          </article>
        } @empty { <p class="tarjeta p-6 text-center text-sm text-slate-500">Sin tickets en esta vista.</p> }
      }
    </div>
  `,
})
export class Soporte implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  tickets = signal<any[]>([]);
  cargando = signal(true);
  filtro = signal<'abierto' | 'resuelto' | 'todos'>('abierto');
  abiertos = computed(() => this.tickets().filter((x) => x.estado === 'abierto').length);
  lista = computed(() => this.filtro() === 'todos' ? this.tickets() : this.tickets().filter((x) => x.estado === this.filtro()));
  telefonos = new Map<string, string>();
  respuestas: Record<string, string> = {};
  fh = fechaHora;
  async ngOnInit() {
    this.cargando.set(true);
    try {
      const [t, c] = await Promise.all([this.api.tickets(), this.api.cuentas()]);
      c.cuentas.forEach((x) => this.telefonos.set(x.uid, x.telefono));
      this.tickets.set(t);
    } finally { this.cargando.set(false); }
  }
  wa = (x: any) => linkWa(this.telefonos.get(x.uid), `Hola, te escribo de MAZA por tu reporte «${x.asunto}»: ${x.respuesta || 'ya quedó resuelto'}.`);
  async resolver(x: any) {
    try { await this.api.resolverTicket(x.id, this.respuestas[x.id] || ''); this.sesion.avisar('Ticket resuelto'); this.ngOnInit(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }
}

@Component({
  selector: 'app-errores',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p class="titulo-seccion">Errores</p><h1 class="text-xl font-bold text-slate-900">Lo que reporta la app ({{ filtrados().length }})</h1></div>
      <div class="flex gap-2">
        <input class="campo !w-56 !py-1.5 text-xs" placeholder="Buscar por mensaje o taller…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <button class="btn" [disabled]="cargando()" (click)="ngOnInit()">↻ Actualizar</button>
      </div>
    </section>
    <div class="space-y-2">
      @if (cargando()) {
        @for (i of [1, 2, 3]; track i) {
          <div class="tarjeta animate-pulse p-3.5 space-y-1.5"><div class="h-4 w-64 rounded bg-slate-200"></div><div class="h-3 w-40 rounded bg-slate-100"></div></div>
        }
      } @else {
        @for (x of filtrados(); track x.id) {
          <details class="tarjeta p-3">
            <summary class="cursor-pointer text-sm">
              <b>{{ x.mensaje }}</b>
              <span class="block text-xs text-slate-500">{{ fh(x.fecha) }} · {{ x.nombreTaller || x.email || 'anónimo' }} · {{ x.ruta }} · v{{ x.appVersion }}</span>
            </summary>
            <pre class="mt-2 overflow-x-auto rounded bg-slate-900 p-2.5 font-mono text-[11px] text-slate-100">{{ x.stack }}</pre>
            <button class="btn-peligro btn mt-2" (click)="borrar(x.id)">Marcar visto (borrar)</button>
          </details>
        } @empty { <p class="tarjeta p-6 text-center text-sm text-slate-500">Sin errores registrados.</p> }
      }
    </div>
  `,
})
export class Errores implements OnInit {
  private api = inject(Api);
  errores = signal<any[]>([]);
  cargando = signal(true);
  q = signal('');
  filtrados = computed(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return this.errores();
    return this.errores().filter((x) => [x.mensaje, x.nombreTaller, x.email, x.ruta].some((v) => String(v || '').toLowerCase().includes(q)));
  });
  fh = fechaHora;
  async ngOnInit() {
    this.cargando.set(true);
    try { this.errores.set(await this.api.errores()); }
    finally { this.cargando.set(false); }
  }
  async borrar(id: string) { await this.api.borrarError(id); this.errores.update((l) => l.filter((x) => x.id !== id)); }
}

@Component({
  selector: 'app-auditoria',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p class="titulo-seccion">Auditoría</p><h1 class="text-xl font-bold text-slate-900">Cambios en cuentas</h1></div>
      <div class="flex gap-2">
        <input class="campo !w-60 !py-1.5 text-xs" placeholder="Filtrar por cuenta, acción o autor…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <button class="btn" [disabled]="cargando()" (click)="ngOnInit()">↻ Actualizar</button>
      </div>
    </section>
    <div class="tarjeta overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="bg-fondo text-left uppercase text-slate-500">
          <tr><th class="px-3 py-2.5">Fecha</th><th class="px-3 py-2.5">Acción</th><th class="px-3 py-2.5">Cuenta</th><th class="px-3 py-2.5">Cambio</th><th class="px-3 py-2.5">Quién</th></tr>
        </thead>
        <tbody>
          @if (cargando()) {
            @for (i of [1, 2, 3, 4]; track i) {
              <tr class="animate-pulse border-t border-borde"><td colspan="5" class="px-3 py-3"><div class="h-4 w-full rounded bg-slate-100"></div></td></tr>
            }
          } @else {
            @for (a of filtradas(); track a.id) {
              <tr class="border-t border-borde align-top hover:bg-slate-50/80">
                <td class="whitespace-nowrap px-3 py-2.5 text-slate-500">{{ fh(a.fecha) }}</td>
                <td class="px-3 py-2.5"><span class="insignia border-borde bg-fondo font-bold text-slate-800">{{ a.accion }}</span></td>
                <td class="px-3 py-2.5 font-medium text-slate-800">{{ a.email || a.uid }}</td>
                <td class="px-3 py-2.5 font-mono text-[11px] text-slate-600">@for (c of cambios(a); track c) { <p>{{ c }}</p> }</td>
                <td class="px-3 py-2.5 text-slate-500">{{ a.actor }}</td>
              </tr>
            } @empty { <tr><td colspan="5" class="px-3 py-8 text-center text-slate-500">Sin cambios registrados.</td></tr> }
          }
        </tbody>
      </table>
    </div>
  `,
})
export class Auditoria implements OnInit {
  private api = inject(Api);
  filas = signal<any[]>([]);
  cargando = signal(true);
  q = signal('');
  filtradas = computed(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return this.filas();
    return this.filas().filter((a) => [a.accion, a.email, a.uid, a.actor].some((v) => String(v || '').toLowerCase().includes(q)));
  });
  fh = fechaHora;
  async ngOnInit() {
    this.cargando.set(true);
    try { this.filas.set(await this.api.auditoria()); }
    finally { this.cargando.set(false); }
  }
  cambios(a: any): string[] {
    if (!a.despues) return [];
    const antes = a.antes || {};
    return Object.keys(a.despues).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(a.despues[k]))
      .map((k) => a.antes ? `${k}: ${JSON.stringify(antes[k])} → ${JSON.stringify(a.despues[k])}` : `${k}: ${JSON.stringify(a.despues[k])}`);
  }
}
