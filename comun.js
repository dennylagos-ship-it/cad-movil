// CAD NUEVO · utilidades compartidas por las pantallas
var CAD = (function () {
  var ESTADOS = {
    disponible: 'Disponible', despachada: 'Despachada', ruta: 'En ruta', sitio: 'En el sitio', traslado: 'Traslado', estudio: 'En estudio', fuera: 'Fuera de servicio'
  };
  var FASES = [
    { id: 'ruta', nombre: 'En ruta' }, { id: 'sitio', nombre: 'En el sitio' }, { id: 'decision', nombre: 'Decisión' },
    { id: 'destino', nombre: 'Destino' }, { id: 'cierre', nombre: 'Cierre' }
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function api(ruta, cuerpo) {
    var op = cuerpo === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) };
    return fetch(ruta, op).then(function (r) {
      if (r.status === 401) { location.href = '/entrar.html?ir=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sesión requerida'); }
      // 423: la consola quedó bloqueada por inactividad (hay que volver a poner usuario y clave)
      if (r.status === 423 && window.CAD_bloquear) { window.CAD_bloquear(); throw new Error('Consola bloqueada: entre con su usuario y clave'); }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Error ' + r.status); return d; });
    });
  }

  // Tiempo real: avisa en cada cambio y reconecta solo
  function escuchar(manejadores, alConectar) {
    var es = new EventSource('/api/eventos');
    Object.keys(manejadores).forEach(function (ev) {
      es.addEventListener(ev, function (e) { manejadores[ev](JSON.parse(e.data || '{}')); });
    });
    es.onopen = function () { alConectar && alConectar(true); };
    es.onerror = function () { alConectar && alConectar(false); };
    return es;
  }

  function aviso(texto, error) {
    var cont = document.getElementById('avisos');
    if (!cont) { cont = document.createElement('div'); cont.id = 'avisos'; document.body.appendChild(cont); }
    var a = document.createElement('div');
    a.className = 'aviso' + (error ? ' error' : '');
    a.textContent = texto;
    cont.appendChild(a);
    setTimeout(function () { a.remove(); }, error ? 7000 : 4000);
  }

  function horaAhora() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function reloj(el) {
    function t() {
      var d = new Date();
      el.innerHTML = '<b class="num">' + d.toLocaleTimeString('es-VE', { hour12: false }) + '</b><span>' + d.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span>';
    }
    t(); setInterval(t, 1000);
  }

  // Traslado a estudio con regreso: dos pasos más después del destino (un solo folio)
  var FASES_ESTUDIO = FASES.slice(0, 4).concat([{ id: 'regreso', nombre: 'Regreso' }, { id: 'retorno', nombre: 'Llegada' }, FASES[4]]);
  function fasesDe(s) { return s && s.decision && s.decision.tipo === 'estudio' ? FASES_ESTUDIO : FASES; }
  function siguienteFase(s) {
    var l = fasesDe(s);
    for (var i = 0; i < l.length; i++) if (!s.fases[l[i].id]) return l[i];
    return null;
  }

  // Fondo del mapa con selector (oscuro, calles, satélite). Las teselas pasan por el servidor del CCO,
  // que guarda lo ya visto para que siga viéndose sin internet. Recuerda la elección en cada pantalla.
  function fondoMapa(mapa, clave, defecto) {
    var ESRI = 'Mapa © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>';
    var OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    // En la calle (app de internet) las teselas se piden directo; en el CCO pasan por su servidor
    var AG = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    var DIRECTAS = { oscuro: AG + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', oscuro_nombres: AG + 'Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', calles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', satelite: AG + 'World_Imagery/MapServer/tile/{z}/{y}/{x}' };
    var tes = function (n) { return window.CAD_TESELAS_DIRECTAS ? DIRECTAS[n] : '/teselas/' + n + '/{z}/{x}/{y}'; };
    var capas = {
      'Oscuro': L.layerGroup([
        L.tileLayer(tes('oscuro'), { maxZoom: 16, attribution: ESRI }),
        L.tileLayer(tes('oscuro_nombres'), { maxZoom: 16 })
      ]),
      'Calles': L.tileLayer(tes('calles'), { maxZoom: 19, attribution: OSM }),
      'Satélite': L.tileLayer(tes('satelite'), { maxZoom: 18, attribution: ESRI + ', Maxar, Earthstar Geographics' })
    };
    var elegido = defecto;
    try { elegido = localStorage.getItem('cad_mapa_' + clave) || defecto; } catch (e) {}
    if (!capas[elegido]) elegido = defecto;
    capas[elegido].addTo(mapa);
    L.control.layers(capas, null, { position: 'topright', collapsed: true }).addTo(mapa);
    mapa.attributionControl.setPrefix(false);
    mapa.on('baselayerchange', function (e) { try { localStorage.setItem('cad_mapa_' + clave, e.name); } catch (er) {} });
  }

  return { fondoMapa: fondoMapa, ESTADOS: ESTADOS, FASES: FASES, fasesDe: fasesDe, esc: esc, api: api, escuchar: escuchar, aviso: aviso, horaAhora: horaAhora, reloj: reloj, siguienteFase: siguienteFase };
})();
