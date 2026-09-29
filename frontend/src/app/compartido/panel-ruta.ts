import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Presets } from '../core/modelos';
import { RutaEnCurso } from '../core/ruta-en-curso';
import { FichaTaller } from '../prospectos/ficha-taller';

/** Barra flotante de la ruta en curso + checklist de paradas + aviso de cercanía. */
@Component({
  selector: 'app-panel-ruta',
  imports: [FichaTaller],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (r.ruta(); as ruta) {
      @if (r.cerca(); as c) {
        <div class="fixed inset-x-2 top-24 z-[55] mx-auto max-w-md rounded-lg bg-emerald-700 p-3 text-white shadow-xl">
          <p class="text-sm">📍 Estás en <b>{{ c.nombre }}</b></p>
          <div class="mt-2 flex gap-2">
            <button class="btn" (click)="r.marcar(c, 'visitado')">Marcar visitado</button>
            <button class="btn" (click)="abrirFicha(c.id)">Ficha</button>
            <button class="btn !bg-transparent !text-white" (click)="r.ignorarCerca()">Todavía no</button>
          </div>
        </div>
      }

      @if (!r.abierta()) {
        <button class="fixed bottom-4 right-4 z-[45] rounded-full bg-marca-800 px-4 py-3 text-sm font-bold text-white shadow-xl" (click)="r.abierta.set(true)">
          🧭 Ruta {{ r.hechas() }}/{{ ruta.paradas.length }}{{ r.sinSubir() ? ' ⚠️' : '' }}
        </button>
      } @else {
        <div class="fixed inset-x-0 bottom-0 z-[45] mx-auto max-h-[70vh] max-w-2xl overflow-y-auto rounded-t-xl border border-borde bg-white shadow-2xl">
          <div class="sticky top-0 flex items-center justify-between border-b border-borde bg-fondo px-4 py-2">
            <div><p class="text-sm font-bold">Ruta en curso · {{ r.hechas() }}/{{ ruta.paradas.length }}</p><p class="text-[11px] text-slate-500">{{ ruta.km }} km · {{ ruta.minutos }} min estimados{{ ruta.volver ? ' · con vuelta' : '' }}{{ r.sinSubir() ? ' · ⚠️ sin señal, se guarda al volver' : ' · ☁️ guardada' }}</p></div>
            <button class="rounded p-1.5 text-slate-500 hover:bg-slate-200" (click)="r.abierta.set(false)">▾</button>
          </div>
          <div class="divide-y divide-borde">
            @for (p of ruta.paradas; track p.id; let i = $index) {
              <div class="flex items-center gap-2 px-4 py-2" [class.opacity-50]="p.estado !== 'pendiente'">
                <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                      [class]="p.estado === 'visitado' ? 'bg-emerald-600 text-white' : p.estado === 'saltado' ? 'bg-slate-300' : 'bg-marca-800 text-white'">{{ p.estado === 'visitado' ? '✓' : i + 1 }}</span>
                <button type="button" class="min-w-0 flex-1 text-left" title="Abrir ficha" (click)="abrirFicha(p.id)"><p class="truncate text-sm font-semibold underline decoration-dotted underline-offset-2" [class.line-through]="p.estado === 'saltado'">{{ p.nombre }}</p><p class="truncate text-[11px] text-slate-500">{{ p.direccion }}, {{ p.comuna }}</p></button>
                @if (p.estado === 'pendiente') {
                  <button class="btn !px-2" title="Navegar a esta" (click)="r.abrirMaps(p)">🧭</button>
                  <button class="btn !px-2" title="Saltar" (click)="r.marcar(p, 'saltado')">⤼</button>
                  <button class="btn-wa btn !px-2" (click)="r.marcar(p, 'visitado')">✓ Visitado</button>
                } @else {
                  <button class="btn !px-2" title="Deshacer" (click)="r.deshacer(p)">↶ Deshacer</button>
                }
              </div>
            }
          </div>
          <div class="sticky bottom-0 flex flex-wrap gap-2 border-t border-borde bg-white p-3">
            <button class="btn" [disabled]="!r.pendientes().length" (click)="r.abrirMaps()">🗺️ Siguiente tramo</button>
            <button class="btn-primario btn flex-1" [disabled]="!r.pendientes().length || ocupado()" (click)="reoptimizar()">{{ ocupado() ? 'Calculando…' : 'Reoptimizar desde aquí' }}</button>
            <button class="btn !text-red-700" (click)="terminar()">Terminar ruta</button>
          </div>
        </div>
      }
    }
    @if (ficha(); as id) { <app-ficha-taller [id]="id" [presets]="presets()" (cerrar)="ficha.set(null)" /> }
  `,
})
export class PanelRuta {
  protected r = inject(RutaEnCurso);
  private api = inject(Api);
  ocupado = signal(false);
  ficha = signal<number | null>(null);
  presets = signal<Presets | null>(null);

  /** En terreno: abre la ficha del taller para anotar correo, encargado o la visita. */
  abrirFicha(id: number) {
    this.ficha.set(id);
    if (!this.presets()) this.api.presets().then((p) => this.presets.set(p)).catch(() => {});
  }
  async reoptimizar() { this.ocupado.set(true); await this.r.reoptimizar(); this.ocupado.set(false); }
  terminar() {
    const n = this.r.pendientes().length;
    if (n && !confirm(`Quedan ${n} paradas sin visitar: siguen como pendientes en el CRM. ¿Terminar la ruta?`)) return;
    this.r.terminar();
  }
}
