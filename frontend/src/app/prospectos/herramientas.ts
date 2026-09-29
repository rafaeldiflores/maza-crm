import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { Api, Sesion, mensajeError } from '../core/api';
import { Taller } from '../core/modelos';
import { direccionValida } from '../core/utiles';
import { Modal } from '../compartido/modal';
import { RutaEnCurso } from '../core/ruta-en-curso';

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
const MAX_PARADAS = 9; // lo que acepta un link de Google Maps además del origen

/**
 * Plan del día: parte sin nada marcado; se filtra por rubro, comuna o texto y
 * se eligen las paradas (hasta 9). «Ruta óptima» ordena desde la ubicación
 * actual y deja la ruta en curso (checklist con visitado/saltar).
 */
@Component({
  selector: 'app-ruta',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Plan de ruta del día" subtitulo="Por visitar y seguimientos vencidos. Filtra y elige hasta 9 paradas." ancho="44rem" (cerrar)="cerrar.emit()">
      <input class="campo" placeholder="Buscar taller o dirección…" [value]="q()" (input)="q.set($any($event.target).value)" />

      <div>
        <p class="titulo-seccion mb-1">Rubro</p>
        <div class="flex flex-wrap gap-1.5">
          @for (r of rubros(); track r.v) {
            <button class="rounded-full border px-3 py-1 text-xs font-semibold" [class]="chip(rubro() === r.v)" (click)="rubro.set(r.v)">{{ r.v }} ({{ r.n }})</button>
          }
        </div>
      </div>
      <div>
        <p class="titulo-seccion mb-1">Comuna</p>
        <div class="flex flex-wrap gap-1.5">
          @for (c of comunas(); track c.v) {
            <button class="rounded-full border px-3 py-1 text-xs font-semibold" [class]="chip(comuna() === c.v)" (click)="comuna.set(c.v)">{{ c.v }} ({{ c.n }})</button>
          }
        </div>
      </div>

      <div class="flex items-center justify-between text-xs">
        <span class="text-slate-500">{{ visibles().length }} talleres · {{ sinDireccion() }} sin dirección</span>
        <div class="flex gap-2">
          <button class="btn" (click)="marcarVisibles()">Marcar visibles</button>
          @if (elegidos().size) { <button class="btn" (click)="limpiar()">Limpiar ({{ elegidos().size }})</button> }
        </div>
      </div>

      <div class="divide-y divide-borde overflow-hidden rounded-lg border border-borde">
        @for (t of visibles(); track t.id) {
          <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-fondo" [class.bg-marca-50]="elegidos().has(t.id)" [class.cursor-not-allowed]="!valida(t)">
            <input type="checkbox" class="h-4 w-4" [disabled]="!valida(t)" [checked]="elegidos().has(t.id)" (change)="alternar(t)" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{{ t.nombre }}
                @if (t.puntaje_ia != null) { <span class="text-[11px] font-bold text-emerald-700">🎯 {{ t.puntaje_ia }}</span> }</p>
              <p class="truncate text-[11px]" [class]="valida(t) ? 'text-slate-500' : 'italic text-red-500'">{{ t.rubro }} · {{ t.comuna }} · {{ valida(t) ? t.direccion : 'sin dirección' }}</p>
            </div>
            @if (t.estado !== 'Por consultar') { <span class="insignia border-red-200 bg-red-50 text-red-700">Seguimiento</span> }
            <button class="btn !px-2" title="Ficha" (click)="$event.preventDefault(); abrirFicha.emit(t.id)">Ficha</button>
          </label>
        } @empty { <p class="p-6 text-center text-sm text-slate-500">{{ cargado() ? 'Nada con estos filtros.' : 'Cargando…' }}</p> }
      </div>

      <div class="sticky bottom-0 -mx-4 -mb-4 space-y-2 border-t border-borde bg-white p-3 sm:-mx-5 sm:-mb-5">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span class="font-semibold" [class.text-red-700]="elegidos().size > max">{{ elegidos().size }}/{{ max }} paradas</span>
          <label class="flex items-center gap-1.5"><input type="checkbox" [checked]="volver()" (change)="volver.set($any($event.target).checked)" /> Volver al inicio</label>
        </div>
        <button class="btn-primario btn w-full !py-3 !text-sm" [disabled]="elegidos().size < 2 || elegidos().size > max || optimizando()" (click)="optimizar()">
          {{ optimizando() ? 'Calculando la mejor ruta…' : '📍 Ruta óptima desde mi ubicación' }}</button>
      </div>
    </app-modal>
  `,
})
export class Ruta implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  private rutaEnCurso = inject(RutaEnCurso);
  cerrar = output<void>();
  abrirFicha = output<number>({ alias: 'abrir' });

  readonly max = MAX_PARADAS;
  readonly valida = direccionValida;
  todos = signal<Taller[]>([]);
  cargado = signal(false);
  elegidos = signal(new Set<number>());
  rubro = signal('Todos');
  comuna = signal('Todas');
  q = signal('');
  volver = signal(true);
  optimizando = signal(false);

  private filtrados = (rubro: string, comuna: string) => this.todos().filter((t) =>
    (rubro === 'Todos' || (t.rubro || 'General') === rubro) && (comuna === 'Todas' || t.comuna === comuna));

  private chips(valores: string[], todos: string, contar: (v: string) => number) {
    const unicos = [...new Set(valores)].map((v) => ({ v, n: contar(v) })).sort((a, b) => b.n - a.n);
    return [{ v: todos, n: contar(todos) }, ...unicos];
  }

  rubros = computed(() => this.chips(this.filtrados('Todos', this.comuna()).map((t) => t.rubro || 'General'), 'Todos',
    (v) => this.filtrados(v, this.comuna()).length));
  comunas = computed(() => this.chips(this.filtrados(this.rubro(), 'Todas').map((t) => t.comuna), 'Todas',
    (v) => this.filtrados(this.rubro(), v).length));
  visibles = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.filtrados(this.rubro(), this.comuna())
      .filter((t) => !q || [t.nombre, t.direccion, t.comuna].some((x) => (x || '').toLowerCase().includes(q)))
      .sort((a, b) => Number(direccionValida(b)) - Number(direccionValida(a)) || (b.puntaje_ia ?? -1) - (a.puntaje_ia ?? -1));
  });
  sinDireccion = computed(() => this.visibles().filter((t) => !direccionValida(t)).length);

  async ngOnInit() {
    const [a, b] = await Promise.all([this.api.talleres({ estado: 'Por consultar' }), this.api.talleres({ vencidos: true })]);
    this.todos.set([...new Map([...a, ...b].map((t) => [t.id, t])).values()]);
    this.cargado.set(true);
  }

  chip = (activo: boolean) => (activo ? 'border-marca-800 bg-marca-800 text-white' : 'border-borde bg-white hover:bg-fondo');

  alternar(t: Taller) {
    if (!direccionValida(t)) return;
    const s = new Set(this.elegidos());
    s.has(t.id) ? s.delete(t.id) : s.add(t.id);
    this.elegidos.set(s);
  }

  marcarVisibles() {
    const s = new Set(this.elegidos());
    for (const t of this.visibles()) { if (s.size >= MAX_PARADAS) break; if (direccionValida(t)) s.add(t.id); }
    this.elegidos.set(s);
  }

  optimizar() {
    const sel = this.todos().filter((t) => this.elegidos().has(t.id));
    if (!navigator.geolocation) { this.sesion.avisar('Este dispositivo no entrega ubicación', false); return; }
    this.optimizando.set(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const r = await this.api.optimizarRuta(lat, lng, sel.map((t) => t.id), this.volver());
        const porId = new Map(sel.map((t) => [t.id, t]));
        this.rutaEnCurso.iniciar(r.ids.map((id, i) => {
          const t = porId.get(id)!;
          return { id, nombre: t.nombre, direccion: t.direccion, comuna: t.comuna, placeId: t.place_id || undefined, lat: r.coords[i]?.lat ?? null, lng: r.coords[i]?.lng ?? null };
        }), this.volver(), r.km, r.minutos);
        this.rutaEnCurso.abrirUrl({ lat, lng });
        this.cerrar.emit();
      } catch (e) { this.sesion.avisar(mensajeError(e), false); }
      finally { this.optimizando.set(false); }
    }, () => { this.optimizando.set(false); this.sesion.avisar('Permite el acceso a tu ubicación', false); },
    { enableHighAccuracy: true, timeout: 15000 });
  }

  limpiar() { this.elegidos.set(new Set()); }
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
