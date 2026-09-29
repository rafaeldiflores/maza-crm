import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { Api, Sesion, mensajeError } from '../core/api';
import { Taller } from '../core/modelos';
import { direccionValida, urlRuta } from '../core/utiles';
import { Modal } from '../compartido/modal';

// ─── Panel de conversión ─────────────────────────────────────────────────────
@Component({
  selector: 'app-embudo',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Panel de conversión" subtitulo="Quién llegó alguna vez a cada etapa y ritmo de los últimos 14 días" (cerrar)="cerrar.emit()">
      @if (embudo(); as e) {
        <p class="titulo-seccion">Embudo</p>
        @for (f of e.funnel; track f.estado) {
          <div class="flex items-center gap-2 text-xs">
            <span class="w-32 truncate">{{ f.estado }}</span>
            <div class="h-5 flex-1 rounded bg-fondo"><div class="h-5 rounded bg-marca-500" [style.width.%]="f.pct_total"></div></div>
            <span class="w-28 text-right"><b>{{ f.count }}</b> · {{ f.pct_etapa_anterior }}% de la anterior</span>
          </div>
        }
        <p class="text-[11px] text-slate-500">{{ e.descartados_en_algun_punto }} descartados en algún punto.</p>
      }
      <p class="titulo-seccion pt-2">Nuevos vs. visitas (14 días)</p>
      <div class="flex h-32 items-end gap-1 border-b border-borde">
        @for (d of tendencia(); track d.fecha) {
          <div class="flex flex-1 items-end gap-px" [title]="d.fecha + ': ' + d.nuevos + ' nuevos, ' + d.visitas + ' visitas'">
            <div class="flex-1 rounded-t bg-marca-400" [style.height.%]="d.nuevos / maximo() * 100"></div>
            <div class="flex-1 rounded-t bg-emerald-500" [style.height.%]="d.visitas / maximo() * 100"></div>
          </div>
        }
      </div>
      <p class="flex gap-4 text-[11px] text-slate-500"><span>■ <span class="text-marca-400">talleres nuevos</span></span><span>■ <span class="text-emerald-500">visitas</span></span></p>
    </app-modal>
  `,
})
export class Embudo implements OnInit {
  private api = inject(Api);
  cerrar = output<void>();
  embudo = signal<Awaited<ReturnType<Api['embudo']>> | null>(null);
  tendencia = signal<{ fecha: string; nuevos: number; visitas: number }[]>([]);
  maximo = computed(() => Math.max(1, ...this.tendencia().map((d) => Math.max(d.nuevos, d.visitas))));
  async ngOnInit() {
    const [e, t] = await Promise.all([this.api.embudo(), this.api.tendencia(14)]);
    this.embudo.set(e);
    this.tendencia.set(t);
  }
}

// ─── Plan de ruta ────────────────────────────────────────────────────────────
const MAX_PARADAS = 10; // Google Maps degrada la experiencia con más paradas

@Component({
  selector: 'app-ruta',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Plan de ruta del día" subtitulo="Por visitar y seguimientos vencidos, agrupados por comuna" (cerrar)="cerrar.emit()">
      <div class="flex flex-wrap gap-1.5">
        @for (r of rubros(); track r) {
          <button class="rounded-full border px-3 py-1 text-xs font-semibold"
                  [class]="rubro() === r ? 'border-marca-800 bg-marca-800 text-white' : 'border-borde bg-white hover:bg-fondo'"
                  (click)="rubro.set(r)">{{ r }} ({{ cuenta(r) }})</button>
        }
      </div>
      @for (g of grupos(); track g.comuna) {
        <details class="overflow-hidden rounded-lg border border-borde" open>
          <summary class="flex cursor-pointer items-center justify-between bg-fondo px-3 py-2 text-sm font-bold">📍 {{ g.comuna }} <span class="insignia border-marca-200 bg-marca-50 text-marca-700">{{ g.items.length }}</span></summary>
          <div class="flex items-center justify-between border-b border-borde px-3 py-1.5">
            <label class="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked (change)="marcarComuna(g.items, $any($event.target).checked)" /> Todos con dirección</label>
            <button class="btn" (click)="abrir(g.items)">Ruta en Maps</button>
          </div>
          @for (t of g.items; track t.id) {
            <div class="flex items-center gap-2 border-b border-borde px-3 py-2 last:border-0">
              <input type="checkbox" [disabled]="!valida(t)" [checked]="elegidos().has(t.id)" (change)="alternar(t.id)" />
              <div class="min-w-0 flex-1"><p class="truncate text-xs font-bold">{{ t.nombre }}</p>
                <p class="truncate text-[11px]" [class]="valida(t) ? 'text-slate-500' : 'italic text-red-500'">{{ t.direccion || 'Sin dirección — no se puede rutear' }}</p></div>
              <button class="btn" (click)="abrirFicha.emit(t.id)">Ficha</button>
            </div>
          }
        </details>
      } @empty { <p class="py-8 text-center text-sm text-slate-500">Nada pendiente. ¡Al día!</p> }
      @if (grupos().length) {
        <div class="flex items-center justify-between border-t border-borde pt-3 text-xs">
          <span>{{ seleccionVisible() }} seleccionados</span>
          <button class="btn-primario btn" (click)="abrir(visibles())">Ruta combinada</button>
        </div>
      }
    </app-modal>
  `,
})
export class Ruta implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  cerrar = output<void>();
  abrirFicha = output<number>({ alias: 'abrir' });
  todos = signal<Taller[]>([]);
  elegidos = signal(new Set<number>());
  rubro = signal('Todos');
  valida = direccionValida;
  rubros = computed(() => ['Todos', ...[...new Set(this.todos().map((t) => t.rubro || 'General'))].sort()]);
  visibles = computed(() => this.todos().filter((t) => this.rubro() === 'Todos' || (t.rubro || 'General') === this.rubro()));
  seleccionVisible = computed(() => this.visibles().filter((t) => this.elegidos().has(t.id)).length);
  cuenta = (r: string) => (r === 'Todos' ? this.todos().length : this.todos().filter((t) => (t.rubro || 'General') === r).length);
  grupos = computed(() => {
    const m = new Map<string, Taller[]>();
    for (const t of this.visibles()) m.set(t.comuna, [...(m.get(t.comuna) ?? []), t]);
    return [...m.entries()].map(([comuna, items]) => ({ comuna, items })).sort((a, b) => b.items.length - a.items.length);
  });

  async ngOnInit() {
    const [a, b] = await Promise.all([this.api.talleres({ estado: 'Por consultar' }), this.api.talleres({ vencidos: true })]);
    const unicos = new Map([...a, ...b].map((t) => [t.id, t]));
    this.todos.set([...unicos.values()]);
    this.elegidos.set(new Set(this.todos().filter(direccionValida).map((t) => t.id)));
  }

  alternar(id: number) { const s = new Set(this.elegidos()); s.has(id) ? s.delete(id) : s.add(id); this.elegidos.set(s); }
  marcarComuna(items: Taller[], on: boolean) {
    const s = new Set(this.elegidos());
    items.filter(direccionValida).forEach((t) => (on ? s.add(t.id) : s.delete(t.id)));
    this.elegidos.set(s);
  }
  abrir(items: Taller[]) {
    let sel = items.filter((t) => this.elegidos().has(t.id));
    if (!sel.length) { this.sesion.avisar('Selecciona al menos un taller con dirección', false); return; }
    if (sel.length > MAX_PARADAS) {
      if (!confirm(`Google Maps funciona mejor con hasta ${MAX_PARADAS} paradas. ¿Abrir con las primeras ${MAX_PARADAS}?`)) return;
      sel = sel.slice(0, MAX_PARADAS);
    }
    const url = urlRuta(sel);
    if (url) window.open(url, '_blank', 'noopener');
  }
}

