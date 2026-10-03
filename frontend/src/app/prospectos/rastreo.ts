import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { Presets } from '../core/modelos';
import { Modal } from '../compartido/modal';
import { Ajustes } from '../core/ajustes';

/** Rastreo con Places API: comunas × rubros, y los nuevos se priorizan con IA. */
@Component({
  selector: 'app-rastreo',
  imports: [FormsModule, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Rastrear talleres" subtitulo="Búsqueda en Google Places; los nuevos entran al CRM priorizados con IA" ancho="38rem" (cerrar)="cerrar.emit()">
      <div><label class="etiqueta">Zona</label>
        <select class="campo" [ngModel]="zona()" (ngModelChange)="elegirZona($event)">
          @for (z of zonas(); track z.k) { <option [value]="z.k">{{ z.nombre }}</option> }
          <option value="custom">Personalizado</option>
        </select></div>
      <div>
        <div class="flex justify-between"><label class="etiqueta">Comunas (separadas por coma)</label><span class="text-[11px] text-slate-500">{{ listaComunas().length }} comunas</span></div>
        <textarea rows="2" class="campo text-xs" [ngModel]="comunas()" (ngModelChange)="comunas.set($event)"></textarea>
      </div>
      <div>
        <label class="etiqueta">Rubros</label>
        <div class="grid grid-cols-2 gap-1.5 text-xs">
          @for (r of rubros(); track r.codigo) {
            <label class="flex items-center gap-2 rounded border border-borde p-2"><input type="checkbox" [checked]="elegidos().has(r.codigo)" (change)="alternar(r.codigo)" /> {{ r.nombre }}</label>
          }
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 text-xs">
        <label class="flex items-center gap-2">Máx. por búsqueda <input type="number" min="1" max="60" class="campo !w-16 text-center" [(ngModel)]="maximo" /></label>
        <label class="flex items-center gap-2" title="Lee las reseñas de cada taller nuevo y lo puntúa con Gemini (costo pequeño por taller)"><input type="checkbox" [(ngModel)]="evaluarIa" /> Priorizar los nuevos con IA</label>
      </div>
      @if (logs().length) {
        <div class="max-h-44 space-y-0.5 overflow-y-auto rounded bg-slate-950 p-3 font-mono text-[11px] text-emerald-400">
          @for (l of logs(); track $index) { <p>&gt; {{ l }}</p> }
        </div>
      }
      <div class="flex gap-2">
        <button class="btn-primario btn flex-1 !py-2.5" [disabled]="corriendo()" (click)="iniciar()">{{ corriendo() ? 'Buscando…' : 'Comenzar' }}</button>
        @if (corriendo()) { <button class="btn-peligro btn" (click)="detener()">Detener</button> }
      </div>
    </app-modal>
  `,
})
export class Rastreo implements OnInit, OnDestroy {
  private api = inject(Api);
  private sesion = inject(Sesion);
  private ajustes = inject(Ajustes);
  presets = input<Presets | null>(null);
  cerrar = output<void>();

  zona = signal('valpo_gran');
  comunas = signal('');
  elegidos = signal(new Set<string>());
  maximo = 20;
  evaluarIa = true;
  logs = signal<string[]>([]);
  corriendo = signal(false);
  private sondeo?: ReturnType<typeof setInterval>;

  zonas = computed(() => Object.entries(this.presets()?.zonas ?? {}).map(([k, z]) => ({ k, nombre: z.nombre })));
  rubros = computed(() => Object.values(this.presets()?.rubros ?? {}));
  listaComunas = computed(() => this.comunas().split(',').map((c) => c.trim()).filter(Boolean));

  ngOnInit() {
    const r = this.ajustes.general()?.rastreo;
    if (r) { this.zona.set(r.zona); this.maximo = r.maximo; this.evaluarIa = r.evaluarIa; }
    const z = this.presets()?.zonas?.[this.zona()] ? this.zona() : Object.keys(this.presets()?.zonas ?? {})[0];
    if (z) this.elegirZona(z);
    this.elegidos.set(new Set(this.rubros().map((r) => r.codigo)));
    this.consultar();
  }
  ngOnDestroy() { clearInterval(this.sondeo); }

  elegirZona(k: string) {
    this.zona.set(k);
    const z = this.presets()?.zonas?.[k];
    if (z) this.comunas.set(z.comunas.join(', '));
  }

  alternar(c: string) {
    const s = new Set(this.elegidos());
    s.has(c) ? s.delete(c) : s.add(c);
    this.elegidos.set(s);
  }

  async iniciar() {
    if (!this.listaComunas().length) { this.sesion.avisar('Escribe al menos una comuna', false); return; }
    try {
      await this.api.iniciarRastreo({ comunas: this.listaComunas(), rubros: [...this.elegidos()], max_per_query: this.maximo, evaluar_ia: this.evaluarIa });
      this.corriendo.set(true);
      this.sondeo = setInterval(() => this.consultar(), 2000);
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async detener() { try { await this.api.detenerRastreo(); } catch { /* ya terminó */ } }

  private async consultar() {
    try {
      const s = await this.api.estadoRastreo();
      this.logs.set(s.logs);
      this.corriendo.set(s.running);
      if (s.running && !this.sondeo) this.sondeo = setInterval(() => this.consultar(), 2000);
      if (!s.running) { clearInterval(this.sondeo); this.sondeo = undefined; }
    } catch { /* reintenta en el próximo ciclo */ }
  }
}
