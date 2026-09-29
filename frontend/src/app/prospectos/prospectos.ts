import { WaPipe } from '../compartido/wa.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { Api, Sesion, mensajeError } from '../core/api';
import { Estado, ETAPAS, Presets, Stats, Taller } from '../core/modelos';
import { COLOR_ESTADO, infoPrueba, linkPlantilla, seguimiento, tieneWa, waPorDefecto } from '../core/utiles';
import { FichaTaller } from './ficha-taller';
import { Rastreo } from './rastreo';
import { NuevoTaller } from './nuevo-taller';
import { Embudo, Ruta, Duplicados, Pitch } from './herramientas';

type Vista = 'tarjetas' | 'pipeline';
type Herramienta = 'embudo' | 'ruta' | 'duplicados' | 'pitch' | null;

const COLUMNAS: { estado: Estado; titulo: string; punto: string }[] = [
  { estado: 'Por consultar', titulo: 'Por visitar', punto: 'bg-blue-500' },
  { estado: 'Contactado', titulo: 'Contactados', punto: 'bg-amber-500' },
  { estado: 'Interesado', titulo: 'Interesados', punto: 'bg-teal-500' },
  { estado: 'En prueba 14 días', titulo: 'En prueba 14D', punto: 'bg-purple-500' },
  { estado: 'Cliente Activo', titulo: 'Clientes MAZA', punto: 'bg-emerald-500' },
  { estado: 'Descartado', titulo: 'Descartados', punto: 'bg-slate-400' },
];

/** Preferencias de filtros por dispositivo (no viajan al servidor). */
function leerPrefs(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('maza_ui_prefs') || '{}'); } catch { return {}; }
}
function guardarPrefs(p: Record<string, any>) {
  try { localStorage.setItem('maza_ui_prefs', JSON.stringify({ ...leerPrefs(), ...p })); } catch { /* sin storage */ }
}

