import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

/** Ventana modal con encabezado de consola; en celular ocupa la pantalla. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 sm:p-4" (click)="cerrar.emit()">
      <div class="tarjeta my-0 w-full overflow-hidden sm:my-6" [style.max-width]="ancho()" (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between gap-3 border-b border-borde bg-[#f3f3f3] px-4 py-3 sm:px-5">
          <div class="min-w-0">
            <ng-content select="[encabezado]" />
            @if (titulo()) { <h2 class="text-lg font-bold text-slate-900">{{ titulo() }}</h2> }
            @if (subtitulo()) { <p class="text-xs text-slate-500">{{ subtitulo() }}</p> }
          </div>
          <button class="rounded p-1.5 text-slate-500 hover:bg-slate-200" (click)="cerrar.emit()" aria-label="Cerrar">✕</button>
        </div>
        <div class="max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto p-4 sm:max-h-[75vh] sm:p-5">
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class Modal {
  titulo = input('');
  subtitulo = input('');
  ancho = input('42rem');
  cerrar = output<void>();

  @HostListener('document:keydown.escape') esc() { this.cerrar.emit(); }
}