// ─── Duplicados ──────────────────────────────────────────────────────────────
@Component({
  selector: 'app-duplicados',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Posibles duplicados" subtitulo="Mismo teléfono o nombre muy parecido. Nada se borra solo: tú eliges" (cerrar)="cerrar.emit()">
      @for (g of grupos(); track $index) {
        <div class="rounded-lg border border-borde p-3">
          <p class="mb-2 text-xs font-bold">{{ g.motivo }} <span class="font-normal text-slate-500">· {{ g.detalle }}</span></p>
          @for (t of g.talleres; track t.id) {
            <div class="flex items-center justify-between gap-2 border-t border-borde py-1.5 text-xs">
              <span><b>{{ t.nombre }}</b> · {{ t.comuna }} · {{ t.estado }}</span>
              <button class="btn !text-red-700" (click)="borrar(t.id, t.nombre)">Eliminar</button>
            </div>
          }
        </div>
      } @empty { <p class="py-8 text-center text-sm text-slate-500">{{ cargado() ? 'Sin duplicados.' : 'Buscando…' }}</p> }
    </app-modal>
  `,
})
export class Duplicados implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  cerrar = output<void>();
  grupos = signal<Awaited<ReturnType<Api['duplicados']>>>([]);
  cargado = signal(false);
  async ngOnInit() { this.grupos.set(await this.api.duplicados()); this.cargado.set(true); }
  async borrar(id: number, nombre: string) {
    if (!confirm(`¿Eliminar «${nombre}»? Se borran también sus visitas.`)) return;
    try { await this.api.borrarTaller(id); this.sesion.avisar('Eliminado'); this.ngOnInit(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }
}

// ─── Guía de pitch ───────────────────────────────────────────────────────────
@Component({
  selector: 'app-pitch',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Guía de ventas en terreno" subtitulo="Argumentario para convencer al dueño del taller en 3 minutos" ancho="48rem" (cerrar)="cerrar.emit()">
      <div class="space-y-1 rounded-lg border border-marca-200 bg-marca-50 p-3 text-xs">
        <p class="titulo-seccion">Paso 1 · El gancho (30 s)</p>
        <p class="text-sm font-bold">«Hola don [Nombre], vengo a presentarle MAZA, una app chilena para talleres multirubro.»</p>
        <p><b>Pregunta clave:</b> <i>«¿Cómo llevan hoy el control de lo que entra y los repuestos? ¿Libreta, Excel o WhatsApp?»</i></p>
      </div>
      <p class="titulo-seccion">Paso 2 · Demo en tu celular (60 s)</p>
      <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div class="rounded-lg border border-borde bg-fondo p-3"><b>1. Recepción en 1 minuto</b><p class="text-slate-500">Ingresa el vehículo, marca daños con fotos y deja constancia al tiro.</p></div>
        <div class="rounded-lg border border-borde bg-fondo p-3"><b>2. WhatsApp al cliente</b><p class="text-slate-500">El presupuesto llega con un link para aprobar sin llamar.</p></div>
        <div class="rounded-lg border border-borde bg-fondo p-3"><b>3. Control de mecánicos</b><p class="text-slate-500">Qué mecánico tiene cada trabajo y cuánto gana el taller cada semana.</p></div>
      </div>
      <p class="titulo-seccion">Paso 3 · Objeciones</p>
      @for (o of objeciones; track o[0]) {
        <div class="rounded-lg border border-borde p-3 text-xs"><p class="font-bold">«{{ o[0] }}»</p><p class="text-slate-600">👉 <i>{{ o[1] }}</i></p></div>
      }
      <div class="rounded-lg bg-marca-800 p-3 text-xs text-white">
        <p class="font-bold uppercase text-marca-200">Cierre sin fricción</p>
        <p><i>«Don [Nombre], no me compre nada hoy. Probemos 14 días: le dejo la cuenta activa en su celular y paso el viernes a ver cómo le fue.»</i></p>
      </div>
    </app-modal>
  `,
})
export class Pitch {
  cerrar = output<void>();
  readonly objeciones = [
    ['Ya tengo una libreta y me funciona', 'La libreta no le avisa por WhatsApp al cliente cuando está listo ni guarda fotos si reclama un daño. MAZA le ahorra una hora al día respondiendo «¿cómo va lo mío?».'],
    ['No tengo tiempo para aprender sistemas', 'Es más simple que WhatsApp. Si me da 5 minutos, ahora mismo dejamos ingresado el trabajo que tiene en el elevador.'],
    ['¿Cuánto cuesta? No quiero suscripciones caras', 'Tiene 14 días gratis, sin tarjeta. Lo prueba con sus clientes reales y si le ahorra tiempo, conversamos.'],
  ];
}
