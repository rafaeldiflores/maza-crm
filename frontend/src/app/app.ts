import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Sesion } from './core/api';
import { Ajustes } from './core/ajustes';
import { Bloqueo } from './compartido/bloqueo';
import { PanelRuta } from './compartido/panel-ruta';

interface Pestana { texto: string; ruta: string; admin: boolean }

const PESTANAS: Pestana[] = [
  { texto: 'Prospectos', ruta: '/prospectos', admin: false },
  { texto: 'Hoy', ruta: '/hoy', admin: true },
  { texto: 'Cuentas', ruta: '/cuentas', admin: true },
  { texto: 'Cobros', ruta: '/cobros', admin: true },
  { texto: 'Métricas', ruta: '/metricas', admin: true },
  { texto: 'Soporte', ruta: '/soporte', admin: true },
  { texto: 'Errores', ruta: '/errores', admin: true },
  { texto: 'Auditoría', ruta: '/auditoria', admin: true },
  { texto: 'Configuración', ruta: '/configuracion', admin: false },
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Bloqueo, PanelRuta],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-40">
      <div class="flex h-11 items-center justify-between bg-marca-800 px-4 text-white">
        <div class="flex items-center gap-2 font-bold tracking-tight">
          <img src="icons/icon-72x72.png" alt="" class="h-7 w-7 rounded" /> MAZA CRM
        </div>
        <div class="flex items-center gap-3 text-xs">
          <span class="hidden opacity-80 sm:inline">{{ sesion.salud()?.usuario }}</span>
          <a href="/_gcp_iap/clear_login_cookie" class="rounded border border-white/30 px-2 py-1 hover:bg-white/10">Salir</a>
        </div>
      </div>
      <nav class="flex overflow-x-auto border-b-[3px] border-marca-500 bg-white px-2">
        @for (p of pestanas(); track p.ruta) {
          <a [routerLink]="p.ruta" routerLinkActive="!border-marca-800 bg-marca-50 font-bold"
             class="-mb-[3px] inline-flex h-10 shrink-0 items-center border-b-[3px] border-transparent px-3.5 text-[13px] hover:bg-fondo">{{ p.texto }}</a>
        }
      </nav>
    </header>

    @if (sesion.salud(); as s) {
      @if (!s.ok) {
        <div class="bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white">No se pudo cargar el CRM: {{ s.error }}</div>
      }
    }

    <main class="mx-auto max-w-7xl p-2 sm:p-4">
      <router-outlet />
    </main>

    <app-panel-ruta />
    @if (ajustes.bloqueada()) { <app-bloqueo /> }

    @if (sesion.toast(); as t) {
      <div class="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-md px-4 py-2 text-sm font-semibold text-white shadow-lg"
           [class]="t.ok ? 'bg-emerald-700' : 'bg-red-600'">{{ t.texto }}</div>
    }
  `,
})
export class App implements OnInit {
  protected sesion = inject(Sesion);
  protected ajustes = inject(Ajustes);
  protected pestanas = computed(() => PESTANAS.filter((p) => !p.admin || this.sesion.salud()?.admin !== false));

  ngOnInit() {
    this.sesion.cargar();
    this.ajustes.cargarGeneral();
  }
}
