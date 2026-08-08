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
(function(raiz){
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

  // `estado` es lo que respondió navigator.permissions ('denied' | 'prompt' | 'granted' | '').
  function pasos(tipo, estado){
    var d = DATOS[tipo] || DATOS.camera;
    var sitio = pasoSitio(d), sistema = pasoSistema(d);
    // Si el sitio NO está bloqueado, el corte es del sistema: ese va primero.
    var primero = (estado === 'denied') ? sitio   : sistema;
    var segundo = (estado === 'denied') ? sistema : sitio;
    var aclara  = (estado === 'denied')
      ? 'Si ahí no aparece «' + d.opcion + '», seguí con el paso 2.'
      : 'Si ahí ya está permitido, seguí con el paso 2.';
    var extraGps = (tipo === 'geolocation')
      ? '<br><br>Y comprobá que el <b>GPS del teléfono</b> esté encendido (se prende desde la barra de arriba).'
      : '';
    return '<b style="color:#e8734a">' + d.titulo + '</b>'
      + '<br><br><span style="font-size:13px;line-height:1.5;display:block;text-align:left">'
      + '<b>1)</b> ' + primero + '<br><span style="opacity:.6;font-size:12px">' + aclara + '</span>'
      + '<br><br><b>2)</b> ' + segundo
      + extraGps
      + '<br><br>Después volvé a tocar «<b>' + d.volver + '</b>».</span>'
      + '<br><span style="opacity:.45;font-size:11px">Si ya hiciste las dos cosas y sigue igual: cerrá el navegador por completo (sacalo de las apps abiertas) y volvé a entrar.</span>';
  }

  // Consulta el estado real del permiso y devuelve el texto ya ordenado. Nunca deja sin respuesta:
  // si la consulta no contesta en 1,2 s, responde igual con el orden por defecto.
  function explicar(tipo, cb){
    var listo = false;
    function responder(estado){ if(listo) return; listo = true; try{ cb(pasos(tipo, estado)); }catch(e){} }
    try{
      if(raiz.navigator && navigator.permissions && navigator.permissions.query){
        navigator.permissions.query({ name: tipo })
          .then(function(p){ responder(p && p.state); })
          .catch(function(){ responder(''); });   // varios navegadores no soportan 'camera'
        setTimeout(function(){ responder(''); }, 1200);
      }else{ responder(''); }
    }catch(e){ responder(''); }
  }

  var API = { pasos: pasos, explicar: explicar, esIOS: esIOS, nombreNavegador: nombreNavegador };
  if(typeof module !== 'undefined' && module.exports) module.exports = API;
  raiz.MWPermiso = API;
})(typeof window !== 'undefined' ? window : globalThis);
