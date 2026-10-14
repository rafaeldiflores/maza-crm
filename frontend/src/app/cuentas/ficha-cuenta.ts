import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { DetalleCuenta, DetalleTaller, NOMBRE_PLAN, Taller } from '../core/modelos';
import { fecha, fechaHora, generarClave, linkWa, plata, telLink } from '../core/utiles';
import { Modal } from '../compartido/modal';
import { WaPipe } from '../compartido/wa.pipe';
import { COLOR_PLAN, textoUso } from './comun';

type PestanaCuenta = 'resumen' | 'plan' | 'seguridad';

const MONTOS_RAPIDOS = [
  { etiqueta: 'Solo Fundador ($12.495)', monto: 12495 },
  { etiqueta: 'Pro Fundador ($19.995)', monto: 19995 },
  { etiqueta: 'Empresa Fund. ($29.995)', monto: 29995 },
  { etiqueta: 'Solo Normal ($24.990)', monto: 24990 },
  { etiqueta: 'Pro Normal ($39.990)', monto: 39990 },
  { etiqueta: 'Empresa Normal ($59.990)', monto: 59990 },
];

/** Ficha de una cuenta de MAZA organizada en 3 pestañas: Resumen y CRM, Plan y Pagos, y Clave y Peligro. */
@Component({
  selector: 'app-ficha-cuenta',
  imports: [FormsModule, Modal, WaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal ancho="44rem" (cerrar)="intentarCerrar()">
      <div encabezado>
        @if (d(); as d) {
          @let c = d.cuenta;
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="insignia" [class]="colorPlan[c.modo]">{{ plan[c.modo] }}</span>
            @if (c.esFundador) {
              <span class="insignia border-amber-300 bg-amber-50 text-amber-800">★ Fundador #{{ c.numeroFundador || '?' }}</span>
            }
            @if (c.mpConnectHabilitado) {
              <span class="insignia border-sky-200 bg-sky-50 text-sky-700">MP Connect</span>
            }
            @if (c.tipoTaller) {
              <span class="insignia border-borde bg-white text-slate-600">{{ c.tipoTaller }}</span>
            }
            @if (c.ciudad) {
              <span class="insignia border-borde bg-white text-slate-600">📍 {{ c.ciudad }}</span>
            }
          </div>
          <h2 class="mt-1 text-lg font-bold text-slate-900">{{ c.nombreTaller || '(sin nombre)' }}</h2>
          <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <button type="button" class="hover:text-marca-600 hover:underline" (click)="copiar(c.email, 'Correo copiado')" title="Clic para copiar correo">
              {{ c.email }} 📋
            </button>
            <span>·</span>
            <button type="button" class="font-mono text-[10px] text-slate-400 hover:text-slate-700" (click)="copiar(c.uid, 'UID copiado')" title="Clic para copiar UID">
              UID: {{ c.uid }}
            </button>
          </div>
        }
      </div>

      @if (d(); as d) {
        @let c = d.cuenta;

        <!-- Barra de pestañas (consistente con FichaTaller) -->
        <div class="-mx-4 -mt-4 mb-4 flex overflow-x-auto border-b border-borde bg-fondo px-4 sm:-mx-5 sm:px-5">
          <button type="button" (click)="pestana.set('resumen')"
                  class="flex items-center gap-1.5 border-b-2 py-2.5 px-3.5 text-xs font-bold whitespace-nowrap transition-colors"
                  [class]="pestana() === 'resumen' ? 'border-marca-800 text-marca-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'">
            <span>📋</span> Resumen y CRM
          </button>
          <button type="button" (click)="pestana.set('plan')"
                  class="flex items-center gap-1.5 border-b-2 py-2.5 px-3.5 text-xs font-bold whitespace-nowrap transition-colors"
                  [class]="pestana() === 'plan' ? 'border-marca-800 text-marca-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'">
            <span>💳</span> Plan y Pagos
          </button>
          <button type="button" (click)="pestana.set('seguridad')"
                  class="flex items-center gap-1.5 border-b-2 py-2.5 px-3.5 text-xs font-bold whitespace-nowrap transition-colors"
                  [class]="pestana() === 'seguridad' ? 'border-marca-800 text-marca-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'">
            <span>🔐</span> Clave y Peligro
          </button>
        </div>

        <!-- PESTAÑA 1: RESUMEN Y CRM -->
        @if (pestana() === 'resumen') {
          <div class="space-y-4">
            <!-- Barra de contacto directo -->
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-borde bg-fondo p-3">
              <div class="text-xs space-y-0.5">
                <p class="font-semibold text-slate-700">
                  Teléfono:
                  @if (tel(c.telefono); as telUrl) {
                    <a [href]="telUrl" class="font-mono font-bold text-marca-600 hover:underline">{{ c.telefono }}</a>
                  } @else {
                    <span class="font-mono text-slate-400">No registrado</span>
                  }
                </p>
                <p class="text-slate-500">Último acceso: <b>{{ fh(d.ultimoAcceso) }}</b> · Alta: {{ f(c.creadoEn) }}</p>
              </div>
              <div class="flex flex-wrap gap-1.5">
                @if (wa(c); as w) {
                  <a class="btn-wa btn" target="_blank" rel="noopener" [href]="w | wa">💬 WhatsApp</a>
                }
                @if (tel(c.telefono); as telUrl) {
                  <a class="btn" [href]="telUrl">📞 Llamar</a>
                }
                <button class="btn-primario btn" (click)="pestana.set('plan')">💳 Gestionar plan / pago</button>
              </div>
            </div>

            <!-- Tarjetas de estado y uso -->
            <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <div class="rounded-lg border border-borde bg-white p-3 space-y-1">
                <p class="titulo-seccion">Plan y vigencia</p>
                <div class="flex items-center gap-2 pt-0.5">
                  <span class="insignia" [class]="colorPlan[c.modo]">{{ plan[c.modo] }}</span>
                  <span class="font-semibold text-slate-700">{{ uso(c) }}</span>
                </div>
                @if (c.esFundador) {
                  <p class="text-[11px] text-amber-800 font-medium">★ Fundador #{{ c.numeroFundador || '?' }} ({{ (c.descuentoFundador ?? 0.5) * 100 }}% desc.)</p>
                }
              </div>

              <div class="rounded-lg border border-borde bg-white p-3 space-y-1">
                <p class="titulo-seccion">Uso en la app</p>
                <div class="grid grid-cols-3 gap-2 pt-0.5 text-center">
                  <div class="rounded bg-fondo p-1.5">
                    <p class="text-base font-extrabold text-slate-800">{{ d.resumen.ordenesTotal }}</p>
                    <p class="text-[10px] text-slate-500">Órdenes ({{ d.resumen.ordenesAbiertas }} ab.)</p>
                  </div>
                  <div class="rounded bg-fondo p-1.5">
                    <p class="text-base font-extrabold text-slate-800">{{ d.resumen.clientes }}</p>
                    <p class="text-[10px] text-slate-500">Clientes</p>
                  </div>
                  <div class="rounded bg-fondo p-1.5">
                    <p class="text-base font-extrabold text-slate-800">{{ d.resumen.inventario }}</p>
                    <p class="text-[10px] text-slate-500">Repuestos</p>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-borde bg-white p-3 space-y-1 sm:col-span-2">
                <p class="titulo-seccion">Equipo del taller ({{ d.equipo.length || 1 }})</p>
                <div class="flex flex-wrap gap-1.5 pt-1">
                  @for (e of d.equipo; track e.uid) {
                    <span class="insignia border-borde bg-fondo text-slate-700 font-medium">
                      👤 {{ e.nombre || e.email }} · {{ e.rol || 'miembro' }}{{ e.activo === false ? ' (inactivo)' : '' }}
                    </span>
                  } @empty {
                    <span class="text-slate-500">Solo el titular de la cuenta (sin mecánicos adicionales).</span>
                  }
                </div>
              </div>
            </div>

            <!-- Vínculo con el CRM -->
            <div class="space-y-2.5 rounded-lg border border-borde p-3">
              <div class="flex items-center justify-between">
                <p class="font-bold text-slate-800">Vínculo con prospecto del CRM</p>
                @if (d.crm; as actualCrm) {
                  <span class="insignia border-emerald-200 bg-emerald-50 text-emerald-700">Vinculado: {{ actualCrm.estado }}</span>
                }
              </div>
              <div class="flex gap-2">
                <select class="campo" [(ngModel)]="vinculo">
                  <option [ngValue]="null">— Sin vincular —</option>
                  @for (t of talleresCrm(); track t.id) {
                    <option [ngValue]="t.id">{{ t.nombre }} · {{ t.comuna }} ({{ t.estado }})</option>
                  }
                </select>
                <button class="btn-primario btn shrink-0" (click)="guardarVinculo()">Guardar vínculo</button>
              </div>
              @if (crm(); as t) {
                <div class="space-y-1.5 rounded bg-fondo p-2.5 text-xs">
                  <p class="titulo-seccion">Historial comercial ({{ t.taller.estado }})</p>
                  @if (t.taller.observaciones) {
                    <p class="whitespace-pre-wrap text-slate-700">{{ t.taller.observaciones }}</p>
                  }
                  @for (r of t.reuniones; track r.id) {
                    <p class="border-t border-borde pt-1 text-slate-600">
                      <b>{{ r.fecha.slice(0, 10) }}</b> · {{ r.resultado }} — {{ r.notas || r.acuerdos }}
                    </p>
                  }
                </div>
              }
            </div>

            <!-- Últimos movimientos -->
            <div class="space-y-1.5 rounded-lg border border-borde p-3 text-xs">
              <p class="titulo-seccion">Últimos movimientos en caja / órdenes</p>
              @for (t of d.resumen.ultimasTransacciones; track t.id) {
                <div class="flex items-center justify-between border-b border-borde py-1.5 last:border-0">
                  <span class="font-medium text-slate-700">{{ t.tipo }} · <span class="font-mono">{{ t.numeroOrden }}</span></span>
                  <span class="font-bold text-slate-900">{{ pesos(t.valorTotal) }} <span class="font-normal text-slate-500">· {{ fh(t.date) }}</span></span>
                </div>
              } @empty {
                <p class="py-2 text-slate-500">Sin movimientos registrados aún.</p>
              }
            </div>
          </div>
        }

        <!-- PESTAÑA 2: PLAN Y PAGOS -->
        @if (pestana() === 'plan') {
          <div class="space-y-4">
            <!-- Registrar pago rápido -->
            <div class="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5">
              <div>
                <p class="font-bold text-slate-900">Registrar pago y extender vigencia</p>
                <p class="text-xs text-slate-500">Suma automáticamente los meses pagados a la fecha de vencimiento de la cuenta.</p>
              </div>

              <div>
                <label class="etiqueta">Tarifas rápidas MAZA (1 clic)</label>
                <div class="flex flex-wrap gap-1.5">
                  @for (m of montosRapidos; track m.monto) {
                    <button type="button"
                            class="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
                            (click)="pago.monto = m.monto">
                      {{ m.etiqueta }}
                    </button>
                  }
                </div>
              </div>

              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label class="etiqueta">Monto ($ CLP)</label>
                  <input type="number" min="1" placeholder="Ej.: 19995" class="campo font-bold" [(ngModel)]="pago.monto" />
                </div>
                <div>
                  <label class="etiqueta">Duración</label>
                  <select class="campo" [(ngModel)]="pago.meses">
                    @for (m of [1, 3, 6, 12]; track m) { <option [ngValue]="m">{{ m }} {{ m === 1 ? 'mes' : 'meses' }}</option> }
                  </select>
                </div>
                <div>
                  <label class="etiqueta">Medio de pago</label>
                  <select class="campo" [(ngModel)]="pago.medio">
                    <option>Transferencia</option><option>Mercado Pago</option><option>Efectivo</option><option>Otro</option>
                  </select>
                </div>
              </div>
              <input class="campo" placeholder="Nota o comprobante (opcional)" [(ngModel)]="pago.nota" />
              <button class="btn-wa btn w-full !py-2" (click)="registrarPago()">✓ Registrar pago</button>
            </div>

            <!-- Configuración manual de plan -->
            <div class="space-y-3 rounded-lg border border-borde p-3.5">
              <p class="font-bold text-slate-900">Ajustes de plan y facturación</p>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label class="etiqueta">Plan activo</label>
                  <select class="campo" [(ngModel)]="p.plan">
                    @for (k of planes; track k) { <option [value]="k">{{ plan[k] }}</option> }
                  </select>
                </div>
                <div>
                  <label class="etiqueta">Pagado hasta (vacío = sin límite)</label>
                  <input type="date" class="campo" [(ngModel)]="p.planVigenteHasta" />
                </div>
              </div>

              @if (p.plan === 'empresa') {
                <div>
                  <label class="etiqueta">Asientos contratados (mínimo 3)</label>
                  <input type="number" min="3" max="50" class="campo" [(ngModel)]="p.asientosContratados" />
                </div>
              }

              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-xs text-slate-500 mr-1">Extender desde hoy:</span>
                @for (n of [14, 30, 90, 365]; track n) {
                  <button type="button" class="btn" (click)="sumar(n)">+{{ n === 365 ? '1 año' : n + ' días' }}</button>
                }
                <button type="button" class="btn" (click)="p.planVigenteHasta = ''">Sin vencimiento</button>
              </div>

              <div class="space-y-2 border-t border-borde pt-2.5">
                <label class="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" [(ngModel)]="p.esFundador" /> Es taller fundador (50% permanente)
                </label>
                @if (p.esFundador) {
                  <div class="grid grid-cols-2 gap-2 pl-5">
                    <div><label class="etiqueta">N° fundador (1–20)</label><input type="number" min="1" max="20" class="campo" [(ngModel)]="p.numeroFundador" /></div>
                    <div><label class="etiqueta">Descuento (0,5 = 50 %)</label><input type="number" step="0.05" min="0" max="1" class="campo" [(ngModel)]="p.descuentoFundador" /></div>
                  </div>
                }
                <label class="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" [(ngModel)]="p.mpConnectHabilitado" /> Cobro online con Mercado Pago Connect (piloto)
                </label>
              </div>

              <button class="btn-primario btn w-full !py-2" (click)="guardarPlan()">Guardar cambios de plan</button>
            </div>
          </div>
        }

        <!-- PESTAÑA 3: CLAVE Y PELIGRO -->
        @if (pestana() === 'seguridad') {
          <div class="space-y-4">
            <!-- Contraseña -->
            <div class="space-y-2.5 rounded-lg border border-borde p-3.5">
              <div>
                <p class="font-bold text-slate-900">Restablecer contraseña</p>
                <p class="text-xs text-slate-500">Al cambiarla, se copia automáticamente al portapapeles para enviársela al taller.</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <input class="campo font-mono flex-1 min-w-[180px]" placeholder="Nueva contraseña (mín. 8)" [(ngModel)]="clave" />
                <button class="btn" (click)="clave = generar()">Generar segura</button>
                <button class="btn-primario btn" (click)="cambiarClave()">Cambiar y copiar</button>
              </div>
            </div>

            <!-- Zona de peligro -->
            <div class="space-y-2.5 rounded-lg border border-red-300 bg-red-50/50 p-3.5">
              <p class="font-bold text-red-700">⚠️ Zona de peligro · Eliminar cuenta</p>
              <p class="text-xs text-slate-600">
                Borra permanentemente el taller, sus órdenes, clientes, caja, fotos y el acceso en Firebase. El equipo queda desvinculado. Esta acción no se puede deshacer.
              </p>
              <div class="flex flex-wrap gap-2">
                <input class="campo flex-1 min-w-[200px]" [placeholder]="'Escribe ' + c.email + ' para confirmar'" [(ngModel)]="confirmacion" [disabled]="eliminando()" />
                <button class="btn-peligro btn" [disabled]="confirmacion.trim().toLowerCase() !== c.email.toLowerCase() || eliminando()" (click)="eliminar()">
                  {{ eliminando() ? 'Eliminando…' : 'Eliminar definitivamente' }}
                </button>
              </div>
              @if (eliminando()) {
                <div class="flex items-center gap-2 pt-1 text-xs text-red-700">
                  <span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-700 border-t-transparent"></span>
                  <span>Eliminando cuenta y datos asociados en la nube… Por favor espera.</span>
                </div>
              }
            </div>
          </div>
        }
      } @else {
        <div class="space-y-3 animate-pulse py-4">
          <div class="h-8 rounded bg-slate-200"></div>
          <div class="grid grid-cols-2 gap-2">
            <div class="h-20 rounded-lg bg-slate-100"></div>
            <div class="h-20 rounded-lg bg-slate-100"></div>
          </div>
          <div class="h-24 rounded-lg bg-slate-100"></div>
        </div>
      }
    </app-modal>
  `,
})
export class FichaCuenta implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  uid = input.required<string>();
  cerrar = output<void>();

  readonly plan = NOMBRE_PLAN;
  readonly colorPlan = COLOR_PLAN;
  readonly planes = ['trial', 'pro', 'ilimitado', 'empresa', 'basico'];
  readonly montosRapidos = MONTOS_RAPIDOS;

  pestana = signal<PestanaCuenta>('resumen');
  d = signal<DetalleCuenta | null>(null);
  talleresCrm = signal<Taller[]>([]);
  crm = signal<DetalleTaller | null>(null);
  p: any = {};
  pago = { monto: null as number | null, meses: 1, medio: 'Transferencia', nota: '' };
  vinculo: number | null = null;
  clave = '';
  confirmacion = '';
  eliminando = signal(false);

  uso = textoUso; f = fecha; fh = fechaHora; pesos = plata; generar = generarClave;
  tel = telLink;
  wa = (c: DetalleCuenta['cuenta']) => linkWa(c.telefono, `Hola${c.nombreTaller ? ' ' + c.nombreTaller : ''}, te escribo de MAZA.`);

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    try {
      const [d, t] = await Promise.all([this.api.cuenta(this.uid()), this.api.talleres({})]);
      this.d.set(d);
      this.talleresCrm.set(t);
      const c = d.cuenta;
      this.p = {
        plan: ['pro', 'ilimitado', 'empresa', 'basico', 'trial'].includes(c.plan) ? c.plan : 'trial',
        planVigenteHasta: c.planVigenteHasta ? c.planVigenteHasta.slice(0, 10) : '',
        asientosContratados: c.asientosContratados ?? 3, esFundador: c.esFundador,
        numeroFundador: c.numeroFundador, descuentoFundador: c.descuentoFundador ?? 0.5, mpConnectHabilitado: c.mpConnectHabilitado,
      };
      this.vinculo = d.crm?.id ?? null;
      this.crm.set(d.crm ? await this.api.taller(d.crm.id) : null);
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async copiar(texto: string, aviso: string) {
    await navigator.clipboard?.writeText(texto).catch(() => {});
    this.sesion.avisar(aviso);
  }

  sumar(n: number) { const d = new Date(); d.setDate(d.getDate() + n); this.p.planVigenteHasta = d.toISOString().slice(0, 10); }

  async guardarPlan() {
    const c = this.d()!.cuenta;
    if (!confirm(`¿Cambiar el plan de ${c.nombreTaller || c.email} a ${this.plan[this.p.plan]}${this.p.planVigenteHasta ? ' hasta ' + this.p.planVigenteHasta : ' sin vencimiento'}?`)) return;
    try {
      const r = await this.api.guardarPlan(c.uid, {
        ...this.p, planVigenteHasta: this.p.planVigenteHasta || null,
        asientosContratados: this.p.plan === 'empresa' ? Number(this.p.asientosContratados) : null,
        numeroFundador: this.p.esFundador ? Number(this.p.numeroFundador) : null,
        descuentoFundador: this.p.esFundador ? Number(this.p.descuentoFundador) : null,
      });
      this.sesion.avisar(r.cambio ? `Plan actualizado${r.miembrosEspejados ? ` (y ${r.miembrosEspejados} del equipo)` : ''}` : 'Sin cambios');
      this.cargar();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async registrarPago() {
    if (!this.pago.monto) { this.sesion.avisar('Ingresa el monto', false); return; }
    if (!confirm(`¿Registrar ${plata(this.pago.monto)} por ${this.pago.meses} mes(es)?`)) return;
    try {
      const r = await this.api.registrarPago(this.uid(), this.pago);
      this.sesion.avisar(`Pago registrado. Vigente hasta ${fecha(r.vigenteHasta)}`);
      this.pago = { monto: null, meses: 1, medio: 'Transferencia', nota: '' };
      this.cargar();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async guardarVinculo() {
    const actual = this.d()?.crm?.id ?? null;
    try {
      if (actual && actual !== this.vinculo) await this.api.vincular(actual, null);
      if (this.vinculo) await this.api.vincular(this.vinculo, this.uid());
      this.sesion.avisar('Vínculo guardado');
      this.cargar();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async eliminar() {
    const c = this.d()!.cuenta;
    this.eliminando.set(true);
    try {
      await this.api.eliminarCuenta(c.uid, this.confirmacion);
      this.sesion.avisar(`Cuenta ${c.email} eliminada`);
      this.cerrar.emit();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.eliminando.set(false); }
  }

  async cambiarClave() {
    if (this.clave.length < 8) { this.sesion.avisar('Mínimo 8 caracteres', false); return; }
    if (!confirm('¿Cambiar la contraseña? La actual deja de funcionar.')) return;
    try {
      await this.api.cambiarClave(this.uid(), this.clave);
      await navigator.clipboard?.writeText(this.clave).catch(() => {});
      this.sesion.avisar('Contraseña cambiada (copiada)');
      this.clave = '';
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  intentarCerrar() {
    if (!this.eliminando()) this.cerrar.emit();
  }
}
