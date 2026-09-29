import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { DetalleCuenta, DetalleTaller, NOMBRE_PLAN, Taller } from '../core/modelos';
import { fecha, fechaHora, generarClave, plata } from '../core/utiles';
import { Modal } from '../compartido/modal';
import { COLOR_PLAN, textoUso } from './comun';

/** Ficha de una cuenta de MAZA: uso, plan, pagos, vínculo con el CRM y clave. */
@Component({
  selector: 'app-ficha-cuenta',
  imports: [FormsModule, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal ancho="40rem" (cerrar)="cerrar.emit()">
      <div encabezado>
        @if (d(); as d) {
          <h2 class="text-lg font-bold">{{ d.cuenta.nombreTaller || '(sin nombre)' }}</h2>
          <p class="text-xs text-slate-500">{{ d.cuenta.email }} · {{ [d.cuenta.tipoTaller, d.cuenta.ciudad, d.cuenta.telefono].filter(ok).join(' · ') }}</p>
          <p class="font-mono text-[10px] text-slate-400">{{ d.cuenta.uid }}</p>
        }
      </div>
      @if (d(); as d) {
        @let c = d.cuenta;
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-lg bg-fondo p-3"><p class="titulo-seccion">Ahora</p><span class="insignia" [class]="colorPlan[c.modo]">{{ plan[c.modo] }}</span><p class="mt-1">{{ uso(c) }}</p></div>
          <div class="rounded-lg bg-fondo p-3"><p class="titulo-seccion">Último acceso</p><p class="font-bold">{{ fh(d.ultimoAcceso) }}</p><p>Alta {{ f(c.creadoEn) }}</p></div>
          <div class="rounded-lg bg-fondo p-3"><p class="titulo-seccion">Uso</p><p>{{ d.resumen.clientes }} clientes · {{ d.resumen.ordenesTotal }} órdenes ({{ d.resumen.ordenesAbiertas }} abiertas) · {{ d.resumen.inventario }} repuestos</p></div>
          <div class="rounded-lg bg-fondo p-3"><p class="titulo-seccion">Equipo</p>
            @for (e of d.equipo; track e.uid) { <p>{{ e.nombre || e.email }} ({{ e.rol }}{{ e.activo === false ? ', inactivo' : '' }})</p> } @empty { <p>Solo el dueño</p> }</div>
        </div>

        <!-- Plan -->
        <div class="space-y-2 rounded-lg border border-borde p-3">
          <p class="font-bold">Plan y facturación</p>
          <select class="campo" [(ngModel)]="p.plan">
            @for (k of planes; track k) { <option [value]="k">{{ plan[k] }}</option> }
          </select>
          @if (p.plan === 'empresa') { <div><label class="etiqueta">Asientos (mínimo 3)</label><input type="number" min="3" max="50" class="campo" [(ngModel)]="p.asientosContratados" /></div> }
          <div><label class="etiqueta">Pagado hasta (vacío = sin vencimiento)</label><input type="date" class="campo" [(ngModel)]="p.planVigenteHasta" /></div>
          <div class="flex flex-wrap gap-1">
            @for (n of [30, 90, 365]; track n) { <button class="btn" (click)="sumar(n)">+{{ n === 365 ? '1 año' : n + ' días' }}</button> }
            <button class="btn" (click)="p.planVigenteHasta = ''">Sin límite</button>
          </div>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" [(ngModel)]="p.esFundador" /> Es fundador</label>
          @if (p.esFundador) {
            <div class="grid grid-cols-2 gap-2">
              <div><label class="etiqueta">N° (1–20)</label><input type="number" min="1" max="20" class="campo" [(ngModel)]="p.numeroFundador" /></div>
              <div><label class="etiqueta">Descuento (0,5 = 50 %)</label><input type="number" step="0.05" min="0" max="1" class="campo" [(ngModel)]="p.descuentoFundador" /></div>
            </div>
          }
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" [(ngModel)]="p.mpConnectHabilitado" /> Cobro online con Mercado Pago Connect (piloto)</label>
          <button class="btn-primario btn w-full" (click)="guardarPlan()">Guardar plan</button>
        </div>

        <!-- Pago -->
        <div class="space-y-2 rounded-lg border border-borde p-3">
          <p class="font-bold">Registrar pago</p>
          <div class="grid grid-cols-3 gap-2">
            <input type="number" min="1" placeholder="Monto" class="campo" [(ngModel)]="pago.monto" />
            <select class="campo" [(ngModel)]="pago.meses">@for (m of [1, 3, 6, 12]; track m) { <option [ngValue]="m">{{ m }} {{ m === 1 ? 'mes' : 'meses' }}</option> }</select>
            <select class="campo" [(ngModel)]="pago.medio"><option>Transferencia</option><option>Efectivo</option><option>Mercado Pago</option><option>Otro</option></select>
          </div>
          <input class="campo" placeholder="Nota (opcional)" [(ngModel)]="pago.nota" />
          <button class="btn-wa btn w-full" (click)="registrarPago()">Registrar pago</button>
        </div>

        <!-- Vínculo con el CRM -->
        <div class="space-y-2 rounded-lg border border-borde p-3">
          <p class="font-bold">Taller en el CRM</p>
          <div class="flex gap-2">
            <select class="campo" [(ngModel)]="vinculo">
              <option [ngValue]="null">— Ninguno —</option>
              @for (t of talleresCrm(); track t.id) { <option [ngValue]="t.id">{{ t.nombre }} · {{ t.comuna }} ({{ t.estado }})</option> }
            </select>
            <button class="btn" (click)="guardarVinculo()">Guardar</button>
          </div>
          @if (crm(); as t) {
            <div class="space-y-1 text-xs">
              <p class="titulo-seccion">Historial comercial ({{ t.taller.estado }})</p>
              @if (t.taller.observaciones) { <p class="whitespace-pre-wrap text-slate-600">{{ t.taller.observaciones }}</p> }
              @for (r of t.reuniones; track r.id) { <p class="border-b border-borde py-1"><b>{{ r.fecha.slice(0, 10) }}</b> · {{ r.resultado }} — {{ r.notas || r.acuerdos }}</p> }
            </div>
          }
        </div>

        <!-- Contraseña -->
        <div class="space-y-2 rounded-lg border border-borde p-3">
          <p class="font-bold">Contraseña</p>
          <div class="flex gap-2">
            <input class="campo font-mono" placeholder="Nueva (mín. 8)" [(ngModel)]="clave" />
            <button class="btn" (click)="clave = generar()">Generar</button>
            <button class="btn !text-red-700" (click)="cambiarClave()">Cambiar</button>
          </div>
        </div>

        <div class="space-y-1 text-xs">
          <p class="titulo-seccion">Últimos movimientos</p>
          @for (t of d.resumen.ultimasTransacciones; track t.id) {
            <p class="flex justify-between border-b border-borde py-1"><span>{{ t.tipo }} · {{ t.numeroOrden }}</span><span>{{ pesos(t.valorTotal) }} · {{ fh(t.date) }}</span></p>
          } @empty { <p class="text-slate-500">Sin movimientos.</p> }
        </div>
      } @else { <p class="py-8 text-center text-sm text-slate-500">Cargando…</p> }
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
  d = signal<DetalleCuenta | null>(null);
  talleresCrm = signal<Taller[]>([]);
  crm = signal<DetalleTaller | null>(null);
  p: any = {};
  pago = { monto: null as number | null, meses: 1, medio: 'Transferencia', nota: '' };
  vinculo: number | null = null;
  clave = '';

  uso = textoUso; f = fecha; fh = fechaHora; pesos = plata; generar = generarClave;
  ok = (x: unknown) => !!x;

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
}
