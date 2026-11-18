// CAD · app del celular EN LA CALLE (la versión publicada en GitHub Pages).
// Cambia la forma de hablar con el CCO: en vez de la PC del CCO (Wi-Fi), usa Supabase como puente.
//  - Pregunta cada 10 s si hay algo nuevo (5 s si hay algo por confirmar). Si no cambió nada, la respuesta es mínima.
//  - Lo que marca la unidad se manda a Supabase; si no hay señal, queda guardado en el celular y se reintenta.
// El QR trae: ?u=UNIDAD#k=LLAVE&s=PROYECTO&p=CLAVE_PUBLICA. Todo queda guardado en este celular.
// En la versión del Wi-Fi (servida por la PC del CCO) este archivo no hace nada.
(function () {
  if (!window.CAD_MODO_CALLE || !window.CAD) return;
  var codigo = new URLSearchParams(location.search).get('u');
  var CLAVE = 'cad_calle_' + codigo;
  var cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) {}
  var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (codigo && hash.get('k') && hash.get('s') && hash.get('p')) {
    var s = hash.get('s');
    cfg = { k: hash.get('k'), url: /^https?:\/\//.test(s) ? s.replace(/\/+$/, '') : 'https://' + s + '.supabase.co', p: hash.get('p') };
    try { localStorage.setItem(CLAVE, JSON.stringify(cfg)); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  // Mapa: sin la PC del CCO, las teselas se piden directo a internet
  window.CAD_TESELAS_DIRECTAS = true;

  var COLA = 'cad_calle_cola_' + codigo;
  var cache = null, version = -1, pendientesCCO = 0, manej = null, alConectar = null, ultimoOk = 0, revocado = false;

  function rpc(fn, args) {
    if (!cfg) return Promise.reject(new Error('Escanee el QR de su unidad en la consola del CCO.'));
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { ctl && ctl.abort(); }, 12000);
    return fetch(cfg.url + '/rest/v1/rpc/' + fn, {
      method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
      headers: { apikey: cfg.p, 'Content-Type': 'application/json' }, body: JSON.stringify(args)
    }).then(function (r) {
      clearTimeout(t);
      return r.json().then(function (d) { if (!r.ok) throw new Error((d && d.message) || 'Error ' + r.status); return d; });
    }, function (e) { clearTimeout(t); var er = new Error('Sin señal'); er.sinRed = true; throw er; });
  }

  function leer(forzar) {
    return rpc('calle_leer', { p_codigo: codigo, p_llave: cfg ? cfg.k : '', p_version: forzar ? -1 : version }).then(function (d) {
      ultimoOk = Date.now();
      if (d.revocado) { revocado = true; throw new Error(d.error); }
      pendientesCCO = d.pendientes || 0;
      var cambio = false;
      if (d.datos) { cache = d.datos; cambio = d.v !== version; version = d.v; }
      return cambio;
    });
  }

  // ---------- Cola de lo que se marcó sin señal ----------
  function cola() { try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch (e) { return []; } }
  function ponCola(l) { try { localStorage.setItem(COLA, JSON.stringify(l)); } catch (e) {} }
  var vaciando = false;
  function vaciarCola() {
    if (vaciando) return Promise.resolve();
    var l = cola(); if (!l.length) return Promise.resolve();
    vaciando = true;
    var x = l[0];
    return rpc('calle_enviar', { p_codigo: codigo, p_llave: cfg.k, p_tipo: x.tipo, p_datos: x.datos }).then(function (r) {
      if (r && r.error && /Demasiados/.test(r.error)) { vaciando = false; return; }
      ponCola(cola().slice(1)); vaciando = false; pendientesCCO++;
      return vaciarCola();
    }, function () { vaciando = false; });
  }
  function enviar(tipo, datos) {
    if (tipo === 'gps') return rpc('calle_enviar', { p_codigo: codigo, p_llave: cfg.k, p_tipo: 'gps', p_datos: datos }).then(function (r) { if (r && r.error) throw new Error(r.error); return { ok: true }; });
    var l = cola(); l.push({ tipo: tipo, datos: datos }); ponCola(l);
    return vaciarCola().then(function () { return { enCola: cola().length > 0 }; });
  }

  function horaTel() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // Mientras el CCO confirma, la pantalla avanza sola (lo marcado ya quedó guardado)
  function adelantar(tipo, d) {
    if (!cache) return;
    var s = cache.servicio;
    if (tipo === 'fase' && s && s.id === d.id) {
      s.fases = s.fases || {};
      s.fases[d.fase] = { h: horaTel(), por: 'movil', porConfirmar: true };
      if (d.fase === 'decision') s.decision = { tipo: d.tipo, destino: d.destino || (d.tipo === 'sitio' ? 'Atendido en el sitio' : ''), medico: d.medico || '', regreso: d.regreso || '' };
      if (d.fase === 'decision' && d.tipo === 'sitio') s.fases.destino = { h: '—', por: 'movil', omitido: true };
      var est = { ruta: 'ruta', sitio: 'sitio', decision: d.tipo === 'sitio' ? 'sitio' : 'traslado', regreso: 'traslado' }[d.fase];
      if (est && cache.unidad) cache.unidad.estado = est;
    }
    if (tipo === 'cerrar' && s && s.id === d.id) { cache.servicio = null; if (cache.unidad) { cache.unidad.estado = 'disponible'; } }
  }

  // ---------- Reemplazo de CAD.api ----------
  CAD.api = function (ruta, cuerpo) {
    if (revocado) return Promise.reject(new Error('QR no válido'));
    if (ruta === '/api/estado') {
      return leer(!cache).then(function () { return cache; }).catch(function (e) {
        if (revocado) { mostrarRevocado(); throw e; }
        if (cache) return cache;
        throw new Error(e.sinRed ? 'Sin señal. Reintentando…' : e.message);
      });
    }
    var m = ruta.match(/^\/api\/servicios\/([\w-]+)\/(fase|cerrar)$/);
    if (m && cuerpo) {
      var d = Object.assign({ id: m[1], hTel: horaTel(), tTel: new Date().toISOString() }, cuerpo);
      return enviar(m[2], d).then(function (r) {
        adelantar(m[2], d);
        CAD.aviso(r.enCola ? '📶 Sin señal: quedó guardado en el celular y se enviará solo.' : '✓ Enviado al CCO');
        return m[2] === 'cerrar' ? {} : (cache && cache.servicio) || {};
      });
    }
    if (ruta === '/api/novedad') return enviar('novedad', Object.assign({ tTel: new Date().toISOString() }, cuerpo)).then(function (r) { if (r.enCola) CAD.aviso('📶 Sin señal: la novedad se enviará sola.'); return { ok: true }; });
    if (ruta === '/api/gps') return enviar('gps', cuerpo);
    return Promise.reject(new Error('No disponible fuera del Wi-Fi del CCO'));
  };

  // Las fotos van por WhatsApp cuando la unidad está en la calle
  var fetchViejo = window.fetch.bind(window);
  window.fetch = function (u, o) {
    if (typeof u === 'string' && /^\/api\/servicios\/[\w-]+\/foto$/.test(u)) return Promise.reject(new Error('En la calle, envíe las fotos por WhatsApp con el folio en el texto.'));
    return fetchViejo(u, o);
  };

  function mostrarRevocado() {
    if (manej && manej.revocado) manej.revocado();
  }

  // ---------- Reemplazo del tiempo real: preguntar cada 10 s ----------
  var antes = null, acusesVistos = null;
  function ciclo() {
    if (revocado || !cfg) return;
    vaciarCola().then(function () { return leer(false); }).then(function (cambio) {
      alConectar && alConectar(true);
      if (cambio && manej) {
        var s = cache && cache.servicio;
        if (antes && !s && !cerrandoYo()) CAD.aviso('El servicio ' + (antes.folio || '') + ' ya no está asignado a esta unidad (anulado o pasado a otra unidad).', true);
        antes = s ? { id: s.id, folio: s.folio } : null;
        // El CCO confirmó ("enterado") una novedad de esta unidad
        var ac = (cache && cache.acuses) || [];
        if (acusesVistos && ac.some(function (x) { return acusesVistos.indexOf(x) === -1; }) && manej.enterado) manej.enterado();
        acusesVistos = ac.slice();
        (manej.cambio || function () {})();
      }
    }).catch(function () {
      if (revocado) return mostrarRevocado();
      if (Date.now() - ultimoOk > 25000) alConectar && alConectar(false);
    });
  }
  var cerreHace = 0;
  function cerrandoYo() { return Date.now() - cerreHace < 120000; }
  var apiOriginal = CAD.api;
  CAD.api = function (ruta, cuerpo) { if (/\/cerrar$/.test(ruta)) cerreHace = Date.now(); return apiOriginal(ruta, cuerpo); };

  CAD.escuchar = function (manejadores, conectar) {
    manej = manejadores; alConectar = conectar;
    if (!cfg) { document.body.innerHTML = '<div class="bloque espera"><h2>Falta vincular el celular</h2><p class="sec">Escanee el QR de su unidad en la consola del CCO (botón ▣ QR).</p></div>'; return; }
    leer(true).then(function () { var s = cache && cache.servicio; antes = s ? { id: s.id, folio: s.folio } : null; acusesVistos = ((cache && cache.acuses) || []).slice(); alConectar && alConectar(true); }).catch(function () {});
    (function prog() { setTimeout(function () { ciclo(); prog(); }, cola().length || pendientesCCO ? 5000 : 10000); })();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ciclo(); });
    window.addEventListener('online', ciclo);
    return { close: function () {} };
  };
})();
