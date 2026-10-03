import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Ajustes } from '../core/ajustes';

/** Pantalla de PIN: tapa la app al abrirla y tras X minutos en segundo plano. */
@Component({
  selector: 'app-bloqueo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-marca-800 p-6 text-white">
      <img src="icons/icon-96x96.png" alt="" class="h-16 w-16 rounded-xl" />
      <p class="text-lg font-bold">Ingresa tu PIN</p>
      <div class="flex gap-3" [class.animate-pulse]="error()">
        @for (i of [0, 1, 2, 3, 4, 5].slice(0, largo()); track i) {
          <span class="h-3.5 w-3.5 rounded-full border-2 border-white" [class.bg-white]="i < pin().length"></span>
        }
      </div>
      <p class="h-4 text-sm text-red-300">{{ error() ? 'PIN incorrecto' : '' }}</p>
      <div class="grid grid-cols-3 gap-3">
        @for (n of teclas; track n) {
          @if (n === '') { <span></span> } @else {
            <button class="h-16 w-16 rounded-full bg-white/10 text-2xl font-semibold active:bg-white/25" (click)="tecla(n)">{{ n }}</button>
          }
        }
      </div>
    </div>
  `,
  host: { '(document:keydown)': 'teclado($event)' },
})
export class Bloqueo {
  private ajustes = inject(Ajustes);
  readonly teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  pin = signal('');
  error = signal(false);
  // El largo del PIN no se guarda: se aceptan 4 a 6 dígitos y se prueba al llegar a cada uno.
  largo = signal(6);

  async tecla(t: string) {
    this.error.set(false);
    if (t === '⌫') { this.pin.update((p) => p.slice(0, -1)); return; }
    if (this.pin().length >= 6) return;
    this.pin.update((p) => p + t);
    if (this.pin().length >= 4 && (await this.ajustes.desbloquear(this.pin()))) { this.pin.set(''); return; }
    if (this.pin().length === 6) { this.error.set(true); this.pin.set(''); }
  }

  teclado(e: KeyboardEvent) {
    if (/^\d$/.test(e.key)) this.tecla(e.key);
    else if (e.key === 'Backspace') this.tecla('⌫');
  }
}
