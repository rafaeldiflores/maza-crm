// Consumo de IA por función y por cuenta. Lee lo que el Worker de MAZA suma en
// `usoIA` (registrarUsoIA en cloudflare-worker/worker.js), agrupado en el
// backend (maza_admin.consumo_ia). Unidades = cupo gastado; los tokens son lo
// que se paga. Gemini sin precio cargado: se ven sus tokens, no su costo.
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Api, mensajeError } from '../core/api';
import { NOMBRE_PLAN } from '../core/modelos';
import { fecha } from '../core/utiles';

interface Metricas {
  unidades: number; gemini: number; haiku: number; devueltas: number;
  geminiEntrada: number; geminiSalida: number; haikuEntrada: number; haikuSalida: number; embebidos: number;
}
interface FilaFuncion extends Metricas { funcion: string; nombre: string; haikuUsd: number; geminiUsd: number | null }
interface Persona { uid: string; email: string; esDueno: boolean; funciones: Record<string, Metricas> }
interface FilaTaller {
  tallerId: string; nombreTaller: string; modo: string; totales: Metricas; consultas: number; documentos: number;
  busquedas: number; dias: number; diasTopeChat: number; diasTopeDocumentos: number; haikuUsd: number; personas: Persona[];
}
interface Consumo {
  totales: Metricas & { consultas: number; documentos: number; busquedas: number; haikuUsd: number; geminiUsd: number | null };
  funciones: FilaFuncion[]; talleres: FilaTaller[]; porDia: { fecha: string; unidades: number }[];
  precioGeminiCargado: boolean; nombresFuncion: Record<string, string>; desde: string; dias: number;
}

const num = (n?: number | null) => Number(n || 0).toLocaleString('es-CL');
const usd = (n?: number | null) =>
  n == null ? '—' : 'US$ ' + Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const tokens = (t: Metricas) => `G ${num(t.geminiEntrada)}/${num(t.geminiSalida)} · H ${num(t.haikuEntrada)}/${num(t.haikuSalida)}`;

