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
  imports: [FichaCuenta, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Cobros</p><h1 class="text-xl font-bold">Pagos y renovaciones</h1></section>
    <p class="titulo-seccion mb-2">Vencen en 7 días</p>
    <div class="mb-5 space-y-2">
      @for (c of renovar(); track c.uid) {
        <article class="tarjeta flex items-center justify-between gap-2 border-l-4 !border-l-amber-400 p-3">
          <button class="text-left" (click)="abierta.set(c.uid)"><p class="font-bold">{{ c.nombreTaller || c.email }}</p><p class="text-xs text-slate-500">{{ plan[c.modo] }} · {{ c.motivo }}</p></button>
          @if (wa(c); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">WhatsApp</a> }
        </article>
      } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Nada por vencer.</p> }
    </div>
    <p class="titulo-seccion mb-2">Pagos</p>
    <div class="tarjeta overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="bg-fondo text-left uppercase text-slate-500"><tr><th class="px-3 py-2">Fecha</th><th class="px-3 py-2">Taller</th><th class="px-3 py-2">Plan</th><th class="px-3 py-2">Meses</th><th class="px-3 py-2">Medio</th><th class="px-3 py-2 text-right">Monto</th></tr></thead>
        <tbody>
          @for (x of pagos(); track x.id) {
            <tr class="border-t border-borde"><td class="px-3 py-2">{{ f(x.fecha) }}</td><td class="px-3 py-2">{{ quien(x.uid) }}</td><td class="px-3 py-2">{{ plan[x.plan] || x.plan }}</td><td class="px-3 py-2">{{ x.meses }}</td><td class="px-3 py-2">{{ x.medio }}</td><td class="px-3 py-2 text-right font-bold">{{ p(x.monto) }}</td></tr>
          } @empty { <tr><td colspan="6" class="px-3 py-8 text-center text-slate-500">Sin pagos.</td></tr> }
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
  abierta = signal<string | null>(null);
  renovar = computed(() => this.salud().filter((c) => c.salud === 'renovar'));
  f = fecha; p = plata;
  async ngOnInit() {
    const [p, s] = await Promise.all([this.api.pagos(), this.api.saludCuentas()]);
    this.pagos.set(p); this.salud.set(s);
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
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Soporte</p><h1 class="text-xl font-bold">Tickets de los talleres</h1></section>
    <div class="space-y-2">
      @for (x of tickets(); track x.id) {
        <article class="tarjeta space-y-2 p-3" [class.!border-l-4]="x.estado === 'abierto'" [class.!border-l-amber-400]="x.estado === 'abierto'">
          <div class="flex justify-between gap-2"><p class="font-bold">{{ x.asunto }}</p><span class="text-xs text-slate-500">{{ fh(x.fecha) }}</span></div>
          <p class="text-xs text-slate-500">{{ x.nombreTaller }} · {{ x.email }}</p>
          <p class="whitespace-pre-wrap text-sm">{{ x.descripcion }}</p>
          @if (x.estado === 'abierto') {
            <textarea rows="2" class="campo" placeholder="Respuesta (opcional, la ve el taller)" [(ngModel)]="respuestas[x.id]"></textarea>
            <button class="btn-primario btn" (click)="resolver(x)">Marcar resuelto</button>
          } @else {
            <p class="text-xs text-emerald-700">Resuelto{{ x.respuesta ? ': ' + x.respuesta : '' }}</p>
            @if (wa(x); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">Avisar por WhatsApp</a> }
          }
        </article>
      } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Sin tickets.</p> }
    </div>
  `,
})
export class Soporte implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  tickets = signal<any[]>([]);
  telefonos = new Map<string, string>();
  respuestas: Record<string, string> = {};
  fh = fechaHora;
  async ngOnInit() {
    const [t, c] = await Promise.all([this.api.tickets(), this.api.cuentas()]);
    c.cuentas.forEach((x) => this.telefonos.set(x.uid, x.telefono));
    this.tickets.set(t);
  }
  wa = (x: any) => linkWa(this.telefonos.get(x.uid), `Hola, te escribo de MAZA por tu reporte «${x.asunto}»: ${x.respuesta || 'ya quedó resuelto'}.`);
  async resolver(x: any) {
    try { await this.api.resolverTicket(x.id, this.respuestas[x.id] || ''); this.sesion.avisar('Ticket resuelto'); this.ngOnInit(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }
}

@Component({
  selector: 'app-errores',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Errores</p><h1 class="text-xl font-bold">Lo que reporta la app</h1></section>
    <div class="space-y-2">
      @for (x of errores(); track x.id) {
        <details class="tarjeta p-3">
          <summary class="cursor-pointer text-sm"><b>{{ x.mensaje }}</b><span class="block text-xs text-slate-500">{{ fh(x.fecha) }} · {{ x.nombreTaller || x.email || 'anónimo' }} · {{ x.ruta }} · v{{ x.appVersion }}</span></summary>
          <pre class="mt-2 overflow-x-auto font-mono text-[11px] text-slate-600">{{ x.stack }}</pre>
          <button class="btn mt-2" (click)="borrar(x.id)">Marcar visto (borrar)</button>
        </details>
      } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Sin errores registrados.</p> }
    </div>
  `,
})
export class Errores implements OnInit {
  private api = inject(Api);
  errores = signal<any[]>([]);
  fh = fechaHora;
  async ngOnInit() { this.errores.set(await this.api.errores()); }
  async borrar(id: string) { await this.api.borrarError(id); this.errores.update((l) => l.filter((x) => x.id !== id)); }
}

@Component({
  selector: 'app-auditoria',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Auditoría</p><h1 class="text-xl font-bold">Cambios en cuentas</h1></section>
    <div class="tarjeta overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="bg-fondo text-left uppercase text-slate-500"><tr><th class="px-3 py-2">Fecha</th><th class="px-3 py-2">Acción</th><th class="px-3 py-2">Cuenta</th><th class="px-3 py-2">Cambio</th><th class="px-3 py-2">Quién</th></tr></thead>
        <tbody>
          @for (a of filas(); track a.id) {
            <tr class="border-t border-borde align-top">
              <td class="whitespace-nowrap px-3 py-2">{{ fh(a.fecha) }}</td><td class="px-3 py-2 font-bold">{{ a.accion }}</td><td class="px-3 py-2">{{ a.email || a.uid }}</td>
              <td class="px-3 py-2 font-mono">@for (c of cambios(a); track c) { <p>{{ c }}</p> }</td><td class="px-3 py-2">{{ a.actor }}</td>
            </tr>
          } @empty { <tr><td colspan="5" class="px-3 py-8 text-center text-slate-500">Sin cambios registrados.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class Auditoria implements OnInit {
  private api = inject(Api);
  filas = signal<any[]>([]);
  fh = fechaHora;
  async ngOnInit() { this.filas.set(await this.api.auditoria()); }
  cambios(a: any): string[] {
    if (!a.despues) return [];
    const antes = a.antes || {};
    return Object.keys(a.despues).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(a.despues[k]))
      .map((k) => a.antes ? `${k}: ${JSON.stringify(antes[k])} → ${JSON.stringify(a.despues[k])}` : `${k}: ${JSON.stringify(a.despues[k])}`);
  }
}
