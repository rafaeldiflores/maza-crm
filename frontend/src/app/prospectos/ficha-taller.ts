import { WaPipe } from '../compartido/wa.pipe';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { DetalleTaller, ETAPAS, Estado, Presets } from '../core/modelos';
import { infoPrueba, linkPlantilla, linkWa, tieneWa, waPorDefecto } from '../core/utiles';
import { Modal } from '../compartido/modal';

const CHIPS = [
  ['📝 Usa libreta', 'Usa libreta o cuaderno para órdenes'],
  ['💬 WhatsApp colapsado', 'Desorden en WhatsApp con clientes'],
  ['🚗 Autos parados', 'Clientes no retiran a tiempo los vehículos'],
  ['✨ Le gustó demo móvil', 'Le encantó la demo en el celular'],
  ['⏳ Poco tiempo hoy', 'Poco tiempo / Volver el viernes'],
];

type PestanaFicha = 'resumen' | 'visita' | 'historial';

/**
 * Ficha del taller organizada en pestañas: Resumen & Contacto, Registro de Visita con Grabadora,
 * e Historial cronológico con informes de IA.
 */
@Component({
  selector: 'app-ficha-taller',
  imports: [FormsModule, Modal, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal ancho="46rem" (cerrar)="salir()">
      <div encabezado>
        @if (d(); as d) {
          @let t = d.taller;
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="insignia border-marca-200 bg-marca-50 text-marca-700">{{ t.rubro }}</span>
            <span class="insignia border-borde bg-white">{{ t.comuna }}</span>
            @if (t.prioridad === 'Alta') {
              <span class="insignia border-red-200 bg-red-50 text-red-700 font-bold">Alta Prioridad</span>
            }
          </div>
          <h2 class="mt-1 text-lg font-bold">{{ t.nombre }}</h2>
          <p class="text-xs text-slate-500">{{ t.direccion || 'Sin dirección' }}</p>
        }
      </div>

      @if (d(); as d) {
        @let t = d.taller;

        <!-- Barra de navegación por pestañas -->
        <div class="-mx-4 -mt-4 mb-4 flex border-b border-borde bg-fondo px-4 sm:-mx-5 sm:px-5">
          <button type="button" (click)="pestana.set('resumen')"
                  class="flex items-center gap-1.5 border-b-2 py-2.5 px-3.5 text-xs font-bold transition-colors"
                  [class]="pestana() === 'resumen' ? 'border-marca-800 text-marca-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'">
            <span>📋</span> Resumen y Contacto
          </button>
          <button type="button" (click)="pestana.set('visita')"
                  class="flex items-center gap-1.5 border-b-2 py-2.5 px-3.5 text-xs font-bold transition-colors"
                  [class]="pestana() === 'visita' ? 'border-marca-800 text-marca-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'">
            <span>🎙️</span> Registrar Visita
            @if (grabando()) { <span class="h-2 w-2 rounded-full bg-red-500 animate-ping"></span> }
          </button>
          <button type="button" (click)="pestana.set('historial')"
                  class="flex items-center gap-1.5 border-b-2 py-2.5 px-3.5 text-xs font-bold transition-colors"
                  [class]="pestana() === 'historial' ? 'border-marca-800 text-marca-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'">
            <span>📜</span> Historial
            <span class="insignia border-borde bg-slate-100 text-[10px]">{{ d.reuniones.length }}</span>
          </button>
        </div>

        <!-- Pestaña 1: Resumen y Contacto -->
        @if (pestana() === 'resumen') {
          <div class="space-y-4">
            <!-- Etapas del embudo -->
            <div>
              <p class="titulo-seccion mb-1.5">Etapa del embudo</p>
              <div class="etapas">
                @for (e of etapas; track e; let i = $index) {
                  <button type="button" [class.hecha]="i < indiceEtapa()" [class.actual]="e === t.estado" (click)="cambiarEstado(e)">{{ i < indiceEtapa() ? '✓ ' : '' }}{{ e }}</button>
                }
                <button type="button" class="!min-w-20" [class.actual]="t.estado === 'Descartado'" [class.descartado]="t.estado === 'Descartado'" (click)="cambiarEstado('Descartado')">Descartado</button>
              </div>
            </div>

            <!-- Evaluación con IA -->
            @if (t.puntaje_ia != null) {
              <div class="space-y-1 rounded-lg border border-marca-200 bg-marca-50 p-3 text-xs">
                <p><b>🎯 {{ t.puntaje_ia }}/100</b> · {{ t.ia_calza ? 'Calza con MAZA' : 'No calza' }}{{ t.ia_multirubro ? ' · multirubro' : '' }} — {{ t.ia_motivo }}</p>
                @if (t.ia_dolores.length) { <p>Dolores: {{ t.ia_dolores.join(' · ') }}</p> }
                @if (t.ia_mensaje) { <p class="italic text-slate-600">«{{ t.ia_mensaje }}»</p> }
                <div class="flex flex-wrap gap-2 pt-1">
                  @if (waIa(); as w) { <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">Enviar este WhatsApp</a> }
                  <button class="btn" [disabled]="evaluando()" (click)="evaluar()">{{ evaluando() ? 'Evaluando…' : 'Reevaluar' }}</button>
                </div>
              </div>
            } @else if (t.place_id) {
              <button class="btn" [disabled]="evaluando()" (click)="evaluar()">{{ evaluando() ? 'Leyendo reseñas y evaluando…' : '🎯 Evaluar con IA' }}</button>
            }

            <!-- Contacto -->
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-borde bg-fondo p-3">
              <span class="text-sm">Contacto:
                @if (t.telefono && t.telefono !== 'No especificado') {
                  <a [href]="'tel:' + t.telefono" class="font-mono font-bold hover:underline">{{ t.telefono }}</a>
                } @else {
                  <b class="font-mono text-slate-400">No especificado</b>
                }
              </span>
              <div class="flex flex-wrap gap-2">
                @if (conWa()) {
                  <a class="btn-wa btn" target="_blank" rel="noopener" [href]="waDefecto() | wa">Abrir WhatsApp</a>
                  <select class="btn" [ngModel]="''" (ngModelChange)="abrirPlantilla($event)">
                    <option value="">Plantillas…</option>
                    @for (p of plantillas(); track p.k) { <option [value]="p.k">{{ p.titulo }}</option> }
                  </select>
                }
                @if (t.maps_url) { <a class="btn" target="_blank" rel="noopener" [href]="t.maps_url">Ver en Maps</a> }
              </div>
            </div>

            <!-- Correo y beta tester -->
            <div class="flex flex-wrap items-end gap-2 rounded-lg border border-borde p-3">
              <div class="min-w-[220px] flex-1">
                <label class="etiqueta">Correo (Gmail para la prueba de Play)</label>
                <input type="email" class="campo" placeholder="dueño@gmail.com" [(ngModel)]="correo" (blur)="guardarCorreo()" />
              </div>
              <label class="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" [checked]="t.beta_tester" (change)="marcarBeta($any($event.target).checked)" /> Beta tester
              </label>
            </div>

            <!-- Checklist de la prueba -->
            @if ((t.estado === 'En prueba 14 días' || t.estado === 'Cliente Activo') && d.onboarding.length) {
              <div class="space-y-2 rounded-lg border border-purple-200 bg-purple-50/50 p-3">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-bold">Onboarding de la prueba</p>
                  @if (prueba(); as p) { <span class="insignia" [class]="p.color">{{ p.vencida ? 'Prueba vencida' : 'Día ' + p.dia + '/14' }}</span> }
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-purple-100"><div class="h-full bg-purple-500" [style.width.%]="avance()"></div></div>
                @for (p of d.onboarding; track p.key) {
                  <label class="flex items-start gap-2 text-xs">
                    <input type="checkbox" class="mt-0.5" [checked]="p.completado" (change)="marcarPaso(p.key, $any($event.target).checked)" />
                    <span [class.line-through]="p.completado" [class.text-slate-400]="p.completado">{{ p.label }} <span class="text-slate-400">(día {{ p.dia_sugerido }})</span></span>
                  </label>
                }
              </div>
            }

            <div class="pt-2">
              <button class="btn-primario btn w-full !py-2.5" (click)="pestana.set('visita')">
                🎙️ Ir a registrar visita / reunión
              </button>
            </div>
          </div>
        }

        <!-- Pestaña 2: Registrar Visita -->
        @if (pestana() === 'visita') {
          <div class="space-y-4">
            <!-- Grabadora -->
            <div class="space-y-3 rounded-lg bg-marca-800 p-4 text-white">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-bold">Grabadora de visita</p>
                  <p class="text-[11px] opacity-70">Graba la charla o un resumen hablado al salir del taller</p>
                </div>
                <span class="rounded bg-white/10 px-2.5 py-1 font-mono text-xs font-bold">{{ reloj() }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                @if (!grabando()) {
                  <button class="btn-peligro btn" (click)="grabar()">● Comenzar grabación</button>
                } @else {
                  <button class="btn" (click)="detener()">■ Detener grabación</button>
                  <span class="flex h-4 items-center gap-0.5">@for (b of [0, 1, 2, 3, 4]; track b) { <span class="onda w-1 rounded-full bg-red-300" [style.animation-delay.s]="b * 0.15"></span> }</span>
                  <span class="text-xs opacity-90 font-medium">Grabando y transcribiendo en vivo…</span>
                }
              </div>
              @if (audioUrl(); as u) { <audio controls class="h-8 w-full" [src]="u"></audio> }
            </div>

            <!-- Formulario de la visita -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label class="etiqueta">Tipo de contacto</label>
                <select class="campo" [(ngModel)]="form.tipo"><option>Presencial en taller</option><option>WhatsApp</option><option>Llamada telefónica</option></select></div>
              <div><label class="etiqueta">Resultado</label>
                <select class="campo" [(ngModel)]="form.resultado">
                  <option value="Aceptó probar 14 días">🚀 Aceptó probar 14 días</option>
                  <option value="Interesado / Revisará demo">💡 Interesado / Revisará demo</option>
                  <option value="Volver a visitar">📅 Volver a visitar</option>
                  <option value="No le interesa">✕ No le interesa</option>
                </select></div>
              <div class="sm:col-span-2"><label class="etiqueta">Encargado / dueño</label>
                <input class="campo" placeholder="Ej: Don Pedro (dueño)" [(ngModel)]="form.encargado" /></div>
              <div><label class="etiqueta">Próximo contacto</label><input type="date" class="campo" [(ngModel)]="form.proximo" /></div>
              <div><label class="etiqueta">Prioridad</label>
                <select class="campo" [(ngModel)]="form.prioridad"><option>Alta</option><option>Media</option><option>Baja</option></select></div>
            </div>

            <div>
              <label class="etiqueta">Dolores detectados (clic para agregar a notas)</label>
              <div class="flex flex-wrap gap-1.5">
                @for (c of chips; track c[0]) {
                  <button class="rounded border border-borde bg-fondo px-2 py-1 text-[11px] hover:bg-slate-200 transition-colors" (click)="agregarChip(c[1])">{{ c[0] }}</button>
                }
              </div>
            </div>

            <div><label class="etiqueta">Transcripción de voz (automática al grabar)</label>
              <textarea rows="2" class="campo font-mono text-xs" placeholder="El texto dictado aparecerá aquí…" [(ngModel)]="form.transcripcion"></textarea></div>

            <div><label class="etiqueta">Notas y acuerdos</label>
              <textarea rows="3" class="campo" placeholder="Escribe detalles de la visita, objeciones o acuerdos pactados…" [(ngModel)]="form.notas"></textarea></div>

            <button class="btn-primario btn w-full !py-2.5 !text-sm font-bold" [disabled]="guardando()" (click)="guardar()">
              @if (guardando()) {
                <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2"></span>
                <span>Guardando visita…</span>
              } @else {
                <span>Guardar visita</span>
              }
            </button>
          </div>
        }

        <!-- Pestaña 3: Historial -->
        @if (pestana() === 'historial') {
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <p class="titulo-seccion">Visitas registradas ({{ d.reuniones.length }})</p>
              <button class="btn !py-1 text-xs" (click)="pestana.set('visita')">＋ Nueva visita</button>
            </div>

            @for (r of d.reuniones; track r.id) {
              <div class="space-y-2 rounded-lg border border-borde bg-fondo p-3 text-xs">
                <div class="flex items-center justify-between gap-2 border-b border-borde pb-2">
                  <span class="font-bold text-slate-800">{{ r.tipo }} · {{ r.fecha }}</span>
                  <span class="insignia border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">{{ r.resultado }}</span>
                </div>
                @if (r.notas) { <p class="rounded bg-white p-2 text-slate-700"><b>Notas:</b> {{ r.notas }}</p> }
                @if (r.archivo_audio) { <audio controls class="h-8 w-full" [src]="r.archivo_audio"></audio> }
                @if (r.resumen_ia) {
                  <div class="rounded border border-marca-200 bg-marca-50 p-2.5 space-y-1">
                    <p class="font-bold text-marca-800 flex items-center gap-1"><span>✨</span> Análisis generado por IA:</p>
                    <p class="whitespace-pre-line text-slate-700">{{ r.resumen_ia }}</p>
                  </div>
                } @else if (r.notas || r.transcripcion) {
                  <div class="pt-1">
                    <button class="btn !py-1 text-[11px]" [disabled]="generandoIa() === r.id" (click)="generarInforme(r)">
                      {{ generandoIa() === r.id ? 'Generando análisis…' : '✨ Generar análisis IA opcional' }}
                    </button>
                  </div>
                }
              </div>
            } @empty {
              <div class="tarjeta p-8 text-center space-y-2">
                <p class="text-sm font-bold text-slate-700">Sin visitas registradas todavía</p>
                <p class="text-xs text-slate-500">Registra una visita para guardar acuerdos y generar informes con IA.</p>
                <button class="btn-primario btn mt-2" (click)="pestana.set('visita')">🎙️ Registrar primera visita</button>
              </div>
            }
          </div>
        }
      } @else {
        <div class="space-y-4 animate-pulse py-2">
          <div class="h-8 rounded bg-slate-200"></div>
          <div class="h-24 rounded-lg bg-slate-100"></div>
          <div class="h-16 rounded-lg bg-slate-100"></div>
          <div class="grid grid-cols-2 gap-2">
            <div class="h-10 rounded bg-slate-100"></div>
            <div class="h-10 rounded bg-slate-100"></div>
          </div>
        </div>
      }
    </app-modal>
  `,
})
export class FichaTaller implements OnInit, OnDestroy {
  private api = inject(Api);
  private sesion = inject(Sesion);
  id = input.required<number>();
  presets = input<Presets | null>(null);
  cerrar = output<void>();
  cambio = output<void>();

  readonly etapas = ETAPAS;
  readonly chips = CHIPS;
  pestana = signal<PestanaFicha>('resumen');
  d = signal<DetalleTaller | null>(null);
  evaluando = signal(false);
  guardando = signal(false);
  generandoIa = signal<number | null>(null);
  grabando = signal(false);
  segundos = signal(0);
  audioUrl = signal<string | null>(null);
  form = { tipo: 'Presencial en taller', resultado: 'Aceptó probar 14 días', encargado: '', proximo: '', prioridad: 'Media', transcripcion: '', notas: '' };

  private grabadora?: MediaRecorder;
  private trozos: Blob[] = [];
  private audio: Blob | null = null;
  private reconocimiento: any;
  private intervalo?: ReturnType<typeof setInterval>;
  private cambioPendiente = false;
  correo = '';

  indiceEtapa = computed(() => ETAPAS.indexOf(this.d()?.taller.estado as Estado));
  prueba = computed(() => infoPrueba(this.d()?.taller.fecha_inicio_prueba));
  avance = computed(() => { const o = this.d()?.onboarding ?? []; return o.length ? Math.round(o.filter((p) => p.completado).length / o.length * 100) : 0; });
  conWa = computed(() => !!this.d() && tieneWa(this.d()!.taller));
  waDefecto = computed(() => this.d() ? waPorDefecto(this.d()!.taller, this.presets()) : null);
  waIa = computed(() => { const t = this.d()?.taller; return t && tieneWa(t) && t.ia_mensaje ? linkWa(t.whatsapp_link, t.ia_mensaje) : null; });
  plantillas = computed(() => Object.entries(this.presets()?.whatsapp_templates ?? {}).map(([k, v]) => ({ k, titulo: v.titulo })));
  reloj = computed(() => `${String(Math.floor(this.segundos() / 60)).padStart(2, '0')}:${String(this.segundos() % 60).padStart(2, '0')}`);

  async ngOnInit() { await this.cargar(); }
  ngOnDestroy() { this.detener(); }

  async cargar() {
    try {
      const d = await this.api.taller(this.id());
      this.d.set(d);
      this.form.encargado = d.taller.encargado_nombre || '';
      this.correo = d.taller.email || '';
      this.form.prioridad = d.taller.prioridad || 'Media';
      this.form.proximo = (d.taller.proximo_contacto || '').slice(0, 10);
    } catch (e) { this.sesion.avisar(mensajeError(e), false); this.cerrar.emit(); }
  }

  salir() {
    this.detener();
    if (this.cambioPendiente) this.cambio.emit();
    this.cerrar.emit();
  }

  async cambiarEstado(estado: Estado) {
    if (estado === this.d()?.taller.estado) return;
    try { await this.api.actualizarTaller(this.id(), { estado }); this.cambioPendiente = true; await this.cargar(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async evaluar() {
    this.evaluando.set(true);
    try { await this.api.evaluarIa(this.id()); this.cambioPendiente = true; await this.cargar(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.evaluando.set(false); }
  }

  async guardarCorreo() {
    const email = this.correo.trim().toLowerCase();
    if (email === (this.d()?.taller.email || '')) return;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.sesion.avisar('Correo inválido', false); return; }
    try { await this.api.actualizarTaller(this.id(), { email }); this.cambioPendiente = true; this.sesion.avisar('Correo guardado'); await this.cargar(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async marcarBeta(on: boolean) {
    if (on && !this.correo.trim()) { this.sesion.avisar('Primero ingresa el correo', false); await this.cargar(); return; }
    await this.guardarCorreo();
    try { await this.api.actualizarTaller(this.id(), { beta_tester: on }); this.cambioPendiente = true; await this.cargar(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  abrirPlantilla(k: string) {
    const url = k && this.d() ? linkPlantilla(this.d()!.taller, this.presets(), k) : null;
    if (url) window.open(url, '_blank', 'noopener');
  }

  async marcarPaso(key: string, completado: boolean) {
    try { await this.api.pasoOnboarding(this.id(), key, completado); await this.cargar(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  agregarChip(texto: string) { this.form.notas = this.form.notas.trim() ? `${this.form.notas.trim()} · ${texto}` : texto; }

  async grabar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.trozos = [];
      this.audio = null;
      this.audioUrl.set(null);
      this.grabadora = new MediaRecorder(stream);
      this.grabadora.ondataavailable = (e) => { if (e.data.size) this.trozos.push(e.data); };
      this.grabadora.onstop = () => {
        this.audio = new Blob(this.trozos, { type: 'audio/webm' });
        this.audioUrl.set(URL.createObjectURL(this.audio));
      };
      this.grabadora.start();
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        this.reconocimiento = new SR();
        this.reconocimiento.lang = 'es-CL';
        this.reconocimiento.continuous = true;
        this.reconocimiento.onresult = (ev: any) => {
          let texto = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) texto += ev.results[i][0].transcript;
          if (texto) this.form.transcripcion = `${this.form.transcripcion} ${texto}`.trim();
        };
        try { this.reconocimiento.start(); } catch { /* ya iniciado */ }
      }
      this.segundos.set(0);
      this.intervalo = setInterval(() => this.segundos.update((s) => s + 1), 1000);
      this.grabando.set(true);
    } catch {
      this.sesion.avisar('Permite el acceso al micrófono para grabar.', false);
    }
  }

  detener() {
    if (this.grabadora && this.grabadora.state !== 'inactive') {
      this.grabadora.stop();
      this.grabadora.stream.getTracks().forEach((t) => t.stop());
    }
    try { this.reconocimiento?.stop(); } catch { /* nada */ }
    clearInterval(this.intervalo);
    this.grabando.set(false);
  }

  async guardar() {
    this.detener();
    const f = new FormData();
    f.append('taller_id', String(this.id()));
    f.append('tipo', this.form.tipo);
    f.append('resultado', this.form.resultado);
    f.append('notas', this.form.notas);
    f.append('transcripcion', this.form.transcripcion);
    f.append('duracion_segundos', String(this.segundos()));
    f.append('encargado_nombre', this.form.encargado);
    f.append('proximo_contacto', this.form.proximo);
    f.append('prioridad', this.form.prioridad);
    if (this.audio) f.append('audio_file', this.audio, 'reunion.webm');
    this.guardando.set(true);
    try {
      await this.api.guardarReunion(f);
      this.sesion.avisar('Visita guardada');
      this.cambioPendiente = true;
      this.salir();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.guardando.set(false); }
  }

  async generarInforme(r: any) {
    this.generandoIa.set(r.id);
    try {
      const resp = await this.api.generarInformeReunion(r.id);
      r.resumen_ia = resp.resumen;
      this.sesion.avisar('Análisis IA generado');
      this.cambioPendiente = true;
    } catch (e) {
      this.sesion.avisar(mensajeError(e), false);
    } finally {
      this.generandoIa.set(null);
    }
  }
}
