import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'prospectos' },
  { path: 'prospectos', loadComponent: () => import('./prospectos/prospectos').then((m) => m.Prospectos) },
  { path: 'hoy', loadComponent: () => import('./cuentas/hoy').then((m) => m.Hoy) },
  { path: 'cuentas', loadComponent: () => import('./cuentas/cuentas').then((m) => m.Cuentas) },
  { path: 'cobros', loadComponent: () => import('./cuentas/paneles').then((m) => m.Cobros) },
  { path: 'metricas', loadComponent: () => import('./cuentas/paneles').then((m) => m.Metricas) },
  { path: 'consumo-ia', loadComponent: () => import('./cuentas/consumo-ia').then((m) => m.ConsumoIa) },
  { path: 'soporte', loadComponent: () => import('./cuentas/paneles').then((m) => m.Soporte) },
  { path: 'errores', loadComponent: () => import('./cuentas/paneles').then((m) => m.Errores) },
  { path: 'auditoria', loadComponent: () => import('./cuentas/paneles').then((m) => m.Auditoria) },
  { path: 'configuracion', loadComponent: () => import('./configuracion/configuracion').then((m) => m.Configuracion) },
  { path: '**', redirectTo: 'prospectos' },
];
