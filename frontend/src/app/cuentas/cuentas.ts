import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { Cuenta, NOMBRE_PLAN, Taller } from '../core/modelos';
import { fecha, generarClave } from '../core/utiles';
import { Modal } from '../compartido/modal';
import { FichaCuenta } from './ficha-cuenta';
import { COLOR_PLAN, textoUso } from './comun';

@Component({
  selector: 'app-cuentas',
  imports: [FormsModule, Modal, FichaCuenta],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tarjeta mb-3 flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p class="titulo-seccion">Cuentas MAZA</p><h1 class="text-xl font-bold">Talleres y planes</h1></div>
      <div class="flex gap-2">
        <button class="btn" (click)="sincronizar()" title="Pasa la etapa del embudo de cada taller vinculado a su plan real">Sincronizar embudo</button>
        <button class="btn-primario btn" (click)="abrirCrear()">Crear cuenta</button>
      </div>
    </section>

    @if (m(); as m) {
      <section class="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        @for (k of kpis(); track k[0]) { <div class="tarjeta p-3"><p class="text-[11px] font-bold uppercase text-slate-500">{{ k[0] }}</p><p class="text-2xl font-extrabold">{{ k[1] }}</p><p class="text-[11px] text-slate-500">{{ k[2] }}</p></div> }
      </section>
    }

    <section class="tarjeta mb-3 flex flex-wrap gap-2 p-3">
      <input class="campo min-w-[200px] flex-1" placeholder="Buscar por taller, correo o ciudad" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <select class="campo !w-auto" [ngModel]="modo()" (ngModelChange)="modo.set($event)">
        <option value="">Todos los planes</option>
        @for (k of modos; track k) { <option [value]="k">{{ plan[k] }}</option> }
      </select>
      <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="orden.set($event)">
        <option value="creadoEn">Más recientes</option><option value="vence">Vencen antes</option><option value="nombre">Nombre</option>
      </select>
      @if (marcadas().size) {
        <button class="btn-peligro btn" (click)="eliminarMarcadas()">Eliminar {{ marcadas().size }} seleccionadas</button>
      }
    </section>

    <div class="tarjeta overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-fondo text-left text-[11px] uppercase text-slate-500">
          <tr><th class="w-8 px-3 py-2"><input type="checkbox" [checked]="marcadas().size && marcadas().size === lista().length" (change)="marcarTodas($any($event.target).checked)" /></th><th class="px-3 py-2">Taller</th><th class="px-3 py-2">Plan</th><th class="px-3 py-2">Vence / uso</th><th class="hidden px-3 py-2 md:table-cell">CRM</th><th class="hidden px-3 py-2 md:table-cell">Alta</th></tr>
        </thead>
        <tbody>
          @for (c of lista(); track c.uid) {
            <tr class="cursor-pointer border-t border-borde hover:bg-marca-50" (click)="abierta.set(c.uid)">
              <td class="px-3 py-2" (click)="$event.stopPropagation()"><input type="checkbox" [checked]="marcadas().has(c.uid)" (change)="marcar(c.uid)" /></td>
              <td class="px-3 py-2"><p class="font-bold">{{ c.nombreTaller || '(sin nombre)' }} @if (c.esFundador) { <span class="text-[10px] text-amber-700">★ {{ c.numeroFundador }}</span> }</p><p class="text-xs text-slate-500">{{ c.email }}</p></td>
              <td class="px-3 py-2"><span class="insignia" [class]="colorPlan[c.modo]">{{ plan[c.modo] }}</span></td>
              <td class="px-3 py-2 text-xs">{{ uso(c) }}</td>
              <td class="hidden px-3 py-2 text-xs md:table-cell">{{ c.crm?.nombre || '—' }}</td>
              <td class="hidden px-3 py-2 text-xs text-slate-500 md:table-cell">{{ f(c.creadoEn) }}</td>
            </tr>
          } @empty { <tr><td colspan="6" class="px-3 py-8 text-center text-slate-500">{{ cargando() ? 'Cargando…' : 'Sin resultados' }}</td></tr> }
        </tbody>
      </table>
    </div>

    @if (abierta(); as uid) { <app-ficha-cuenta [uid]="uid" (cerrar)="abierta.set(null); cargar()" /> }

    @if (creando()) {
      <app-modal titulo="Crear cuenta" subtitulo="Taller que pagó por fuera o cuenta de prueba. La contraseña se la entregas tú." ancho="28rem" (cerrar)="creando.set(false)">
        <div><label class="etiqueta">Correo</label><input type="email" class="campo" [(ngModel)]="nueva.email" /></div>
        <div><label class="etiqueta">Contraseña (mín. 8)</label>
          <div class="flex gap-2"><input class="campo font-mono" [(ngModel)]="nueva.password" /><button class="btn" (click)="nueva.password = generar()">Generar</button></div></div>
        <div><label class="etiqueta">Nombre del taller</label><input class="campo" [(ngModel)]="nueva.nombreTaller" /></div>
        <div><label class="etiqueta">Plan inicial</label>
          <select class="campo" [(ngModel)]="nueva.plan">@for (k of ['trial', 'pro', 'ilimitado', 'empresa']; track k) { <option [value]="k">{{ plan[k] }}</option> }</select></div>
        <div><label class="etiqueta">Vincular a un taller del CRM</label>
          <select class="campo" [(ngModel)]="nueva.tallerCrmId"><option [ngValue]="null">— Ninguno —</option>
            @for (t of talleresCrm(); track t.id) { <option [ngValue]="t.id">{{ t.nombre }} · {{ t.comuna }}</option> }</select></div>
        <p class="text-[11px] text-slate-500">Un plan pagado se crea sin vencimiento: ajústalo en la ficha.</p>
        <button class="btn-primario btn w-full" (click)="crear()">Crear</button>
      </app-modal>
    }
  `,
})
export class Cuentas implements OnInit {
  private api = inject(Api);
  private sesion = inject(Sesion);
  readonly plan = NOMBRE_PLAN;
  readonly colorPlan = COLOR_PLAN;
  readonly modos = ['trial', 'trial_expirado', 'pro', 'ilimitado', 'empresa', 'basico'];
  cuentas = signal<Cuenta[]>([]);
  m = signal<any>(null);
  cargando = signal(true);
  q = signal('');
  modo = signal('');
  orden = signal('creadoEn');
  abierta = signal<string | null>(null);
  creando = signal(false);
  talleresCrm = signal<Taller[]>([]);
  nueva: any = {};
  marcadas = signal(new Set<string>());
  uso = textoUso; f = fecha; generar = generarClave;

  kpis = computed(() => {
    const m = this.m(); const p = m.porModo || {};
    return [['Talleres', m.talleres, `${m.miembros} de equipo`], ['Pagando', m.pagando, `Solo ${p.pro || 0} · Pro ${p.ilimitado || 0} · Emp. ${p.empresa || 0}`],
      ['En prueba', p.trial || 0, ''], ['Prueba vencida', p.trial_expirado || 0, 'para recuperar'], ['Fundadores', m.fundadores, 'de 20']];
  });

  lista = computed(() => {
    const q = this.q().trim().toLowerCase();
    const l = this.cuentas().filter((c) => (!this.modo() || c.modo === this.modo()) &&
      (!q || [c.nombreTaller, c.email, c.ciudad].some((v) => (v || '').toLowerCase().includes(q))));
    if (this.orden() === 'nombre') l.sort((a, b) => (a.nombreTaller || a.email).localeCompare(b.nombreTaller || b.email));
    if (this.orden() === 'vence') l.sort((a, b) => (a.planVigenteHasta || '9999').localeCompare(b.planVigenteHasta || '9999'));
    return l;
  });

  async ngOnInit() { await this.cargar(); }
  async cargar() {
    try { const d = await this.api.cuentas(); this.cuentas.set(d.cuentas); this.m.set(d.metricas); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.cargando.set(false); }
  }

  async abrirCrear() {
    this.nueva = { email: '', password: generarClave(), nombreTaller: '', plan: 'trial', tallerCrmId: null };
    this.creando.set(true);
    this.talleresCrm.set(await this.api.talleres({}));
  }

  async crear() {
    try {
      const r = await this.api.crearCuenta(this.nueva);
      await navigator.clipboard?.writeText(`${this.nueva.email} / ${this.nueva.password}`).catch(() => {});
      this.sesion.avisar('Cuenta creada (correo y contraseña copiados)');
      this.creando.set(false);
      await this.cargar();
      this.abierta.set(r.uid);
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  marcar(uid: string) { const s = new Set(this.marcadas()); s.has(uid) ? s.delete(uid) : s.add(uid); this.marcadas.set(s); }
  marcarTodas(on: boolean) { this.marcadas.set(on ? new Set(this.lista().map((c) => c.uid)) : new Set()); }

  /** Borrado en lote (cuentas de prueba): se confirma escribiendo ELIMINAR y la
   * cantidad; cada cuenta va con su propio correo como confirmación al backend. */
  async eliminarMarcadas() {
    const sel = this.cuentas().filter((c) => this.marcadas().has(c.uid));
    const pagando = sel.filter((c) => ['pro', 'ilimitado', 'empresa'].includes(c.modo));
    const aviso = pagando.length ? `

Ojo: ${pagando.length} tienen un plan pagado vigente.` : '';
    const frase = `ELIMINAR ${sel.length}`;
    if (prompt(`Vas a borrar ${sel.length} cuentas con todos sus datos. No se puede deshacer.${aviso}

Escribe «${frase}» para confirmar:`) !== frase) return;
    let ok = 0;
    for (const c of sel) {
      try { await this.api.eliminarCuenta(c.uid, c.email); ok++; }
      catch (e) { this.sesion.avisar(`${c.email}: ${mensajeError(e)}`, false); }
    }
    this.sesion.avisar(`${ok} de ${sel.length} cuentas eliminadas`);
    this.marcadas.set(new Set());
    this.cargar();
  }

  async sincronizar() {
    try { const r = await this.api.sincronizar(); this.sesion.avisar(r.cambios ? `${r.cambios} talleres cambiaron de etapa` : 'El embudo ya estaba al día'); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }
}
