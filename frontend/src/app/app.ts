import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Sesion } from './core/api';
import { Ajustes } from './core/ajustes';
import { RutaEnCurso } from './core/ruta-en-curso';
import { Bloqueo } from './compartido/bloqueo';
import { PanelRuta } from './compartido/panel-ruta';

interface Pestana { texto: string; ruta: string; admin: boolean; icono: string }

const PESTANAS: Pestana[] = [
  { texto: 'Prospectos', ruta: '/prospectos', admin: false, icono: '🎯' },
  { texto: 'Hoy', ruta: '/hoy', admin: true, icono: '📞' },
  { texto: 'Cuentas', ruta: '/cuentas', admin: true, icono: '👥' },
  { texto: 'Cobros', ruta: '/cobros', admin: true, icono: '💳' },
  { texto: 'Métricas', ruta: '/metricas', admin: true, icono: '📊' },
  { texto: 'Consumo IA', ruta: '/consumo-ia', admin: true, icono: '✨' },
  { texto: 'Soporte', ruta: '/soporte', admin: true, icono: '🎫' },
  { texto: 'Errores', ruta: '/errores', admin: true, icono: '⚠️' },
  { texto: 'Auditoría', ruta: '/auditoria', admin: true, icono: '📜' },
  { texto: 'Configuración', ruta: '/configuracion', admin: false, icono: '⚙️' },
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
      <!-- Pestañas de escritorio (en móvil se ocultan para dar paso a la barra inferior) -->
      <nav class="hidden md:flex overflow-x-auto border-b-[3px] border-marca-500 bg-white px-2">
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

    <main class="mx-auto max-w-7xl p-2 pb-24 sm:p-4 md:pb-4">
      <router-outlet />
    </main>

    <!-- Barra de navegación inferior nativa para móviles (PWA en terreno) -->
    <nav class="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-borde bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur-md md:hidden">
      <!-- 1: Prospectos -->
      <a routerLink="/prospectos" routerLinkActive="!text-marca-800 font-bold"
         class="flex flex-1 flex-col items-center justify-center py-1 text-slate-500 transition-colors">
        <span class="text-lg leading-none">🎯</span>
        <span class="mt-1 text-[11px]">Prospectos</span>
      </a>

      <!-- 2: Hoy -->
      @if (sesion.salud()?.admin !== false) {
        <a routerLink="/hoy" routerLinkActive="!text-marca-800 font-bold"
           class="flex flex-1 flex-col items-center justify-center py-1 text-slate-500 transition-colors">
          <span class="text-lg leading-none">📞</span>
          <span class="mt-1 text-[11px]">Hoy</span>
        </a>
      }

      <!-- 3: Cuentas -->
      @if (sesion.salud()?.admin !== false) {
        <a routerLink="/cuentas" routerLinkActive="!text-marca-800 font-bold"
           class="flex flex-1 flex-col items-center justify-center py-1 text-slate-500 transition-colors">
          <span class="text-lg leading-none">👥</span>
          <span class="mt-1 text-[11px]">Cuentas</span>
        </a>
      }

      <!-- 4: Ruta activa -->
      <button type="button" (click)="abrirRuta()"
              class="flex flex-1 flex-col items-center justify-center py-1 text-slate-500 transition-colors"
              [class.!text-marca-800]="rutaEnCurso.ruta()">
        <span class="text-lg leading-none">🧭</span>
        <span class="mt-1 text-[11px]">
          @if (rutaEnCurso.ruta(); as r) {
            Ruta {{ rutaEnCurso.hechas() }}/{{ r.paradas.length }}
          } @else {
            Ruta
          }
        </span>
      </button>

      <!-- 5: Más opciones -->
      <button type="button" (click)="menuMas.set(!menuMas())"
              class="flex flex-1 flex-col items-center justify-center py-1 text-slate-500 transition-colors"
              [class.!text-marca-800]="menuMas()">
        <span class="text-lg leading-none">☰</span>
        <span class="mt-1 text-[11px]">Más</span>
      </button>
    </nav>

    <!-- Drawer emergente "Más" para móviles -->
    @if (menuMas()) {
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs md:hidden" (click)="menuMas.set(false)"></div>
      <div class="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-borde bg-white p-4 shadow-2xl space-y-4 md:hidden">
        <div class="flex items-center justify-between border-b border-borde pb-3">
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Menú del sistema</p>
            <p class="font-bold text-slate-800 text-sm truncate max-w-[240px]">{{ sesion.salud()?.usuario || 'MAZA CRM' }}</p>
          </div>
          <button class="h-8 w-8 rounded-full bg-slate-100 grid place-items-center text-slate-500 hover:bg-slate-200 font-bold" (click)="menuMas.set(false)">✕</button>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          @for (p of pestanasSecundarias(); track p.ruta) {
            <a [routerLink]="p.ruta" (click)="menuMas.set(false)"
               class="flex items-center gap-2.5 rounded-lg border border-borde bg-slate-50 p-2.5 font-semibold text-slate-700 hover:bg-marca-50 hover:text-marca-800 hover:border-marca-200 transition-all">
              <span class="text-base">{{ p.icono }}</span>
              <span class="truncate">{{ p.texto }}</span>
            </a>
          }
        </div>

        <div class="border-t border-borde pt-3 flex items-center justify-between text-xs">
          <span class="text-slate-400">MAZA CRM PWA</span>
          <a href="/_gcp_iap/clear_login_cookie" class="font-semibold text-red-600 hover:text-red-700 py-1 px-2 rounded hover:bg-red-50">
            Cerrar sesión
          </a>
        </div>
      </div>
    }

    <app-panel-ruta />
    @if (ajustes.bloqueada()) { <app-bloqueo /> }

    @if (sesion.toast(); as t) {
      <div class="fixed bottom-20 md:bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-2xl backdrop-blur-sm border transition-all duration-300"
           [class]="t.ok ? 'bg-emerald-800/95 border-emerald-600' : 'bg-red-700/95 border-red-500'">
        <span class="text-base leading-none">{{ t.ok ? '✓' : '⚠️' }}</span>
        <span>{{ t.texto }}</span>
      </div>
    }
  `,
})
export class App implements OnInit {
  protected sesion = inject(Sesion);
  protected ajustes = inject(Ajustes);
  protected rutaEnCurso = inject(RutaEnCurso);

  menuMas = signal(false);

  protected pestanas = computed(() => PESTANAS.filter((p) => !p.admin || this.sesion.salud()?.admin !== false));
  protected pestanasSecundarias = computed(() =>
    this.pestanas().filter((p) => !['/prospectos', '/hoy', '/cuentas'].includes(p.ruta))
  );

  abrirRuta() {
    if (this.rutaEnCurso.ruta()) {
      this.rutaEnCurso.abierta.set(true);
    } else {
      this.sesion.avisar('Planifica una ruta activa en Prospectos > Plan de ruta');
    }
  }

  ngOnInit() {
    this.sesion.cargar();
    this.ajustes.cargarGeneral();
  }
}