@Component({
  selector: 'app-consumo-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4">
      <p class="titulo-seccion">Consumo IA</p>
      <h1 class="text-xl font-bold">Qué gasta cada cuenta</h1>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        @for (d of periodos; track d) {
          <button class="btn" [class.btn-primario]="d === dias()" (click)="cargar(d)">{{ d }} días</button>
        }
        @if (c(); as c) { <span class="text-xs text-slate-500">Desde {{ f(c.desde) }} (UTC)</span> }
      </div>
    </section>

    @if (error(); as e) {
      <p class="tarjeta p-4 text-sm text-red-600">{{ e }}</p>
    } @else if (c(); as c) {
      <section class="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        @for (k of tarjetas(); track k[0]) {
          <div class="tarjeta p-3">
            <p class="text-[11px] font-bold uppercase text-slate-500">{{ k[0] }}</p>
            <p class="text-2xl font-extrabold">{{ k[1] }}</p>
            <p class="text-[11px] text-slate-500">{{ k[2] }}</p>
          </div>
        }
      </section>

      <div class="tarjeta mb-3 p-3">
        <p class="mb-2 text-sm font-bold">Consultas y documentos por día</p>
        @for (x of dias_(); track x.fecha) {
          <div class="flex items-center gap-2 py-0.5 text-xs">
            <span class="w-14 font-mono">{{ x.etiqueta }}</span>
            <div class="h-2 flex-1 rounded bg-fondo"><div class="h-2 rounded bg-marca-500" [style.width.%]="x.pct"></div></div>
            <span class="w-10 text-right">{{ x.unidades }}</span>
          </div>
        } @empty { <p class="text-xs text-slate-500">Sin uso en el período. ¿Ya está desplegado el Worker de MAZA con la medición?</p> }
      </div>

      <p class="titulo-seccion mb-2">Por función</p>
      <div class="tarjeta mb-4 overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-fondo text-left uppercase text-slate-500">
            <tr><th class="px-3 py-2">Función</th><th class="px-3 py-2 text-right">Unidades</th><th class="px-3 py-2 text-right">Gemini / Haiku</th><th class="px-3 py-2 text-right">Devueltas</th><th class="px-3 py-2 text-right">Tokens</th><th class="px-3 py-2 text-right">USD Haiku</th></tr>
          </thead>
          <tbody>
            @for (x of funciones(); track x.funcion) {
              <tr class="border-t border-borde">
                <td class="px-3 py-2 font-bold">{{ x.nombre }}</td><td class="px-3 py-2 text-right">{{ x.unidades }}</td>
                <td class="px-3 py-2 text-right">{{ x.respuestas }}</td><td class="px-3 py-2 text-right">{{ x.devueltas }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px]">{{ x.tokens }}</td><td class="px-3 py-2 text-right">{{ x.usd }}</td>
              </tr>
            } @empty { <tr><td colspan="6" class="px-3 py-8 text-center text-slate-500">Sin datos.</td></tr> }
          </tbody>
        </table>
      </div>

      <p class="titulo-seccion mb-1">Por cuenta</p>
      <p class="mb-2 text-xs text-slate-500">Toca una cuenta para ver a cada persona. «Al tope» = días en que alguien agotó el chat / el taller agotó los documentos.</p>
      <div class="space-y-2">
        @for (t of talleres(); track t.tallerId) {
          <article class="tarjeta p-3">
            <button class="w-full text-left" (click)="alternar(t.tallerId)">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="font-bold">{{ t.nombreTaller }} <span class="text-xs font-normal text-slate-500">· {{ t.plan }}</span></p>
                <p class="text-sm font-bold">{{ t.usd }}</p>
              </div>
              <p class="mt-1 text-xs text-slate-600">
                {{ t.consultas }} consultas · {{ t.documentos }} docs · {{ t.busquedas }} búsquedas · {{ t.dias }} días con uso
                @if (t.alTope) { · <span class="font-bold text-red-600">al tope {{ t.diasTopeChat }} / {{ t.diasTopeDocumentos }}</span> }
              </p>
              <p class="mt-0.5 font-mono text-[11px] text-slate-500">{{ t.tokens }}</p>
            </button>
            @if (abierto() === t.tallerId) {
              <div class="mt-2 border-t border-borde pt-2">
                @for (p of t.personas; track p.uid) {
                  <p class="py-0.5 text-xs"><span class="font-bold">{{ p.etiqueta }}</span> — {{ p.resumen }}</p>
                }
              </div>
            }
          </article>
        } @empty { <p class="tarjeta p-4 text-sm text-slate-500">Ninguna cuenta usó IA en el período.</p> }
      </div>
    } @else { <p class="py-10 text-center text-sm text-slate-500">Leyendo usoIA…</p> }
  `,
})
export class ConsumoIa implements OnInit {
  private api = inject(Api);
  readonly periodos = [7, 30, 90];
  dias = signal(30);
  c = signal<Consumo | null>(null);
  error = signal<string | null>(null);
  abierto = signal<string | null>(null);
  f = fecha;

  // Derivados precalculados: el template no llama funciones por fila.
  tarjetas = computed(() => {
    const t = this.c()?.totales;
    if (!t) return [];
    return [
      ['Consultas', num(t.consultas), 'asistente, chat y avisos'],
      ['Documentos', num(t.documentos), 'facturas y listas'],
      ['Búsquedas', num(t.busquedas), `${num(t.embebidos)} textos embebidos`],
      ['Costo Haiku', usd(t.haikuUsd), `${num(t.haiku)} respuestas de respaldo`],
      ['Tokens Gemini', num(t.geminiEntrada + t.geminiSalida), this.c()!.precioGeminiCargado ? usd(t.geminiUsd) : 'sin precio cargado'],
    ];
  });
  dias_ = computed(() => {
    const filas = this.c()?.porDia ?? [];
    const max = Math.max(1, ...filas.map((x) => x.unidades));
    return filas.map((x) => ({ ...x, etiqueta: x.fecha.slice(5), pct: (x.unidades / max) * 100 }));
  });
  funciones = computed(() =>
    (this.c()?.funciones ?? []).map((x) => ({
      ...x, respuestas: `${num(x.gemini)} / ${num(x.haiku)}`, tokens: tokens(x), usd: usd(x.haikuUsd),
    })),
  );
  talleres = computed(() => {
    const nombres = this.c()?.nombresFuncion ?? {};
    return (this.c()?.talleres ?? []).map((t) => ({
      ...t,
      plan: NOMBRE_PLAN[t.modo] || t.modo,
      usd: usd(t.haikuUsd),
      tokens: tokens(t.totales),
      alTope: t.diasTopeChat + t.diasTopeDocumentos > 0,
      personas: t.personas.map((p) => ({
        uid: p.uid,
        etiqueta: (p.email || p.uid) + (p.esDueno ? ' · dueño' : ''),
        resumen: Object.entries(p.funciones).map(([k, v]) => `${nombres[k] || k}: ${v.unidades}`).join(' · '),
      })),
    }));
  });

  ngOnInit() { void this.cargar(this.dias()); }

  async cargar(d: number) {
    this.dias.set(d);
    this.c.set(null);
    this.error.set(null);
    try { this.c.set(await this.api.consumoIA(d)); } catch (e) { this.error.set(mensajeError(e)); }
  }

  alternar(id: string) { this.abierto.set(this.abierto() === id ? null : id); }
}
