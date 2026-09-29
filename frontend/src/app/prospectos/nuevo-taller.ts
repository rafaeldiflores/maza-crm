import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Sesion, mensajeError } from '../core/api';
import { Presets } from '../core/modelos';
import { Modal } from '../compartido/modal';

@Component({
  selector: 'app-nuevo-taller',
  imports: [FormsModule, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal titulo="Agregar taller" subtitulo="Referidos o contactos directos que no vienen de Google" ancho="28rem" (cerrar)="cerrar.emit()">
      <div><label class="etiqueta">Nombre *</label><input class="campo" [(ngModel)]="d.nombre" /></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="etiqueta">Comuna *</label><input class="campo" [(ngModel)]="d.comuna" /></div>
        <div><label class="etiqueta">Rubro</label>
          <select class="campo" [(ngModel)]="d.rubro">@for (r of rubros(); track r) { <option [value]="r">{{ r }}</option> }</select></div>
      </div>
      <div><label class="etiqueta">Dirección</label><input class="campo" [(ngModel)]="d.direccion" /></div>
      <div><label class="etiqueta">Correo</label><input type="email" class="campo" placeholder="dueño@gmail.com" [(ngModel)]="d.email" /></div>
      <div><label class="etiqueta">Teléfono</label><input class="campo font-mono" placeholder="+56912345678" [(ngModel)]="d.telefono" /></div>
      <button class="btn-primario btn w-full !py-2.5" (click)="guardar()">Agregar al CRM</button>
    </app-modal>
  `,
})
export class NuevoTaller {
  private api = inject(Api);
  private sesion = inject(Sesion);
  presets = input<Presets | null>(null);
  cerrar = output<void>();
  creado = output<void>();
  d = { nombre: '', comuna: '', rubro: 'General', direccion: '', telefono: '', email: '' };
  rubros = computed(() => ['General', ...Object.values(this.presets()?.rubros ?? {}).map((r) => r.nombre)]);

  async guardar() {
    if (!this.d.nombre.trim() || !this.d.comuna.trim()) { this.sesion.avisar('Nombre y comuna son obligatorios', false); return; }
    try { await this.api.crearTaller(this.d); this.sesion.avisar('Taller agregado'); this.creado.emit(); }
    catch (e) { this.sesion.avisar(mensajeError(e), false); }
  }
}