@Component({
  selector: 'app-prospectos',
  imports: [FormsModule, NgTemplateOutlet, WaPipe, FichaTaller, Rastreo, NuevoTaller, Embudo, Ruta, Duplicados, Pitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Encabezado de página -->
    <section class="tarjeta mb-3 flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
      <div>
        <p class="titulo-seccion">Prospección</p>
        <h1 class="text-xl font-bold">Talleres</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn" (click)="nuevo.set(true)">＋ Agregar</button>
        <select class="btn !pr-2" [ngModel]="''" (ngModelChange)="herramienta.set($event || null)">
          <option value="">Herramientas…</option>
          <option value="embudo">Panel de conversión</option>
          <option value="ruta">Plan de ruta del día</option>
          <option value="duplicados">Posibles duplicados</option>
          <option value="pitch">Guía de pitch y objeciones</option>
        </select>
        <a class="btn" href="/api/export/excel">Excel</a>
        <button class="btn-primario btn" (click)="rastreo.set(true)">Rastrear talleres</button>
      </div>
    </section>

    <!-- KPIs -->
    @if (stats(); as s) {
      <section class="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        @for (k of kpis(); track k.t) {
          <button class="tarjeta p-2 text-left sm:p-3" (click)="k.accion?.()">
            <p class="truncate text-[10px] font-bold uppercase text-slate-500 sm:text-[11px]">{{ k.t }}</p>
            <p class="text-xl font-extrabold sm:text-2xl" [class]="k.color">{{ k.v }}</p>
          </button>
        }
      </section>
    }

    <!-- Filtros -->
    <section class="tarjeta mb-3 space-y-3 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-1 overflow-x-auto text-xs font-semibold">
          @for (e of filtrosEstado; track e.v) {
            <button class="whitespace-nowrap rounded-md px-3 py-1.5" [class]="estado() === e.v ? 'bg-marca-800 text-white' : 'hover:bg-fondo'"
                    (click)="cambiar('estado', e.v)">{{ e.t }}@if (e.v === 'Todos') { ({{ stats()?.total ?? 0 }}) }</button>
          }
        </div>
        <div class="flex rounded-md border border-borde p-0.5 text-xs font-semibold">
          <button class="rounded px-3 py-1" [class.bg-marca-50]="vista() === 'tarjetas'" (click)="cambiarVista('tarjetas')">Tarjetas</button>
          <button class="rounded px-3 py-1" [class.bg-marca-50]="vista() === 'pipeline'" (click)="cambiarVista('pipeline')">Pipeline</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <input class="campo min-w-[200px] flex-1" placeholder="Buscar por nombre, dirección o notas…" [ngModel]="busqueda()" (ngModelChange)="buscar($event)" />
        <select class="campo !w-auto" [ngModel]="comuna()" (ngModelChange)="cambiar('comuna', $event)">
          <option value="Todos">Todas las comunas</option>
          @for (c of stats()?.comunas ?? []; track c) { <option [value]="c">{{ c }}</option> }
        </select>
        <select class="campo !w-auto" [ngModel]="rubro()" (ngModelChange)="cambiar('rubro', $event)">
          <option value="Todos">Todos los rubros</option>
          @for (r of stats()?.rubros ?? []; track r) { <option [value]="r">{{ r }}</option> }
        </select>
        <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="cambiar('orden', $event)">
          <option value="pipeline">Orden del embudo</option>
          <option value="puntaje_ia">🎯 Prioridad IA</option>
          <option value="fecha_creacion">Más recientes</option>
          <option value="fecha_creacion_asc">Más antiguos</option>
          <option value="nombre">Nombre A-Z</option>
          <option value="calificacion">Mejor calificación</option>
          <option value="proximo_contacto">Próximo contacto</option>
        </select>
        <button class="btn" [class.!bg-emerald-50]="soloWa()" (click)="cambiar('soloWa', !soloWa())">💬 Con WhatsApp</button>
        <button class="btn" [class.!bg-red-50]="vencidos()" (click)="cambiar('vencidos', !vencidos())">⏰ Vencidos</button>
        @if (hayFiltros()) { <button class="btn !text-red-700" (click)="limpiar()">Limpiar</button> }
      </div>
      <p class="text-[11px] text-slate-500">{{ talleres().length }} talleres</p>
    </section>

    <!-- Resultados -->
    @if (cargando()) {
      <p class="py-10 text-center text-sm text-slate-500">Cargando…</p>
    } @else if (!talleres().length) {
      <div class="tarjeta py-12 text-center">
        <p class="font-bold">No hay talleres con estos filtros</p>
        <button class="btn-primario btn mt-3" (click)="rastreo.set(true)">Rastrear talleres</button>
      </div>
    } @else if (vista() === 'tarjetas') {
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        @for (t of talleres(); track t.id) { <ng-container *ngTemplateOutlet="tarjeta; context: { $implicit: t }" /> }
      </div>
    } @else {
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-3 xl:grid-cols-6">
        @for (col of columnas(); track col.estado) {
          <div class="rounded-lg border border-borde bg-white/60 p-2">
            <div class="mb-2 flex items-center justify-between px-1">
              <span class="flex items-center gap-1.5 text-xs font-bold uppercase"><span class="h-2 w-2 rounded-full" [class]="col.punto"></span>{{ col.titulo }}</span>
              <span class="insignia border-borde bg-fondo">{{ col.items.length }}</span>
            </div>
            <div class="space-y-2">
              @for (t of col.items; track t.id) { <ng-container *ngTemplateOutlet="tarjeta; context: { $implicit: t, compacta: true }" /> }
            </div>
          </div>
        }
      </div>
    }

    <ng-template #tarjeta let-t let-compacta="compacta">
      <article class="tarjeta flex flex-col gap-2 p-3" [class.border-l-4]="t.prioridad !== 'Media'"
               [class.!border-l-red-400]="t.prioridad === 'Alta'" [class.!border-l-slate-300]="t.prioridad === 'Baja'">
        <div class="flex items-start justify-between gap-2">
          <span class="insignia border-marca-200 bg-marca-50 text-marca-700">{{ t.rubro }}</span>
          <select class="insignia cursor-pointer" [class]="color(t.estado)" [ngModel]="t.estado" (ngModelChange)="cambiarEstado(t, $event)">
            @for (e of etapasTodas; track e) { <option [value]="e">{{ e }}</option> }
          </select>
        </div>
        <button class="text-left" (click)="ficha.set(t.id)">
          <h3 class="font-bold leading-tight hover:text-marca-500">{{ t.nombre }}</h3>
          <p class="text-xs text-slate-500">📍 {{ t.comuna }}@if (t.telefono && t.telefono !== 'No especificado') { · {{ t.telefono }} }</p>
        </button>
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          @if (t.calificacion && t.calificacion !== 'S/C') { <span class="font-bold text-amber-600">★ {{ t.calificacion }} <span class="font-normal text-slate-400">({{ t.opiniones }})</span></span> }
          @if (t.puntaje_ia != null) {
            <span class="insignia" [title]="t.ia_motivo" [class]="t.puntaje_ia >= 70 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : t.puntaje_ia >= 40 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500'">🎯 {{ t.puntaje_ia }}</span>
          }
          @if (prueba(t); as p) { <span class="insignia" [class]="p.color">{{ p.vencida ? 'Prueba vencida' : 'Día ' + p.dia + '/14' }}</span> }
          @if (seg(t); as s) { <span class="insignia" [class]="s.color">{{ s.texto }}</span> }
        </div>
        @if (!compacta) {
          <input class="campo !py-1.5 text-xs" placeholder="Nota rápida…" [ngModel]="t.observaciones" (change)="notaRapida(t, $any($event.target).value)" />
        }
        <div class="mt-auto flex items-center justify-between gap-2 border-t border-borde pt-2">
          @if (conWa(t)) {
            <a class="btn-wa btn" target="_blank" rel="noopener" [href]="waDefecto(t) | wa">WhatsApp</a>
          } @else { <span class="text-xs italic text-slate-400">Sin WhatsApp</span> }
          <button class="btn-primario btn" (click)="ficha.set(t.id)">Visita / ficha</button>
        </div>
      </article>
    </ng-template>

    @if (ficha(); as id) { <app-ficha-taller [id]="id" [presets]="presets()" (cerrar)="ficha.set(null)" (cambio)="recargar()" /> }
    @if (rastreo()) { <app-rastreo [presets]="presets()" (cerrar)="rastreo.set(false); recargar()" /> }
    @if (nuevo()) { <app-nuevo-taller [presets]="presets()" (cerrar)="nuevo.set(false)" (creado)="nuevo.set(false); recargar()" /> }
    @switch (herramienta()) {
      @case ('embudo') { <app-embudo (cerrar)="herramienta.set(null)" /> }
      @case ('ruta') { <app-ruta (cerrar)="herramienta.set(null)" (abrir)="herramienta.set(null); ficha.set($event)" /> }
      @case ('duplicados') { <app-duplicados (cerrar)="herramienta.set(null); recargar()" /> }
      @case ('pitch') { <app-pitch (cerrar)="herramienta.set(null)" /> }
    }
  `,
})
export class Prospectos implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);

  readonly etapasTodas: Estado[] = [...ETAPAS, 'Descartado'];
  readonly filtrosEstado = [
    { v: 'Todos', t: 'Todos' }, { v: 'Por consultar', t: '⏳ Por visitar' }, { v: 'Contactado', t: '📞 Contactados' },
    { v: 'Interesado', t: '💡 Interesados' }, { v: 'En prueba 14 días', t: '🚀 En prueba' },
    { v: 'Cliente Activo', t: '⭐ Clientes' }, { v: 'Descartado', t: '✕ Descartados' },
  ];

  private prefs = leerPrefs();
  estado = signal<string>(this.prefs['estado'] ?? 'Todos');
  comuna = signal<string>(this.prefs['comuna'] ?? 'Todos');
  rubro = signal<string>(this.prefs['rubro'] ?? 'Todos');
  orden = signal<string>(this.prefs['orden'] ?? 'pipeline');
  soloWa = signal<boolean>(!!this.prefs['soloWa']);
  vencidos = signal<boolean>(false);
  vista = signal<Vista>(this.prefs['vista'] ?? 'tarjetas');
  busqueda = signal('');

  talleres = signal<Taller[]>([]);
  stats = signal<Stats | null>(null);
  presets = signal<Presets | null>(null);
  cargando = signal(true);

  ficha = signal<number | null>(null);
  rastreo = signal(false);
  nuevo = signal(false);
  herramienta = signal<Herramienta>(null);

  hayFiltros = computed(() => this.estado() !== 'Todos' || this.comuna() !== 'Todos' || this.rubro() !== 'Todos' ||
    this.soloWa() || this.vencidos() || !!this.busqueda());

  columnas = computed(() => COLUMNAS.map((c) => ({ ...c, items: this.talleres().filter((t) => t.estado === c.estado) })));

  kpis = computed(() => {
    const s = this.stats()!;
    const e = s.por_estado;
    return [
      { t: 'Total', v: s.total, color: 'text-slate-900', accion: () => this.cambiar('estado', 'Todos') },
      { t: 'Por visitar', v: e['Por consultar'] ?? 0, color: 'text-blue-700', accion: () => this.cambiar('estado', 'Por consultar') },
      { t: 'Contactados', v: e['Contactado'] ?? 0, color: 'text-amber-700', accion: () => this.cambiar('estado', 'Contactado') },
      { t: 'En prueba', v: e['En prueba 14 días'] ?? 0, color: 'text-purple-700', accion: () => this.cambiar('estado', 'En prueba 14 días') },
      { t: 'Clientes', v: e['Cliente Activo'] ?? 0, color: 'text-emerald-700', accion: () => this.cambiar('estado', 'Cliente Activo') },
      { t: 'Con WhatsApp', v: s.con_whatsapp, color: 'text-slate-900', accion: () => this.cambiar('soloWa', true) },
      { t: 'Seguim. vencidos', v: s.seguimientos_vencidos, color: 'text-red-700', accion: () => this.cambiar('vencidos', true) },
    ];
  });

  private timerBusqueda?: ReturnType<typeof setTimeout>;

  async ngOnInit() {
    this.api.presets().then((p) => this.presets.set(p)).catch(() => {});
    await this.recargar();
  }

  async recargar() {
    try {
      const [s, t] = await Promise.all([this.api.stats(), this.api.talleres(this.filtros())]);
      this.stats.set(s);
      this.talleres.set(t);
    } catch (e) {
      this.sesion.avisar(mensajeError(e), false);
    } finally {
      this.cargando.set(false);
    }
  }

  private filtros(): Record<string, string | boolean> {
    const o = this.orden();
    return {
      estado: this.estado(), comuna: this.comuna(), rubro: this.rubro(), search: this.busqueda(),
      solo_whatsapp: this.soloWa(), vencidos: this.vencidos(),
      order_by: o === 'pipeline' ? '' : o === 'fecha_creacion_asc' ? 'fecha_creacion' : o,
      order_dir: o === 'fecha_creacion_asc' ? 'asc' : '',
    };
  }

  cambiar(clave: 'estado' | 'comuna' | 'rubro' | 'orden' | 'soloWa' | 'vencidos', valor: any) {
    (this as any)[clave].set(valor);
    if (clave !== 'vencidos') guardarPrefs({ [clave]: valor });
    this.recargar();
  }

  cambiarVista(v: Vista) { this.vista.set(v); guardarPrefs({ vista: v }); }

  buscar(texto: string) {
    this.busqueda.set(texto);
    clearTimeout(this.timerBusqueda);
    this.timerBusqueda = setTimeout(() => this.recargar(), 300);
  }

  limpiar() {
    this.estado.set('Todos'); this.comuna.set('Todos'); this.rubro.set('Todos');
    this.soloWa.set(false); this.vencidos.set(false); this.busqueda.set('');
    guardarPrefs({ estado: 'Todos', comuna: 'Todos', rubro: 'Todos', soloWa: false });
    this.recargar();
  }

  async cambiarEstado(t: Taller, estado: Estado) {
    try {
      await this.api.actualizarTaller(t.id, { estado });
      this.sesion.avisar(`${t.nombre}: ${estado}`);
      this.recargar();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async notaRapida(t: Taller, texto: string) {
    if (texto === t.observaciones) return;
    try { await this.api.actualizarTaller(t.id, { observaciones: texto }); this.sesion.avisar('Nota guardada'); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  color = (e: string) => COLOR_ESTADO[e] ?? '';
  prueba = (t: Taller) => (t.estado === 'En prueba 14 días' ? infoPrueba(t.fecha_inicio_prueba) : null);
  seg = (t: Taller) => seguimiento(t);
  conWa = (t: Taller) => tieneWa(t);
  waDefecto = (t: Taller) => waPorDefecto(t, this.presets());
  plantilla = (t: Taller, k: string) => linkPlantilla(t, this.presets(), k);
}
