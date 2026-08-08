// ════════════════════════════════════════════════════════════════════════════════════════════
//  PERMISOS DEL TELÉFONO — qué decirle a la persona cuando el navegador niega cámara o ubicación
//
//  Nació el 2026-08-08, de Omar (Betangar): le salía «Cámara bloqueada en este teléfono» y el
//  mensaje lo mandaba al candado de la dirección. Fue, no encontró ninguna opción de Cámara ahí, y
//  concluyó que la app estaba rota. No lo estaba: el permiso estaba cortado UN NIVEL MÁS ARRIBA,
//  en el permiso que Android le da a Chrome.
//
//  ⛔ EL PUNTO: por el MISMO error del navegador llegan DOS bloqueos que se arreglan en LUGARES
//  DISTINTOS, y si uno manda a la persona al que no es, no encuentra nada que tocar:
//     (a) el SITIO está bloqueado  → candado al lado de la dirección
//     (b) el NAVEGADOR no tiene el permiso del sistema → Ajustes del teléfono
//  En el caso (b), en el candado la opción NI SIQUIERA APARECE.
//
//  `navigator.permissions` sabe distinguirlo: si el sitio estuviera bloqueado diría 'denied'.
//  Si dice 'prompt'/'granted' y AUN ASÍ falló, el corte está en el sistema. Cuando el navegador
//  no sabe responder, se pone primero el camino del sistema — porque es el que NO tiene callejón
//  sin salida si uno se equivoca de orden.
//
//  Se usa igual en las apps de página suelta (Betangar/Flotilla/VIDECA) y en las de Next
//  (MaxStock/MaxPersonal/Geppetto/Ranita): es JS plano, sin dependencias.
//
//    MWPermiso.explicar('camera', function(html){ mostrar(html); });
//    MWPermiso.explicar('geolocation', function(html){ mostrar(html); });
//
//  ⚠️ Al tocar este archivo, tocarlo en TODOS los productos: es la misma pieza copiada.
// ════════════════════════════════════════════════════════════════════════════════════════════
var MWPermiso = (function(raiz){
  'use strict';

  var DATOS = {
    camera:      { titulo:'La cámara está bloqueada',    opcion:'Cámara',    volver:'Tomar foto' },
    geolocation: { titulo:'La ubicación está bloqueada', opcion:'Ubicación', volver:'Ubicar' }
  };

  function esIOS(){
    try{
      var ua = navigator.userAgent || '';
      return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
    }catch(e){ return false; }
  }

  // El nombre que la persona VE en su teléfono, no el técnico.
  function nombreNavegador(){
    try{
      var ua = navigator.userAgent || '';
      if(/EdgA?\//.test(ua))                 return 'Edge';
      if(/OPR\/|Opera/.test(ua))             return 'Opera';
      if(/SamsungBrowser/.test(ua))          return 'Internet (Samsung)';
      if(/FxiOS|Firefox/.test(ua))           return 'Firefox';
      if(/CriOS/.test(ua))                   return 'Chrome';
      if(/Safari/.test(ua) && !/Chrome/.test(ua)) return 'Safari';
      return 'Chrome';
    }catch(e){ return 'Chrome'; }
  }

  function pasoSitio(d){
    return 'Tocá el <b>candado 🔒</b> (o ⓘ) al lado de la dirección, arriba → <b>Permisos</b> → <b>'
      + d.opcion + '</b> → <b>Permitir</b>.';
  }

  function pasoSistema(d){
    var nav = nombreNavegador();
    if(esIOS()){
      return d.opcion === 'Ubicación'
        ? 'Entrá a <b>Ajustes</b> del teléfono → <b>Privacidad</b> → <b>Localización</b> → <b>' + nav + '</b> → <b>Al usar la app</b>.'
        : 'Entrá a <b>Ajustes</b> del teléfono → <b>' + nav + '</b> → activá <b>Cámara</b>.';
    }
    return 'Entrá a <b>Ajustes</b> del teléfono → <b>Aplicaciones</b> → <b>' + nav
      + '</b> → <b>Permisos</b> → <b>' + d.opcion + '</b> → <b>Permitir</b>.';
  }

  // Las PIEZAS del mensaje, una sola vez. De acá salen las dos formas de mostrarlo (con HTML o en
  // texto pelado), para que las dos digan exactamente lo mismo y no se desincronicen nunca.
  function partes(tipo, estado){
    var d = DATOS[tipo] || DATOS.camera;
    var sitio = pasoSitio(d), sistema = pasoSistema(d);
    // Si el sitio NO está bloqueado, el corte es del sistema: ese va primero.
    return {
      titulo:  d.titulo,
      uno:     (estado === 'denied') ? sitio   : sistema,
      dos:     (estado === 'denied') ? sistema : sitio,
      aclara:  (estado === 'denied')
                 ? 'Si ahí no aparece «' + d.opcion + '», seguí con el paso 2.'
                 : 'Si ahí ya está permitido, seguí con el paso 2.',
      gps:     (tipo === 'geolocation')
                 ? 'Y comprobá que el <b>GPS del teléfono</b> esté encendido (se prende desde la barra de arriba).'
                 : '',
      cierre:  'Después volvé a tocar «<b>' + d.volver + '</b>».',
      ultimo:  'Si ya hiciste las dos cosas y sigue igual: cerrá el navegador por completo (sacalo de las apps abiertas) y volvé a entrar.'
    };
  }

  // `estado` es lo que respondió navigator.permissions ('denied' | 'prompt' | 'granted' | '').
  function pasos(tipo, estado){
    var p = partes(tipo, estado);
    return '<b style="color:#e8734a">' + p.titulo + '</b>'
      + '<br><br><span style="font-size:13px;line-height:1.5;display:block;text-align:left">'
      + '<b>1)</b> ' + p.uno + '<br><span style="opacity:.6;font-size:12px">' + p.aclara + '</span>'
      + '<br><br><b>2)</b> ' + p.dos
      + (p.gps ? '<br><br>' + p.gps : '')
      + '<br><br>' + p.cierre + '</span>'
      + '<br><span style="opacity:.45;font-size:11px">' + p.ultimo + '</span>';
  }

  // Misma información sin una sola etiqueta, para las pantallas que pintan TEXTO (las de Next
  // muestran `{mensaje}` en JSX, que escapa el HTML: ahí las etiquetas se verían escritas).
  function pasosTexto(tipo, estado){
    var p = partes(tipo, estado);
    function limpiar(s){ return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
    return limpiar(p.titulo) + '\n\n'
      + '1) ' + limpiar(p.uno) + '\n' + limpiar(p.aclara) + '\n\n'
      + '2) ' + limpiar(p.dos)
      + (p.gps ? '\n\n' + limpiar(p.gps) : '') + '\n\n'
      + limpiar(p.cierre) + '\n' + limpiar(p.ultimo);
  }

  // Consulta el estado real del permiso y devuelve el texto ya ordenado. Nunca deja sin respuesta:
  // si la consulta no contesta en 1,2 s, responde igual con el orden por defecto.
  function explicar(tipo, cb, comoTexto){
    var listo = false;
    var pintar = comoTexto ? pasosTexto : pasos;
    function responder(estado){ if(listo) return; listo = true; try{ cb(pintar(tipo, estado)); }catch(e){} }
    try{
      if(raiz.navigator && navigator.permissions && navigator.permissions.query){
        navigator.permissions.query({ name: tipo })
          .then(function(p){ responder(p && p.state); })
          .catch(function(){ responder(''); });   // varios navegadores no soportan 'camera'
        setTimeout(function(){ responder(''); }, 1200);
      }else{ responder(''); }
    }catch(e){ responder(''); }
  }

  // `explicarTexto` es el mismo camino para las pantallas que no pintan HTML.
  function explicarTexto(tipo, cb){ return explicar(tipo, cb, true); }

  var API = { pasos: pasos, pasosTexto: pasosTexto, explicar: explicar, explicarTexto: explicarTexto,
              esIOS: esIOS, nombreNavegador: nombreNavegador };
  raiz.MWPermiso = API;   // para las apps que lo cargan con <script src="permisos.js">
  return API;
})(typeof window !== 'undefined' ? window : globalThis);

// ⚠️ El `module.exports` va ACÁ, a nivel superior, y no adentro de la función de arriba.
// Webpack analiza el archivo SIN ejecutarlo: si la asignación está dentro de una función, no la ve
// y rechaza `import MWPermiso from '../lib/permisos'` con «does not contain a default export» —
// el build de MaxStock se cayó justo por eso. `default` además, para que ande igual con `import`
// y con `require()`.
if(typeof module !== 'undefined' && module.exports){
  module.exports = MWPermiso;
  module.exports.default = MWPermiso;
}
