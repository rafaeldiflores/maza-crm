import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Estado, ETAPAS, Presets, Taller } from '../core/modelos';
import { telLink, tieneWa, waPorDefecto } from '../core/utiles';

const COLOR_HEX: Record<Estado, string> = {
  'Por consultar': '#3b82f6', // Azul
  'Contactado': '#f59e0b',    // Ámbar
  'Interesado': '#14b8a6',    // Teal / Turquesa
  'En prueba 14 días': '#a855f7', // Púrpura
  'Cliente Activo': '#10b981', // Esmeralda
  'Descartado': '#94a3b8',    // Pizarra / Gris
};

const CENTROIDES_COMUNAS: Record<string, [number, number]> = {
  'santiago': [-33.4489, -70.6693],
  'providencia': [-33.4314, -70.6093],
  'las condes': [-33.4116, -70.5480],
  'ñuñoa': [-33.4569, -70.5980],
  'nunoa': [-33.4569, -70.5980],
  'vitacura': [-33.3820, -70.5750],
  'la reina': [-33.4410, -70.5350],
  'lo barnechea': [-33.3540, -70.5150],
  'maipu': [-33.5110, -70.7580],
  'maipú': [-33.5110, -70.7580],
  'pudahuel': [-33.4410, -70.7600],
  'cerrillos': [-33.5000, -70.7100],
  'estacion central': [-33.4580, -70.6980],
  'estación central': [-33.4580, -70.6980],
  'quinta normal': [-33.4300, -70.6930],
  'lo prado': [-33.4440, -70.7250],
  'cerro navia': [-33.4240, -70.7350],
  'la florida': [-33.5220, -70.5980],
  'puente alto': [-33.6110, -70.5750],
  'peñalolen': [-33.4860, -70.5480],
  'peñalolén': [-33.4860, -70.5480],
  'macul': [-33.4910, -70.6010],
  'san joaquin': [-33.4930, -70.6280],
  'san joaquín': [-33.4930, -70.6280],
  'san miguel': [-33.4950, -70.6510],
  'la cisterna': [-33.5280, -70.6620],
  'la granja': [-33.5350, -70.6210],
  'san ramon': [-33.5380, -70.6440],
  'san ramón': [-33.5380, -70.6440],
  'la pintana': [-33.5820, -70.6310],
  'el bosque': [-33.5610, -70.6720],
  'pedro aguirre cerda': [-33.4850, -70.6780],
  'lo espejo': [-33.5210, -70.6900],
  'recoleta': [-33.4070, -70.6380],
  'independencia': [-33.4180, -70.6620],
  'conchali': [-33.3830, -70.6780],
  'conchalí': [-33.3830, -70.6780],
  'huechuraba': [-33.3740, -70.6380],
  'quilicura': [-33.3640, -70.7280],
  'renca': [-33.4030, -70.7290],
  'san bernardo': [-33.5920, -70.7020],
  'buin': [-33.7320, -70.7420],
  'paine': [-33.8080, -70.7410],
  'calera de tango': [-33.6350, -70.7850],
  'talagante': [-33.6640, -70.9270],
  'peñaflor': [-33.6060, -70.8780],
  'penaflor': [-33.6060, -70.8780],
  'el monte': [-33.6810, -70.9810],
  'isla de maipo': [-33.7500, -70.9000],
  'melipilla': [-33.6850, -71.2140],
  'curacavi': [-33.4040, -71.1350],
  'curacaví': [-33.4040, -71.1350],
  'colina': [-33.2030, -70.6750],
  'lampa': [-33.2840, -70.8710],
  'padre hurtado': [-33.5710, -70.8170],
  'pirque': [-33.6330, -70.5600],
  'san jose de maipo': [-33.6400, -70.3500],
  'san josé de maipo': [-33.6400, -70.3500],
  'viña del mar': [-33.0245, -71.5518],
  'vina del mar': [-33.0245, -71.5518],
  'valparaiso': [-33.0472, -71.6127],
  'valparaíso': [-33.0472, -71.6127],
  'quilpue': [-33.0494, -71.4428],
  'quilpué': [-33.0494, -71.4428],
  'villa alemana': [-33.0425, -71.3734],
  'concon': [-32.9234, -71.5173],
  'concón': [-32.9234, -71.5173],
  'quillota': [-32.8804, -71.2482],
  'la calera': [-32.7876, -71.1895],
  'limache': [-33.0150, -71.2680],
  'san felipe': [-32.7506, -70.7256],
  'los andes': [-32.8339, -70.5983],
  'el quisco': [-33.3980, -71.6980],
  'algarrobo': [-33.3680, -71.6680],
  'el tabo': [-33.4560, -71.6660],
  'cartagena': [-33.5530, -71.6080],
  'san antonio': [-33.5930, -71.6170],
  'santo domingo': [-33.6380, -71.6280],
  'rancagua': [-34.1708, -70.7444],
  'machali': [-34.1830, -70.6500],
  'machalí': [-34.1830, -70.6500],
  'graneros': [-34.0667, -70.7167],
  'rengo': [-34.4069, -70.8594],
  'san fernando': [-34.5839, -70.9889],
  'concepcion': [-36.8270, -73.0503],
  'concepción': [-36.8270, -73.0503],
  'temuco': [-38.7359, -72.5904],
  'la serena': [-29.9027, -71.2519],
  'coquimbo': [-29.9533, -71.3436],
  'antofagasta': [-23.6509, -70.3975],
  'iquique': [-20.2167, -70.1436],
  'puerto montt': [-41.4693, -72.9424],
};

