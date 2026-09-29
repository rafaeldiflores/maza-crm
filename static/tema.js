/*
 * Tema del CRM, al estilo de las consolas empresariales (Lightning): barra
 * global azul, pestañas de navegación, fondo gris, tarjetas blancas con borde
 * fino y radios chicos. Lo cargan index.html y cuentas.html justo después del
 * CDN de Tailwind.
 *
 * El truco para no reescribir 3.000 líneas de HTML: la paleta `amber` (el
 * acento de antes) se redefine como azul de marca y los radios grandes se
 * achican, así cada clase existente toma el estilo nuevo.
 */
(() => {
  const azul = {
    50: '#eef4ff', 100: '#d8e6fe', 200: '#aacbff', 300: '#78b0fd', 400: '#1b96ff',
    500: '#0176d3', 600: '#0b5cab', 700: '#014486', 800: '#032d60', 900: '#03234d',
  };
  window.tailwind = window.tailwind || {};
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: {
          sans: ['"Inter"', '"Segoe UI"', 'system-ui', 'Arial', 'sans-serif'],
          mono: ['"JetBrains Mono"', 'monospace'],
        },
        colors: { amber: azul, maza: { ...azul, dark: '#032d60', card: '#ffffff' } },
        borderRadius: { xl: '0.375rem', '2xl': '0.5rem', '3xl': '0.625rem' },
      },
    },
  };

  const css = `
    body { background: #f3f3f3 !important; color: #181818; font-size: 14px; }
    .bg-slate-50 { background-color: #f3f3f3 !important; }
    .border-slate-200, .border-slate-200\\/80 { border-color: #e5e5e5 !important; }
    .shadow-sm, .shadow-md, .shadow-lg { box-shadow: 0 2px 2px 0 rgba(0,0,0,.08) !important; }
    header.cabecera-pagina { position: static !important; background: #fff !important; backdrop-filter: none !important;
      border: 1px solid #e5e5e5; border-radius: .5rem; margin: 12px 16px 0; box-shadow: 0 2px 2px 0 rgba(0,0,0,.08); }
    #barra-global { background: #032d60; color: #fff; }
    #barra-nav { background: #fff; border-bottom: 3px solid #0176d3; }
    #barra-nav a { display: inline-flex; align-items: center; height: 40px; padding: 0 14px; font-size: 13px;
      color: #181818; border-bottom: 3px solid transparent; margin-bottom: -3px; white-space: nowrap; }
    #barra-nav a:hover { background: #f3f3f3; }
    #barra-nav a.activa { border-bottom-color: #032d60; font-weight: 700; background: #eef4ff; }
    /* Etapas del embudo (path) */
    .etapas { display: flex; gap: 2px; margin: 8px 0; overflow-x: auto; }
    .etapas button { flex: 1 0 auto; min-width: 96px; padding: 0 16px; white-space: nowrap; position: relative; height: 30px; font-size: 11.5px; font-weight: 600; background: #ecebea;
      color: #444; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%); }
    .etapas button:first-child { clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%); border-radius: 16px 0 0 16px; }
    .etapas button.hecha { background: #3ba755; color: #fff; }
    .etapas button.actual { background: #032d60; color: #fff; }
    .etapas button:hover:not(.actual) { background: #0176d3; color: #fff; }
    .etapas.descartado button.actual { background: #ba0517; }
  `;
  const estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  // Barra global + pestañas. Los ítems de administración se ocultan si el
  // servidor dice que la sesión no es admin (/api/salud).
  const PESTANAS = [
    ['Prospectos', '/', false],
    ['Hoy', '/cuentas#hoy', true],
    ['Cuentas', '/cuentas#cuentas', true],
    ['Cobros', '/cuentas#cobros', true],
    ['Métricas', '/cuentas#metricas', true],
    ['Soporte', '/cuentas#tickets', true],
    ['Errores', '/cuentas#errores', true],
    ['Auditoría', '/cuentas#auditoria', true],
  ];

  function activa(href) {
    const [ruta, hash] = href.split('#');
    if (ruta !== location.pathname) return false;
    return !hash || (location.hash || '#hoy') === '#' + hash;
  }

  function pintarNav(admin) {
    const nav = document.getElementById('barra-nav-links');
    nav.innerHTML = PESTANAS.filter(([, , soloAdmin]) => admin || !soloAdmin)
      .map(([t, href]) => `<a href="${href}" class="${activa(href) ? 'activa' : ''}">${t}</a>`).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('body > header').forEach((h) => h.classList.add('cabecera-pagina'));
    const cab = document.createElement('div');
    cab.innerHTML = `
      <div id="barra-global" class="px-4 h-11 flex items-center justify-between">
        <div class="flex items-center gap-2 font-bold tracking-tight">
          <span class="grid place-items-center h-7 w-7 rounded bg-white/10 text-sm">M</span> MAZA CRM
        </div>
        <div class="flex items-center gap-3 text-xs">
          <span id="barra-usuario" class="opacity-80"></span>
          <a href="/_gcp_iap/clear_login_cookie" class="rounded border border-white/30 px-2 py-1 hover:bg-white/10">Salir</a>
        </div>
      </div>
      <nav id="barra-nav"><div id="barra-nav-links" class="px-2 flex overflow-x-auto"></div></nav>`;
    document.body.prepend(cab);
    pintarNav(true);
    window.addEventListener('hashchange', () => pintarNav(window.__crmAdmin !== false));
    fetch('/api/salud').then((r) => r.json()).then((s) => {
      window.__crmAdmin = s.admin !== false;
      document.getElementById('barra-usuario').textContent = s.usuario || '';
      pintarNav(window.__crmAdmin);
    }).catch(() => {});
  });

  // Barra de etapas del embudo: la usa la ficha del taller (index.html).
  const ETAPAS = ['Por consultar', 'Contactado', 'Interesado', 'En prueba 14 días', 'Cliente Activo'];
  window.pintarEtapas = (contenedor, estado, alCambiar) => {
    const i = ETAPAS.indexOf(estado);
    contenedor.className = 'etapas' + (estado === 'Descartado' ? ' descartado' : '');
    contenedor.innerHTML = ETAPAS.map((e, k) =>
      `<button type="button" class="${k < i ? 'hecha' : k === i ? 'actual' : ''}" data-e="${e}" title="Pasar a ${e}">${k < i ? '✓ ' : ''}${e}</button>`
    ).join('') + `<button type="button" class="${estado === 'Descartado' ? 'actual' : ''}" data-e="Descartado" style="flex:.6">Descartado</button>`;
    contenedor.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.e !== estado) alCambiar(b.dataset.e);
    }));
  };
})();
