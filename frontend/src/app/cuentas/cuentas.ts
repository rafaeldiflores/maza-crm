import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { Cuenta, Invitacion, NOMBRE_PLAN, Taller } from '../core/modelos';
import { fecha, generarClave, linkWa, telLink } from '../core/utiles';
import { Modal } from '../compartido/modal';
import { WaPipe } from '../compartido/wa.pipe';
import { FichaCuenta } from './ficha-cuenta';
import { COLOR_PLAN, textoUso } from './comun';

@Component({
  selector: 'app-cuentas',
  imports: [FormsModule, Modal, WaPipe, FichaCuenta],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Encabezado en 2 niveles (consistente con Prospectos) -->
    <section class="tarjeta mb-3 divide-y divide-borde overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-4 sm:py-3.5">
        <div>
          <p class="titulo-seccion">Cuentas MAZA</p>
          <h1 class="text-xl font-bold text-slate-900">Talleres y planes</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn font-semibold shadow-xs" (click)="abrirCrear()">
            <span>＋</span> Crear cuenta
          </button>
          <button class="btn-primario btn font-semibold shadow-xs" (click)="abrirInvitar()"
                  title="Código de un solo uso para que el taller cree su cuenta (talleres fundadores)">
            <span>🎟️</span> Invitar taller
            @if (pendientes()) {
              <span class="ml-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {{ pendientes() }}
              </span>
            }
          </button>
        </div>
      </div>

      <!-- Barra de herramientas rápidas -->
      <div class="flex items-center justify-between gap-2 overflow-x-auto bg-slate-50/75 px-3 py-2 text-xs sm:px-4">
        <div class="flex items-center gap-1.5 flex-nowrap sm:flex-wrap">
          <span class="mr-1 hidden text-[11px] font-bold uppercase tracking-wider text-slate-400 sm:inline">Acciones:</span>
          <button class="btn !bg-white !text-slate-700 shadow-2xs transition-all hover:!bg-slate-100 active:scale-95"
                  (click)="sincronizar()"
                  title="Pasa la etapa del embudo de cada taller vinculado a su plan real">
            <span>🔄</span> Sincronizar embudo
          </button>
          <button class="btn !bg-white !text-slate-700 shadow-2xs transition-all hover:!bg-slate-100 active:scale-95"
                  [disabled]="cargando()" (click)="cargar()" title="Recargar listado y métricas">
            <span>↻</span> Actualizar
          </button>
          <button class="btn !bg-white !text-slate-700 shadow-2xs transition-all hover:!bg-amber-50 hover:!border-amber-300 active:scale-95"
                  [class.!border-amber-400]="soloFundadores()"
                  [class.!bg-amber-50]="soloFundadores()"
                  [class.!text-amber-800]="soloFundadores()"
                  (click)="soloFundadores.set(!soloFundadores())">
            <span>★</span> Fundadores
          </button>
          <button class="btn !bg-white !text-slate-700 shadow-2xs transition-all hover:!bg-slate-100 active:scale-95"
                  [class.!border-marca-400]="soloVinculadas()"
                  [class.!bg-marca-50]="soloVinculadas()"
                  [class.!text-marca-800]="soloVinculadas()"
                  (click)="soloVinculadas.set(!soloVinculadas())">
            <span>🔗</span> Vinculadas al CRM
          </button>
        </div>

        @if (marcadas().size) {
          <div class="flex shrink-0 items-center gap-1.5">
            <button class="btn !bg-white !text-slate-600" (click)="marcarTodas(false)">Desmarcar</button>
            <button class="btn-peligro btn shadow-2xs" (click)="abrirConfirmacionEliminar()" [disabled]="eliminandoLote()">
              Eliminar {{ marcadas().size }} seleccionadas
            </button>
          </div>
        }
      </div>
    </section>

    <!-- KPIs interactivos (clic para filtrar) -->
    @if (m(); as m) {
      <section class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        @for (k of kpis(); track k.id) {
          <button type="button"
                  class="tarjeta p-3 text-left transition-all hover:shadow-md"
                  [class.ring-2]="k.activo"
                  [class.ring-marca-500]="k.activo"
                  [class.!bg-marca-50]="k.activo"
                  (click)="k.accion()">
            <p class="truncate text-[11px] font-bold uppercase text-slate-500">{{ k.titulo }}</p>
            <p class="text-2xl font-extrabold" [class]="k.color">{{ k.valor }}</p>
            <p class="truncate text-[11px] text-slate-500">{{ k.subtitulo }}</p>
          </button>
        }
      </section>
    }

    <!-- Barra de filtros y búsqueda -->
    <section class="tarjeta mb-3 space-y-3 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-1 overflow-x-auto text-xs font-semibold">
          @for (f of chipsModo; track f.v) {
            <button type="button"
                    class="whitespace-nowrap rounded-md px-3 py-1.5 transition-colors"
                    [class]="modo() === f.v && !soloFundadores() ? 'bg-marca-800 text-white' : 'hover:bg-fondo text-slate-700'"
                    (click)="seleccionarChipModo(f.v)">
              {{ f.t }}
            </button>
          }
        </div>
        <p class="text-[11px] font-semibold text-slate-500">
          {{ lista().length }} de {{ cuentas().length }} cuentas
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <input class="campo min-w-[200px] flex-1"
               placeholder="Buscar por taller, correo, ciudad, teléfono o UID…"
               [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <select class="campo !w-auto" [ngModel]="modo()" (ngModelChange)="modo.set($event)">
          <option value="">Todos los planes</option>
          <option value="pagando">💳 Todos los pagados</option>
          @for (k of modos; track k) { <option [value]="k">{{ plan[k] }}</option> }
        </select>
        <select class="campo !w-auto" [ngModel]="orden()" (ngModelChange)="orden.set($event)">
          <option value="creadoEn">Más recientes</option>
          <option value="vence">Vencen antes</option>
          <option value="uso">Mayor avance en prueba</option>
          <option value="nombre">Nombre A-Z</option>
        </select>
        @if (hayFiltros()) {
          <button class="btn !text-red-700" (click)="limpiarFiltros()">Limpiar</button>
        }
      </div>
    </section>

    <!-- Tabla en escritorio -->
    <div class="tarjeta hidden overflow-x-auto md:block">
      <table class="w-full text-sm">
        <thead class="bg-fondo text-left text-[11px] uppercase text-slate-500">
          <tr>
            <th class="w-8 px-3 py-2.5">
              <input type="checkbox"
                     [checked]="lista().length > 0 && marcadas().size === lista().length"
                     (change)="marcarTodas($any($event.target).checked)" />
            </th>
            <th class="px-3 py-2.5">Taller y contacto</th>
            <th class="px-3 py-2.5">Plan</th>
            <th class="px-3 py-2.5">Vigencia / uso</th>
            <th class="px-3 py-2.5">Vínculo CRM</th>
            <th class="px-3 py-2.5">Alta</th>
            <th class="px-3 py-2.5 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          @if (cargando()) {
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <tr class="animate-pulse border-t border-borde">
                <td class="px-3 py-3"><div class="h-4 w-4 rounded bg-slate-200"></div></td>
                <td class="px-3 py-3 space-y-1.5"><div class="h-4 w-36 rounded bg-slate-200"></div><div class="h-3 w-48 rounded bg-slate-100"></div></td>
                <td class="px-3 py-3"><div class="h-5 w-20 rounded-full bg-slate-200"></div></td>
                <td class="px-3 py-3 space-y-1"><div class="h-3 w-28 rounded bg-slate-200"></div><div class="h-1.5 w-24 rounded bg-slate-100"></div></td>
                <td class="px-3 py-3"><div class="h-4 w-24 rounded bg-slate-100"></div></td>
                <td class="px-3 py-3"><div class="h-3 w-16 rounded bg-slate-100"></div></td>
                <td class="px-3 py-3 text-right"><div class="ml-auto h-7 w-24 rounded bg-slate-200"></div></td>
              </tr>
            }
          } @else {
            @for (c of lista(); track c.uid) {
              <tr class="cursor-pointer border-t border-borde transition-colors hover:bg-marca-50/70" (click)="abierta.set(c.uid)">
                <td class="px-3 py-2.5" (click)="$event.stopPropagation()">
                  <input type="checkbox" [checked]="marcadas().has(c.uid)" (change)="marcar(c.uid)" />
                </td>
                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-bold text-slate-900">{{ c.nombreTaller || '(sin nombre)' }}</span>
                    @if (c.esFundador) {
                      <span class="insignia border-amber-300 bg-amber-50 text-amber-800" title="Taller fundador">
                        ★ #{{ c.numeroFundador || '?' }}
                      </span>
                    }
                    @if (c.mpConnectHabilitado) {
                      <span class="insignia border-sky-200 bg-sky-50 text-sky-700" title="Cobro online con Mercado Pago Connect habilitado">
                        MP
                      </span>
                    }
                  </div>
                  <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span>{{ c.email }}</span>
                    @if (c.ciudad || c.tipoTaller) {
                      <span>· {{ [c.tipoTaller, c.ciudad].filter(ok).join(' · ') }}</span>
                    }
                    @if (c.telefono) {
                      <span>· 📞 {{ c.telefono }}</span>
                    }
                  </div>
                </td>
                <td class="px-3 py-2.5">
                  <span class="insignia" [class]="colorPlan[c.modo]">{{ plan[c.modo] }}</span>
                </td>
                <td class="px-3 py-2.5 text-xs">
                  <p class="font-medium text-slate-700">{{ uso(c) }}</p>
                  @if (c.modo === 'trial' || c.modo === 'trial_expirado') {
                    <div class="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                      <div class="h-full rounded-full transition-all"
                           [class]="c.modo === 'trial_expirado' ? 'bg-red-500' : pctPrueba(c) >= 80 ? 'bg-amber-500' : 'bg-sky-500'"
                           [style.width.%]="pctPrueba(c)"></div>
                    </div>
                  }
                </td>
                <td class="px-3 py-2.5 text-xs">
                  @if (c.crm; as crm) {
                    <span class="insignia border-slate-200 bg-slate-50 font-medium text-slate-700">🔗 {{ crm.nombre }}</span>
                  } @else {
                    <span class="text-slate-400">—</span>
                  }
                </td>
                <td class="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{{ f(c.creadoEn) }}</td>
                <td class="px-3 py-2.5 text-right" (click)="$event.stopPropagation()">
                  <div class="inline-flex items-center justify-end gap-1">
                    @if (waFila(c); as w) {
                      <a class="btn-wa btn !px-2 !py-1 text-[11px]" target="_blank" rel="noopener" [href]="w | wa" title="Escribir por WhatsApp">
                        WhatsApp
                      </a>
                    }
                    <button class="btn !px-2 !py-1 text-[11px]" (click)="copiar(c.email, 'Correo copiado')" title="Copiar correo">
                      📋
                    </button>
                    <button class="btn-primario btn !px-2.5 !py-1 text-[11px]" (click)="abierta.set(c.uid)">
                      Ficha
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="px-3 py-10 text-center">
                  <div class="space-y-2">
                    <p class="font-bold text-slate-700">No hay cuentas con estos filtros</p>
                    <p class="text-xs text-slate-500">Prueba ajustando la búsqueda o el filtro de plan.</p>
                    @if (hayFiltros()) {
                      <button class="btn mt-1" (click)="limpiarFiltros()">Limpiar filtros</button>
                    }
                  </div>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>

    <!-- Tarjetas responsivas en móvil -->
    <div class="space-y-2 md:hidden">
      @if (cargando()) {
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="tarjeta animate-pulse space-y-2.5 p-3">
            <div class="flex justify-between">
              <div class="h-4 w-36 rounded bg-slate-200"></div>
              <div class="h-5 w-20 rounded-full bg-slate-200"></div>
            </div>
            <div class="h-3 w-48 rounded bg-slate-100"></div>
            <div class="h-3 w-32 rounded bg-slate-100"></div>
          </div>
        }
      } @else {
        @for (c of lista(); track c.uid) {
          <article class="tarjeta space-y-2.5 p-3" (click)="abierta.set(c.uid)">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-start gap-2 min-w-0">
                <input type="checkbox" class="mt-1" [checked]="marcadas().has(c.uid)"
                       (click)="$event.stopPropagation()" (change)="marcar(c.uid)" />
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1">
                    <p class="font-bold text-slate-900 truncate">{{ c.nombreTaller || '(sin nombre)' }}</p>
                    @if (c.esFundador) {
                      <span class="insignia border-amber-300 bg-amber-50 text-amber-800">★ #{{ c.numeroFundador || '?' }}</span>
                    }
                  </div>
                  <p class="text-xs text-slate-500 truncate">{{ c.email }}</p>
                </div>
              </div>
              <span class="insignia shrink-0" [class]="colorPlan[c.modo]">{{ plan[c.modo] }}</span>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>{{ uso(c) }}</span>
              @if (c.crm; as crm) {
                <span class="insignia border-slate-200 bg-slate-50 text-slate-700">🔗 {{ crm.nombre }}</span>
              }
            </div>

            <div class="flex items-center justify-between gap-1.5 border-t border-borde pt-2" (click)="$event.stopPropagation()">
              <div class="flex items-center gap-1.5">
                @if (waFila(c); as w) {
                  <a class="btn-wa btn !px-2.5 !py-1 text-xs" target="_blank" rel="noopener" [href]="w | wa">WhatsApp</a>
                }
                @if (tel(c); as telUrl) {
                  <a class="btn !px-2 !py-1 text-xs" [href]="telUrl" title="Llamar">📞</a>
                }
                <button class="btn !px-2 !py-1 text-xs" (click)="copiar(c.email, 'Correo copiado')" title="Copiar correo">📋</button>
              </div>
              <button class="btn-primario btn !px-3 !py-1 text-xs" (click)="abierta.set(c.uid)">Abrir ficha</button>
            </div>
          </article>
        } @empty {
          <div class="tarjeta p-8 text-center space-y-2">
            <p class="font-bold text-slate-700">Sin resultados</p>
            <p class="text-xs text-slate-500">No encontramos cuentas con estos criterios.</p>
            @if (hayFiltros()) {
              <button class="btn mt-1" (click)="limpiarFiltros()">Limpiar filtros</button>
            }
          </div>
        }
      }
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

    @if (invitando()) {
      <app-modal titulo="Invitar taller" subtitulo="MAZA entra por invitación: cada código sirve para crear una sola cuenta." ancho="34rem" (cerrar)="invitando.set(false)">
        @if (invitacionNueva(); as inv) {
          <div class="space-y-2 rounded border border-emerald-300 bg-emerald-50 p-3">
            <p class="text-xs font-bold uppercase text-emerald-800">Invitación lista · {{ inv.taller }}</p>
            <p class="font-mono text-lg font-bold">{{ inv.codigo }}</p>
            <p class="break-all font-mono text-xs text-slate-600">{{ inv.link }}</p>
            @if (inv.email) {
              @if (inv.correoEnviado) {
                <p class="text-xs font-semibold text-emerald-700">✓ Correo oficial de Taller Fundador enviado a {{ inv.email }} vía Brevo</p>
              } @else {
                <p class="text-xs font-semibold text-amber-700">⚠ No se pudo enviar el correo a {{ inv.email }} (verificar BREVO_API_KEY)</p>
              }
            }
            <textarea class="campo h-28 text-xs" readonly [value]="inv.mensaje"></textarea>
            <div class="flex flex-wrap gap-2">
              <button class="btn-primario btn" (click)="copiar(inv.mensaje, 'Mensaje copiado')">Copiar mensaje</button>
              <a class="btn" [href]="waInvitacion(inv.mensaje)" target="_blank" rel="noreferrer">Abrir WhatsApp</a>
              <button class="btn" (click)="copiar(inv.link, 'Link copiado')">Copiar link</button>
              <button class="btn" (click)="invitacionNueva.set(null)">Otra invitación</button>
            </div>
          </div>
        } @else {
          <div><label class="etiqueta">Nombre del taller</label><input class="campo" [(ngModel)]="invitar.taller" placeholder="Ej.: Taller Central" /></div>
          <div><label class="etiqueta">Correo de destino (opcional, para despacho oficial vía Brevo)</label><input type="email" class="campo" [(ngModel)]="invitar.email" placeholder="Ej.: contacto@tallercentral.cl" /></div>
          <div><label class="etiqueta">Nota (opcional, solo para ti)</label><input class="campo" [(ngModel)]="invitar.nota" placeholder="Ej.: lo conocí en la feria de San Antonio" /></div>
          <button class="btn-primario btn w-full" [disabled]="!invitar.taller.trim() || generandoInvitacion()" (click)="crearInvitacion()">Generar invitación</button>
        }

        <div class="mt-4">
          <p class="etiqueta">Invitaciones ({{ pendientes() }} sin usar)</p>
          <div class="max-h-56 overflow-y-auto rounded border border-borde">
            @for (i of invitaciones(); track i.codigo) {
              <div class="flex items-center justify-between gap-2 border-b border-borde px-2 py-1.5 text-xs last:border-0">
                <div class="min-w-0">
                  <p class="truncate font-bold">{{ i.taller }}</p>
                  <p class="font-mono text-slate-500">
                    {{ i.codigo }} · {{ f(i.creadoEn) }}
                    @if (i.email) {
                      <span class="text-slate-400">· {{ i.email }}</span>
                    }
                  </p>
                </div>

                @if (i.usado) {
                  <span class="insignia bg-emerald-100 text-emerald-800">Usada {{ f(i.usadoEn) }}</span>
                } @else {
                  <div class="flex shrink-0 gap-1">
                    <button class="btn !px-2 !py-1 text-[11px]" (click)="copiar(i.link, 'Link copiado')">Link</button>
                    <button class="btn-peligro btn !px-2 !py-1 text-[11px]" (click)="anularInvitacion(i)">Anular</button>
                  </div>
                }
              </div>
            } @empty {
              <p class="px-2 py-4 text-center text-xs text-slate-500">Todavía no hay invitaciones.</p>
            }
          </div>
        </div>
      </app-modal>
    }

    @if (confirmandoEliminarLote()) {
      <app-modal titulo="Eliminar cuentas seleccionadas" subtitulo="Esta acción no se puede deshacer" ancho="30rem" (cerrar)="cerrarConfirmacionEliminar()">
        <div class="space-y-4">
          <p class="text-sm text-slate-700">
            Vas a borrar permanentemente <b>{{ marcadas().size }}</b> cuentas con todos sus datos (taller, órdenes, clientes, caja, fotos y accesos).
          </p>

          @if (cuentasMarcadasPagando().length; as pagando) {
            <div class="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
              ⚠️ <b>Atención:</b> {{ pagando }} de las cuentas seleccionadas tienen un plan pagado vigente.
            </div>
          }

          <div class="max-h-36 overflow-y-auto rounded border border-borde bg-slate-50 p-2 text-xs">
            <p class="font-semibold text-slate-600 mb-1">Cuentas a eliminar:</p>
            <ul class="space-y-1">
              @for (c of cuentasSeleccionadas(); track c.uid) {
                <li class="font-mono text-slate-700 truncate">• {{ c.nombreTaller || '(sin nombre)' }} ({{ c.email }})</li>
              }
            </ul>
          </div>

          <div>
            <label class="etiqueta">Escribe «{{ fraseConfirmacion() }}» para confirmar:</label>
            <input class="campo" [placeholder]="fraseConfirmacion()" [ngModel]="textoConfirmacionLote()" (ngModelChange)="textoConfirmacionLote.set($event)" [disabled]="eliminandoLote()" />
          </div>

          @if (eliminandoLote()) {
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center space-y-3">
              <div class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-marca-500 border-t-transparent"></div>
              <div>
                <p class="font-bold text-slate-800">Eliminando cuentas en la nube…</p>
                @if (progresoEliminacion(); as p) {
                  <p class="text-xs text-slate-600 mt-1">Procesando {{ p.actual }} de {{ p.total }}:</p>
                  <p class="font-mono text-xs text-slate-700 truncate mt-0.5">{{ p.correo }}</p>
                }
              </div>
              <p class="text-[11px] text-slate-400">Limpiando Firestore, fotos y autenticación. Por favor no cierres esta ventana.</p>
            </div>
          } @else {
            <div class="flex justify-end gap-2">
              <button class="btn" (click)="cerrarConfirmacionEliminar()">Cancelar</button>
              <button class="btn-peligro btn" [disabled]="!puedeConfirmarEliminar()" (click)="ejecutarEliminarLote()">
                Eliminar {{ marcadas().size }} cuentas
              </button>
            </div>
          }
        </div>
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
  readonly chipsModo = [
    { v: '', t: 'Todas' },
    { v: 'pagando', t: '💳 Pagando' },
    { v: 'trial', t: '🚀 En prueba' },
    { v: 'trial_expirado', t: '⚠️ Prueba vencida' },
    { v: 'pro', t: '🛠️ Taller Solo' },
    { v: 'ilimitado', t: '⚡ Taller Pro' },
    { v: 'empresa', t: '🏢 Empresa' },
  ];

  cuentas = signal<Cuenta[]>([]);
  m = signal<any>(null);
  cargando = signal(true);
  q = signal('');
  modo = signal('');
  soloFundadores = signal(false);
  soloVinculadas = signal(false);
  orden = signal('creadoEn');
  abierta = signal<string | null>(null);
  creando = signal(false);
  talleresCrm = signal<Taller[]>([]);
  nueva: any = {};
  marcadas = signal(new Set<string>());
  confirmandoEliminarLote = signal(false);
  textoConfirmacionLote = signal('');
  eliminandoLote = signal(false);
  progresoEliminacion = signal<{ actual: number; total: number; correo: string } | null>(null);
  uso = textoUso; f = fecha; generar = generarClave;
  ok = (x: unknown) => !!x;

  // Invitaciones (talleres fundadores)
  invitando = signal(false);
  invitaciones = signal<Invitacion[]>([]);
  invitacionNueva = signal<(Invitacion & { mensaje: string; correoEnviado?: boolean }) | null>(null);
  generandoInvitacion = signal(false);
  invitar = { taller: '', nota: '', email: '' };
  pendientes = computed(() => this.invitaciones().filter((i) => !i.usado).length);

  cuentasSeleccionadas = computed(() => this.cuentas().filter((c) => this.marcadas().has(c.uid)));
  cuentasMarcadasPagando = computed(() => this.cuentasSeleccionadas().filter((c) => ['pro', 'ilimitado', 'empresa'].includes(c.modo)));
  fraseConfirmacion = computed(() => `ELIMINAR ${this.cuentasSeleccionadas().length}`);
  puedeConfirmarEliminar = computed(() => this.textoConfirmacionLote().trim().toUpperCase() === this.fraseConfirmacion().toUpperCase());

  hayFiltros = computed(() => !!this.q().trim() || !!this.modo() || this.soloFundadores() || this.soloVinculadas());

  kpis = computed(() => {
    const m = this.m();
    const p = m?.porModo || {};
    return [
      {
        id: 'todos',
        titulo: 'Talleres',
        valor: m.talleres,
        subtitulo: `${m.miembros} de equipo`,
        color: 'text-slate-900',
        activo: this.modo() === '' && !this.soloFundadores(),
        accion: () => { this.modo.set(''); this.soloFundadores.set(false); },
      },
      {
        id: 'pagando',
        titulo: 'Pagando',
        valor: m.pagando,
        subtitulo: `Solo ${p.pro || 0} · Pro ${p.ilimitado || 0} · Emp. ${p.empresa || 0}`,
        color: 'text-emerald-700',
        activo: this.modo() === 'pagando',
        accion: () => { this.soloFundadores.set(false); this.modo.set(this.modo() === 'pagando' ? '' : 'pagando'); },
      },
      {
        id: 'trial',
        titulo: 'En prueba',
        valor: p.trial || 0,
        subtitulo: '14 días / 30 órdenes',
        color: 'text-sky-700',
        activo: this.modo() === 'trial',
        accion: () => { this.soloFundadores.set(false); this.modo.set(this.modo() === 'trial' ? '' : 'trial'); },
      },
      {
        id: 'vencida',
        titulo: 'Prueba vencida',
        valor: p.trial_expirado || 0,
        subtitulo: 'para recuperar',
        color: 'text-red-700',
        activo: this.modo() === 'trial_expirado',
        accion: () => { this.soloFundadores.set(false); this.modo.set(this.modo() === 'trial_expirado' ? '' : 'trial_expirado'); },
      },
      {
        id: 'fundadores',
        titulo: 'Fundadores',
        valor: m.fundadores,
        subtitulo: 'de 20 cupos',
        color: 'text-amber-700',
        activo: this.soloFundadores(),
        accion: () => this.soloFundadores.set(!this.soloFundadores()),
      },
    ];
  });

  lista = computed(() => {
    const q = this.q().trim().toLowerCase();
    const modo = this.modo();
    const fund = this.soloFundadores();
    const vinc = this.soloVinculadas();

    const l = this.cuentas().filter((c) => {
      if (modo === 'pagando' && !['pro', 'ilimitado', 'empresa'].includes(c.modo)) return false;
      if (modo && modo !== 'pagando' && c.modo !== modo) return false;
      if (fund && !c.esFundador) return false;
      if (vinc && !c.crm) return false;
      if (q && ![c.nombreTaller, c.email, c.ciudad, c.telefono, c.uid, c.crm?.nombre].some((v) => (v || '').toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });

    if (this.orden() === 'nombre') l.sort((a, b) => (a.nombreTaller || a.email).localeCompare(b.nombreTaller || b.email));
    if (this.orden() === 'vence') l.sort((a, b) => (a.planVigenteHasta || '9999').localeCompare(b.planVigenteHasta || '9999'));
    if (this.orden() === 'uso') l.sort((a, b) => (b.trialOrdenes * 2 + b.trialDiasUsados) - (a.trialOrdenes * 2 + a.trialDiasUsados));
    return l;
  });

  seleccionarChipModo(v: string) {
    this.soloFundadores.set(false);
    this.modo.set(v);
  }

  limpiarFiltros() {
    this.q.set('');
    this.modo.set('');
    this.soloFundadores.set(false);
    this.soloVinculadas.set(false);
  }

  pctPrueba(c: Cuenta): number {
    const pctDias = Math.min(100, Math.round(((c.trialDiasUsados || 0) / 14) * 100));
    const pctOrd = Math.min(100, Math.round(((c.trialOrdenes || 0) / 30) * 100));
    return Math.max(pctDias, pctOrd);
  }

  waFila = (c: Cuenta) => linkWa(c.telefono, `Hola${c.nombreTaller ? ' ' + c.nombreTaller : ''}, te escribo de MAZA.`);
  tel = (c: Cuenta) => telLink(c.telefono);

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

  async abrirInvitar() {
    this.invitar = { taller: '', nota: '', email: '' };
    this.invitacionNueva.set(null);
    this.invitando.set(true);
    await this.cargarInvitaciones();
  }

  async cargarInvitaciones() {
    try { this.invitaciones.set(await this.api.invitaciones()); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async crearInvitacion() {
    this.generandoInvitacion.set(true);
    try {
      this.invitacionNueva.set(await this.api.crearInvitacion(
        this.invitar.taller.trim(),
        this.invitar.nota.trim(),
        this.invitar.email.trim() || undefined
      ));
      this.invitar = { taller: '', nota: '', email: '' };
      await this.cargarInvitaciones();
    } catch (e) { this.sesion.avisar(mensajeError(e), false); }
    finally { this.generandoInvitacion.set(false); }
  }


  async anularInvitacion(i: Invitacion) {
    if (!confirm(`¿Anular la invitación de ${i.taller} (${i.codigo})? El link deja de servir.`)) return;
    try { await this.api.anularInvitacion(i.codigo); this.sesion.avisar('Invitación anulada'); await this.cargarInvitaciones(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }

  async copiar(texto: string, aviso: string) {
    await navigator.clipboard?.writeText(texto).catch(() => {});
    this.sesion.avisar(aviso);
  }

  /** WhatsApp sin número: Rafa elige el contacto. */
  waInvitacion(mensaje: string) { return `https://wa.me/?text=${encodeURIComponent(mensaje)}`; }

  marcar(uid: string) { const s = new Set(this.marcadas()); s.has(uid) ? s.delete(uid) : s.add(uid); this.marcadas.set(s); }
  marcarTodas(on: boolean) { this.marcadas.set(on ? new Set(this.lista().map((c) => c.uid)) : new Set()); }

  abrirConfirmacionEliminar() {
    this.textoConfirmacionLote.set('');
    this.confirmandoEliminarLote.set(true);
  }

  cerrarConfirmacionEliminar() {
    if (this.eliminandoLote()) return;
    this.confirmandoEliminarLote.set(false);
    this.textoConfirmacionLote.set('');
  }

  /** Borrado en lote con indicador visual de progreso en tiempo real. */
  async ejecutarEliminarLote() {
    const sel = this.cuentasSeleccionadas();
    if (!sel.length || !this.puedeConfirmarEliminar()) return;
    this.eliminandoLote.set(true);
    let ok = 0;
    try {
      for (let i = 0; i < sel.length; i++) {
        const c = sel[i];
        this.progresoEliminacion.set({ actual: i + 1, total: sel.length, correo: c.email || c.nombreTaller });
        try {
          await this.api.eliminarCuenta(c.uid, c.email);
          ok++;
        } catch (e) {
          this.sesion.avisar(`${c.email}: ${mensajeError(e)}`, false);
        }
      }
      this.sesion.avisar(`${ok} de ${sel.length} cuentas eliminadas`);
      this.marcadas.set(new Set());
      this.confirmandoEliminarLote.set(false);
      await this.cargar();
    } finally {
      this.eliminandoLote.set(false);
      this.progresoEliminacion.set(null);
    }
  }

  async sincronizar() {
    try { const r = await this.api.sincronizar(); this.sesion.avisar(r.cambios ? `${r.cambios} talleres cambiaron de etapa` : 'El embudo ya estaba al día'); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }
}