function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

@Component({
  selector: 'app-mapa',
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2">
      <!-- Barra superior del mapa con leyenda rápida y geolocalización -->
      <div class="tarjeta flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white">
        <!-- Filtros por etapa sobre el mapa -->
        <div class="flex flex-wrap items-center gap-1 text-xs">
          <button
            class="rounded-full px-2.5 py-1 text-xs font-semibold transition-all border"
            [class]="filtroEstado() === 'Todos' ? 'bg-marca-800 text-white border-marca-800 shadow-2xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'"
            (click)="filtroEstado.set('Todos')"
          >
            Todos ({{ talleres().length }})
          </button>

          @for (e of etapasFiltro; track e) {
            <button
              class="rounded-full px-2.5 py-1 text-xs font-semibold transition-all border inline-flex items-center gap-1.5"
              [class]="filtroEstado() === e ? 'bg-slate-900 text-white border-slate-900 shadow-2xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'"
              (click)="filtroEstado.set(e)"
            >
              <span class="h-2 w-2 rounded-full" [style.background-color]="colorHex(e)"></span>
              <span>{{ e }}</span>
              <span class="opacity-70 text-[10px]">({{ conteoEstado()[e] || 0 }})</span>
            </button>
          }
        </div>

        <!-- Botón GPS "Radar del Merodeador" -->
        <div class="flex items-center gap-2">
          <button
            class="btn shadow-2xs transition-all active:scale-95"
            [class.!border-blue-400]="gpsActivo()"
            [class.!bg-blue-50]="gpsActivo()"
            [class.!text-blue-800]="gpsActivo()"
            (click)="toggleGps()"
            [title]="gpsActivo() ? 'GPS activo. Clic para centrar.' : 'Ubicar mi posición actual en el mapa'"
          >
            @if (gpsBuscando()) {
              <span class="animate-spin text-blue-600">🌀</span>
              <span>Buscando satélites…</span>
            } @else if (gpsActivo()) {
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
              </span>
              <span class="font-bold">📍 Mi posición</span>
            } @else {
              <span>📍</span>
              <span>Mi posición GPS</span>
            }
          </button>

          <span class="hidden sm:inline text-[11px] font-bold text-slate-400">
            {{ talleresVisibles().length }} pines
          </span>
        </div>
      </div>

      <!-- Lienzo interactivo de Leaflet -->
      <div class="relative w-full rounded-xl border border-borde overflow-hidden shadow-xs bg-slate-100">
        <div #mapContainer class="h-[calc(100vh-270px)] min-h-[460px] w-full z-0"></div>

        <!-- Banner flotante con sugerencia de uso en terreno -->
        <div class="absolute bottom-2 left-2 z-[400] max-w-sm rounded-lg border border-slate-200/80 bg-white/90 p-2 shadow-sm backdrop-blur-xs text-[11px] text-slate-600 hidden sm:flex items-center gap-2">
          <span class="text-base select-none">🗺️</span>
          <span><strong>Mapa del Merodeador:</strong> Toca cualquier pin para ver el taller, llamar, abrir WhatsApp o registrar tu visita al instante.</span>
        </div>
      </div>
    </div>
  `,
})
export class MapaProspectos implements OnInit, OnDestroy {
  mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  talleres = input<Taller[]>([]);
  presets = input<Presets | null>(null);
  abrirFicha = output<number>();
  abrirVisita = output<number>();

  filtroEstado = signal<string>('Todos');
  gpsActivo = signal<boolean>(false);
  gpsBuscando = signal<boolean>(false);
  ubicacionUsuario = signal<{ lat: number; lng: number } | null>(null);

  readonly etapasFiltro: Estado[] = [
    'Por consultar',
    'Contactado',
    'Interesado',
    'En prueba 14 días',
    'Cliente Activo',
  ];

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private userMarker: L.Marker | null = null;
  private userRadiusCircle: L.Circle | null = null;
  private clickListener: ((e: MouseEvent) => void) | null = null;

  conteoEstado = computed(() => {
    const counts: Record<string, number> = {};
    for (const t of this.talleres()) {
      counts[t.estado] = (counts[t.estado] || 0) + 1;
    }
    return counts;
  });

  talleresVisibles = computed(() => {
    const f = this.filtroEstado();
    if (f === 'Todos') return this.talleres();
    return this.talleres().filter((t) => t.estado === f);
  });

  constructor() {
    // Re-render markers whenever the filtered list or user location changes
    effect(() => {
      const lista = this.talleresVisibles();
      const userLoc = this.ubicacionUsuario();
      if (this.map && this.markersLayer) {
        this.renderizarMarcadores(lista, userLoc);
      }
    });

    // Handle map container mounting
    effect(() => {
      const container = this.mapContainer()?.nativeElement;
      if (container && !this.map) {
        // Run in next microtask to let DOM compute sizes
        setTimeout(() => this.inicializarMapa(container), 20);
      }
    });
  }

  ngOnInit() {}

  ngOnDestroy() {
    if (this.clickListener && this.mapContainer()?.nativeElement) {
      this.mapContainer()?.nativeElement.removeEventListener('click', this.clickListener);
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  colorHex(estado: Estado): string {
    return COLOR_HEX[estado] || '#64748b';
  }

  private inicializarMapa(contenedor: HTMLDivElement) {
    if (this.map) return;

    // Centro inicial: Santiago de Chile
    const santiagoCentro: [number, number] = [-33.4489, -70.6693];

    this.map = L.map(contenedor, {
      center: santiagoCentro,
      zoom: 12,
      zoomControl: true,
    });

    // Tiles libres de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);

    // Escuchar clics en botones de acción dentro de popups mediante delegación de eventos
    this.clickListener = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const btn = target.closest('[data-action]') as HTMLElement;
      if (btn) {
        const id = Number(btn.getAttribute('data-taller-id'));
        const action = btn.getAttribute('data-action');
        if (id) {
          if (action === 'ficha') {
            this.abrirFicha.emit(id);
          } else if (action === 'visita') {
            this.abrirVisita.emit(id);
          }
        }
      }
    };
    contenedor.addEventListener('click', this.clickListener);

    // Renderizar talleres actuales
    this.renderizarMarcadores(this.talleresVisibles(), this.ubicacionUsuario());

    // Ajustar vista después de carga
    setTimeout(() => {
      this.map?.invalidateSize();
    }, 150);
  }

  private obtenerCoordenadas(t: Taller): [number, number] {
    if (t.lat != null && t.lng != null && !isNaN(t.lat) && !isNaN(t.lng) && t.lat !== 0 && t.lng !== 0) {
      return [t.lat, t.lng];
    }

    const comunaPlana = (t.comuna || '').trim().toLowerCase();
    const centro = CENTROIDES_COMUNAS[comunaPlana] || CENTROIDES_COMUNAS['santiago'];

    // Jitter determinista para que talleres en la misma comuna no se oculten exactamente uno sobre otro
    const angle = ((t.id * 137.5) % 360) * (Math.PI / 180);
    const radius = 0.002 + ((t.id * 43) % 100) / 100 * 0.007; // ~200 - 900 metros
    const lat = centro[0] + Math.sin(angle) * radius;
    const lng = centro[1] + Math.cos(angle) * radius;

    return [lat, lng];
  }

  private renderizarMarcadores(talleres: Taller[], userLoc: { lat: number; lng: number } | null) {
    if (!this.map || !this.markersLayer) return;

    this.markersLayer.clearLayers();

    if (!talleres.length) return;

    const bounds = L.latLngBounds([]);

    for (const t of talleres) {
      const coords = this.obtenerCoordenadas(t);
      bounds.extend(coords);

      const color = COLOR_HEX[t.estado] || '#64748b';

      const icon = L.divIcon({
        className: 'marcador-taller',
        iconSize: [28, 36],
        iconAnchor: [14, 36],
        popupAnchor: [0, -36],
        html: `
          <div class="relative flex flex-col items-center cursor-pointer transition-transform duration-150 hover:scale-125" title="${escapeHtml(t.nombre)}">
            <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
              <path d="M14 0C6.268 0 0 6.268 0 14C0 23.5 14 36 14 36C14 36 28 23.5 28 14C28 6.268 21.732 0 14 0Z" fill="${color}"/>
              <circle cx="14" cy="13" r="7.5" fill="white"/>
              <circle cx="14" cy="13" r="4.5" fill="${color}"/>
            </svg>
          </div>
        `,
      });

      let dist: number | null = null;
      if (userLoc) {
        dist = distanciaKm(userLoc.lat, userLoc.lng, coords[0], coords[1]);
      }

      const popupHtml = this.generarPopupHtml(t, coords, dist);

      const marker = L.marker(coords, { icon });
      marker.bindPopup(popupHtml, {
        closeButton: true,
        maxWidth: 320,
        className: 'popup-merodeador',
      });

      this.markersLayer.addLayer(marker);
    }

    // Si no hay GPS activo o usuario reciente, ajustar bounds para ver los prospectos
    if (!userLoc && bounds.isValid() && talleres.length > 0) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  private generarPopupHtml(t: Taller, coords: [number, number], distKm: number | null): string {
    const telUrl = telLink(t.telefono);
    const waUrl = tieneWa(t) ? waPorDefecto(t, this.presets()) : null;
    const color = COLOR_HEX[t.estado] || '#64748b';
    const mapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords[0]},${coords[1]}`;

    const distBadge =
      distKm !== null
        ? `<span class="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
             <span>📍</span> a ${distKm < 1 ? Math.round(distKm * 1000) + ' m' : distKm.toFixed(1) + ' km'}
           </span>`
        : '';

    return `
      <div class="p-3 text-slate-800 text-xs">
        <div class="flex items-center justify-between gap-1.5 mb-1.5">
          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style="background-color: ${color}15; color: ${color}; border: 1px solid ${color}40;">
            ${escapeHtml(t.estado)}
          </span>
          ${distBadge}
        </div>

        <h3 class="text-sm font-bold text-slate-900 leading-tight mb-0.5">${escapeHtml(t.nombre)}</h3>
        <p class="text-slate-500 text-[11px] mb-2">
          📍 ${escapeHtml(t.direccion || t.comuna)} ${t.comuna && t.direccion ? '(' + escapeHtml(t.comuna) + ')' : ''}
        </p>

        <div class="flex flex-wrap items-center gap-1.5 mb-2.5">
          <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
            🔧 ${escapeHtml(t.rubro || 'General')}
          </span>
          ${
            t.calificacion && t.calificacion !== 'S/C'
              ? `<span class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                   ★ ${escapeHtml(t.calificacion)} <span class="font-normal text-slate-400">(${escapeHtml(t.opiniones)})</span>
                 </span>`
              : ''
          }
          ${
            t.puntaje_ia != null
              ? `<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                   🎯 Prioridad ${t.puntaje_ia}
                 </span>`
              : ''
          }
        </div>

        <!-- Acciones directas de contacto -->
        <div class="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100 mb-2">
          ${
            waUrl
              ? `<a href="${waUrl}" target="_blank" rel="noopener"
                   class="flex items-center justify-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1 px-2 text-[11px] shadow-2xs no-underline transition-all">
                  <span>💬</span> WhatsApp
                </a>`
              : `<span class="flex items-center justify-center rounded bg-slate-100 text-slate-400 text-[11px] py-1 px-2 select-none">
                  Sin WhatsApp
                </span>`
          }
          ${
            telUrl
              ? `<a href="${telUrl}"
                   class="flex items-center justify-center gap-1 rounded bg-slate-800 hover:bg-slate-900 text-white font-bold py-1 px-2 text-[11px] shadow-2xs no-underline transition-all">
                  <span>📞</span> Llamar
                </a>`
              : `<span class="flex items-center justify-center rounded bg-slate-100 text-slate-400 text-[11px] py-1 px-2 select-none">
                  Sin teléfono
                </span>`
          }
        </div>

        <!-- Acciones operativas: Visita rápida y Ficha completa -->
        <div class="flex items-center gap-1.5">
          <button data-action="visita" data-taller-id="${t.id}"
                  class="flex-1 flex items-center justify-center gap-1 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold py-1.5 px-2 text-[11px] transition-colors cursor-pointer active:scale-98">
            <span>🎙️</span> Visita
          </button>
          <button data-action="ficha" data-taller-id="${t.id}"
                  class="flex-1 flex items-center justify-center gap-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-2 text-[11px] shadow-2xs transition-colors cursor-pointer active:scale-98">
            <span>👁️</span> Ficha
          </button>
        </div>

        <div class="mt-2 text-center">
          <a href="${mapsDirUrl}" target="_blank" rel="noopener"
             class="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 hover:underline">
            <span>🧭</span> Cómo llegar en Google Maps
          </a>
        </div>
      </div>
    `;
  }

  toggleGps() {
    if (!navigator.geolocation) {
      alert('Tu navegador o dispositivo no soporta geolocalización GPS.');
      return;
    }

    if (this.gpsActivo() && this.ubicacionUsuario() && this.map) {
      const loc = this.ubicacionUsuario()!;
      this.map.flyTo([loc.lat, loc.lng], 15, { duration: 1 });
      return;
    }

    this.gpsBuscando.set(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.gpsBuscando.set(false);
        this.gpsActivo.set(true);

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.ubicacionUsuario.set({ lat, lng });

        if (this.map) {
          // Crear o mover marcador del radar de usuario
          if (this.userMarker) {
            this.userMarker.setLatLng([lat, lng]);
          } else {
            const radarIcon = L.divIcon({
              className: 'marcador-radar-usuario',
              iconSize: [36, 36],
              iconAnchor: [18, 18],
              html: `
                <div class="relative flex items-center justify-center w-9 h-9">
                  <div class="absolute w-9 h-9 rounded-full bg-blue-500/35 animate-ping"></div>
                  <div class="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-lg z-10"></div>
                </div>
              `,
            });

            this.userMarker = L.marker([lat, lng], { icon: radarIcon, zIndexOffset: 1000 })
              .bindTooltip('📍 Estás aquí', { permanent: false, direction: 'top' })
              .addTo(this.map);
          }

          if (this.userRadiusCircle) {
            this.userRadiusCircle.setLatLng([lat, lng]);
            this.userRadiusCircle.setRadius(pos.coords.accuracy || 100);
          } else {
            this.userRadiusCircle = L.circle([lat, lng], {
              radius: pos.coords.accuracy || 100,
              color: '#3b82f6',
              fillColor: '#3b82f6',
              fillOpacity: 0.08,
              weight: 1,
            }).addTo(this.map);
          }

          this.map.flyTo([lat, lng], 15, { duration: 1.2 });
        }
      },
      (err) => {
        this.gpsBuscando.set(false);
        this.gpsActivo.set(false);
        console.warn('Error al obtener GPS:', err);
        alert('No se pudo obtener tu ubicación GPS. Asegúrate de dar permisos de localización.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 10000,
      }
    );
  }
}
