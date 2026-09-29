import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { Ajustes, ConfigGeneral } from '../core/ajustes';
import { Presets } from '../core/modelos';

@Component({
  selector: 'app-configuracion',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 p-4"><p class="titulo-seccion">Configuración</p><h1 class="text-xl font-bold">Ajustes del CRM</h1></section>

    <div class="grid gap-3 lg:grid-cols-2">
      <!-- Este dispositivo -->
      <div class="space-y-3">
        <section class="tarjeta space-y-3 p-4">
          <div><p class="font-bold">PIN de inicio</p><p class="text-xs text-slate-500">Pide un PIN al abrir la app en este dispositivo y al volver después de un rato. Se guarda solo aquí.</p></div>
          @if (tienePin()) {
            <p class="text-sm text-emerald-700">✓ PIN activo</p>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <label>Bloquear tras</label>
              <select class="campo !w-auto" [ngModel]="ajustes.dispositivo().bloqueoMin" (ngModelChange)="ajustes.setBloqueoMin(+$event)">
                @for (m of [1, 2, 5, 10, 15, 30, 60]; track m) { <option [value]="m">{{ m }} min</option> }
              </select>
              <label>en segundo plano</label>
            </div>
            <div class="flex gap-2"><button class="btn" (click)="cambiando.set(true)">Cambiar PIN</button><button class="btn !text-red-700" (click)="quitar()">Quitar PIN</button></div>
          }
          @if (!tienePin() || cambiando()) {
            <div class="grid grid-cols-2 gap-2">
              <input class="campo text-center font-mono tracking-[.5em]" type="password" inputmode="numeric" maxlength="6" placeholder="PIN" [(ngModel)]="pin1" />
              <input class="campo text-center font-mono tracking-[.5em]" type="password" inputmode="numeric" maxlength="6" placeholder="Repetir" [(ngModel)]="pin2" />
            </div>
            <button class="btn-primario btn" (click)="fijar()">{{ tienePin() ? 'Guardar nuevo PIN' : 'Activar PIN' }}</button>
            <p class="text-[11px] text-slate-500">4 a 6 números. Si lo olvidas, borra los datos del sitio en el navegador: vuelves a entrar con tu Google.</p>
          }
        </section>

        <section class="tarjeta space-y-2 p-4">
          <p class="font-bold">WhatsApp</p>
          <label class="flex items-center gap-2 text-sm"><input type="radio" name="wa" [checked]="!ajustes.dispositivo().waBusiness" (change)="ajustes.setWaBusiness(false)" /> WhatsApp normal</label>
          <label class="flex items-center gap-2 text-sm"><input type="radio" name="wa" [checked]="ajustes.dispositivo().waBusiness" (change)="ajustes.setWaBusiness(true)" /> WhatsApp Business</label>
          <p class="text-[11px] text-slate-500">En Android los botones abren directo la app elegida. En PC e iPhone se abre el WhatsApp que tengas instalado (el sistema no deja elegir).</p>
        </section>
      </div>

      <!-- General (admin) -->
      @if (admin()) {
        @if (c(); as c) {
          <div class="space-y-3">
            <section class="tarjeta space-y-2 p-4">
              <p class="font-bold">Mensajes</p>
              <div><label class="etiqueta">Firma («Hola…, soy ___»)</label><input class="campo" [(ngModel)]="c.firma" /></div>
              <p class="titulo-seccion pt-2">Plantillas de WhatsApp <span class="normal-case">— usa {{ '{' }}nombre{{ '}' }} para el nombre del taller</span></p>
              @for (k of claves(); track k) {
                <div class="space-y-1 rounded border border-borde p-2">
                  <div class="flex gap-2"><input class="campo text-xs font-bold" [(ngModel)]="c.plantillas[k].titulo" /><button class="btn !text-red-700" (click)="quitarPlantilla(k)">✕</button></div>
                  <textarea rows="3" class="campo text-xs" [(ngModel)]="c.plantillas[k].mensaje"></textarea>
                </div>
              }
              <button class="btn" (click)="agregarPlantilla()">＋ Plantilla</button>
            </section>

            <section class="tarjeta space-y-2 p-4">
              <p class="font-bold">Rastreo (valores por defecto)</p>
              <div class="grid grid-cols-2 gap-2">
                <div><label class="etiqueta">Zona</label>
                  <select class="campo" [(ngModel)]="c.rastreo.zona">@for (z of zonas(); track z.k) { <option [value]="z.k">{{ z.nombre }}</option> }</select></div>
                <div><label class="etiqueta">Máx. por búsqueda</label><input type="number" min="1" max="60" class="campo" [(ngModel)]="c.rastreo.maximo" /></div>
              </div>
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" [(ngModel)]="c.rastreo.evaluarIa" /> Priorizar los nuevos con IA</label>
            </section>

            <section class="tarjeta space-y-2 p-4">
              <p class="font-bold">Salud de las cuentas (pestaña Hoy)</p>
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div><label class="etiqueta">En prueba: en riesgo tras (días sin entrar)</label><input type="number" min="1" class="campo" [(ngModel)]="c.salud.diasSinUsoPrueba" /></div>
                <div><label class="etiqueta">Pagando: en riesgo tras (días sin entrar)</label><input type="number" min="1" class="campo" [(ngModel)]="c.salud.diasSinUsoPago" /></div>
                <div><label class="etiqueta">Avisar renovación (días antes)</label><input type="number" min="1" class="campo" [(ngModel)]="c.salud.diasAvisoRenovar" /></div>
                <div><label class="etiqueta">Prueba por vencer desde el día</label><input type="number" min="1" max="14" class="campo" [(ngModel)]="c.salud.diasPruebaPorVencer" /></div>
              </div>
            </section>

            <button class="btn-primario btn w-full !py-2.5" [disabled]="guardando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar ajustes generales' }}</button>
          </div>
        }
      }
    </div>
  `,
})
export class Configuracion implements OnInit {
  protected ajustes = inject(Ajustes);
  private api = inject(Api);
  private sesion = inject(Sesion);
  c = signal<ConfigGeneral | null>(null);
  presets = signal<Presets | null>(null);
  cambiando = signal(false);
  guardando = signal(false);
  pin1 = '';
  pin2 = '';

  tienePin = computed(() => !!this.ajustes.dispositivo().pinHash);
  admin = computed(() => this.sesion.salud()?.admin !== false);
  claves = computed(() => Object.keys(this.c()?.plantillas ?? {}));
  zonas = computed(() => Object.entries(this.presets()?.zonas ?? {}).map(([k, z]) => ({ k, nombre: z.nombre })));

  async ngOnInit() {
    await this.ajustes.cargarGeneral();
    const g = this.ajustes.general();
    if (g) this.c.set(structuredClone(g));
    this.api.presets().then((p) => this.presets.set(p)).catch(() => {});
  }

  async fijar() {
    if (!/^\d{4,6}$/.test(this.pin1)) { this.sesion.avisar('El PIN debe tener 4 a 6 números', false); return; }
    if (this.pin1 !== this.pin2) { this.sesion.avisar('Los PIN no coinciden', false); return; }
    await this.ajustes.fijarPin(this.pin1);
    this.pin1 = this.pin2 = '';
    this.cambiando.set(false);
    this.sesion.avisar('PIN activado en este dispositivo');
  }

  quitar() {
    if (!confirm('¿Quitar el PIN de este dispositivo?')) return;
    this.ajustes.quitarPin();
    this.sesion.avisar('PIN quitado');
  }

  agregarPlantilla() {
    this.c.update((c) => c && ({ ...c, plantillas: { ...c.plantillas, [`propia_${Date.now()}`]: { titulo: 'Nueva plantilla', mensaje: 'Hola! ' } } }));
  }

  quitarPlantilla(k: string) {
    this.c.update((c) => { if (!c) return c; const p = { ...c.plantillas }; delete p[k]; return { ...c, plantillas: p }; });
  }

  async guardar() {
    this.guardando.set(true);
    try {
      await this.ajustes.guardarGeneral(this.c()!);
      this.c.set(structuredClone(this.ajustes.general()!));
      this.sesion.avisar('Ajustes guardados');
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.guardando.set(false); }
  }
}
