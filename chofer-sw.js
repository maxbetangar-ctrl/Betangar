// ═══════════════════════════════════════════════════
// BETANGAR — Service Worker para chofer.html
// PWA Offline-First para choferes
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'betangar-chofer-v44-cm-rango-km-no-baja-cm-salida-bloq-borrador-teclado-20260820-avisobloqueo'; // el campo de kilometraje ahora fuerza el teclado NUMERICO (type=tel + pattern): inputmode es solo una sugerencia y hay teclados que la ignoran, y al chofer le abria el de letras. Lo reporto Omar Nava, Betangar (2026-08-19) // v-borrador: el checklist guarda lo que el chofer va llenando y lo repone si la app se recarga; el nivel de combustible al llegar pasa a ser OBLIGATORIO; y si la unidad no se puede medir con regla ya no se le exigen los centimetros (2026-08-19) // v46: en Modo Llegada los CM de SALIDA quedan bloqueados: al regresar en la noche volvia a pedir la medida de la mañana como si hubiera que medir otra vez (lo reporto Carlos Serrano, 2026-08-18). Se BLOQUEA y no se oculta: el chofer necesita ver con cuanto salio // v45: el km de SALIDA que va para ATRAS se RECHAZA (el candado de «bajo» existia solo en la llegada) — un chofer puso 43 km, que eran los CENTIMETROS DEL TANQUE, y entro sin aviso (2026-08-18). Y el mensaje explica el POR QUE, el numero de referencia y que escribir: un error que no se explica preocupa al chofer y no resuelve // v44: una altura IMPOSIBLE se RECHAZA, ya no se topa — 175 cm en un tanque de 52,5 salia por pantalla como «596,06 L» y se leia como una medicion real (2026-08-17). Gracia de 2 cm para el tanque al borde: las lecturas de 53/54 son legitimas y no se trancan // las fotos de trazabilidad Y de la surtida se toman con la CÁMARA EN VIVO: ya no se pueden sacar de la biblioteca (2026-08-03) // // v41: URGENTE — el km de entrada en 0 (camion que salio y no ha vuelto) mandaba la pantalla a 'dia cerrado' y trancaba al chofer: un 0 NO es un odometro // v40: la medicion del tanque ya no se duplica (upsert + candado en la BD), la pantalla dice cuando el dia ya quedo registrado y sincronizarCola no corre dos veces a la vez // v38: los MILES se ponen solos en los numeros que escribe el chofer (km y litros) + tope duro por surtida // v37: cubicacion REAL del tanque JAC (medido 60x52,5x199, esquinas r=12,54) — la recta de 13,04 L/cm era 600/46 y topaba en 46 cm lecturas legitimas de 50 // v36: banner de AVISO por unidad (RPC aviso_unidad, caduca solo) — ej. corrección de km // v35: fotos nunca en base64 dentro de la fila (cola local + reintentos) + compresión 0.7 // // v34: entregas — guardar SIN GPS ya no revienta + mensaje que dice qué tocar si la ubicación está bloqueada // v33: quitado ítem "Repuesto" del checklist (no se lleva caucho de repuesto en vía) // v31: + módulo Surtir combustible (por surtida) // v29: huecos chofer — incidencia offline no se pierde (COLA_INC), checklist en cola se fusiona, fecha 'hoy' se recalcula al amanecer


// Credenciales anon (públicas, ya expuestas en chofer.html) para que el SW pueda subir
// directo por REST cuando la app está cerrada. RLS protege la base igual que en la app.
const SUPA_URL = 'https://hrkjddehqnzcqwlkklqm.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhya2pkZGVocW56Y3F3bGtrbHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTk1NzIsImV4cCI6MjA5MzIzNTU3Mn0.kqWKthyZfPZ86toql7shGByF-ZhUpcQUS4Jw4RnG_ko';

// Archivos a cachear para funcionar sin internet
const ARCHIVOS_CACHE = [
  '/chofer.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

// ══ INSTALL — cachear archivos al instalar ══
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando Betangar Chofer SW...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Cacheando archivos...');
      return cache.addAll(ARCHIVOS_CACHE).catch(function(err) {
        console.log('[SW] Error cacheando (normal en desarrollo):', err);
      });
    })
  );
  // Activar inmediatamente sin esperar
  self.skipWaiting();
});

// ══ ACTIVATE — limpiar caches viejos ══
self.addEventListener('activate', function(event) {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) {
            console.log('[SW] Eliminando cache viejo:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Tomar control inmediato de todas las pestañas
  self.clients.claim();
});

// ══ FETCH — estrategia: Network First, Cache Fallback ══
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // No interceptar peticiones a Supabase (siempre van a red)
  if (url.includes('supabase.co') || url.includes('callmebot.com')) {
    return;
  }

  // El DOCUMENTO (chofer.html) se pide SIEMPRE fresco a la red (bypass de la caché HTTP de
  // GitHub Pages) para que el chofer no se quede con una versión vieja. El resto: network-first normal.
  var esDoc = (event.request.mode === 'navigate') || url.indexOf('chofer.html') >= 0;

  // Para el chofer.html y sus recursos: Network First
  event.respondWith(
    (esDoc ? fetch(url, { cache: 'no-store' }) : fetch(event.request))
      .then(function(response) {
        // Si la respuesta es válida, actualizar cache
        if (response && response.status === 200) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(function() {
        // Sin internet: servir desde cache
        console.log('[SW] Sin internet, sirviendo desde cache:', url);
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          // Si no hay cache y es el chofer.html, servir la versión cacheada principal
          if (url.includes('chofer.html')) {
            return caches.match('/chofer.html');
          }
          return new Response('Sin conexión', { status: 503 });
        });
      })
  );
});

// ══ SYNC — background sync: sube los pendientes AUNQUE la app esté cerrada (Android) ══
// Lee el espejo en IndexedDB (que chofer.html llena al encolar) y sube por REST a Supabase.
// Además avisa a los clientes abiertos para que refresquen su UI. iPhone no dispara este
// evento → allí sube cuando el chofer abre la app.
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-viajes') {
    console.log('[SW] Background sync viajes...');
    event.waitUntil(Promise.all([
      flushStore('vj', 'chofer_viaje_guardar'),
      notificarClientes('SYNC_VIAJES')
    ]));
  }
  if (event.tag === 'sync-checklist') {
    console.log('[SW] Background sync checklist...');
    event.waitUntil(Promise.all([
      flushStore('cl', 'chofer_checklist_guardar'),
      notificarClientes('SYNC_CHECKLIST')
    ]));
  }
});

async function notificarClientes(tipo) {
  const clients = await self.clients.matchAll();
  clients.forEach(function(client) { client.postMessage({ type: tipo }); });
}

// ── IndexedDB (el SW no puede leer localStorage, sí IndexedDB) ──
function idbOpenSW() {
  return new Promise(function(res, rej) {
    var rq = indexedDB.open('btg_chofer', 1);
    rq.onupgradeneeded = function() { var db = rq.result; if (!db.objectStoreNames.contains('cl')) db.createObjectStore('cl'); if (!db.objectStoreNames.contains('vj')) db.createObjectStore('vj'); };
    rq.onsuccess = function() { res(rq.result); };
    rq.onerror = function() { rej(rq.error); };
  });
}
function idbEntriesSW(db, store) {
  return new Promise(function(res) {
    try {
      var out = [], cur = db.transaction(store, 'readonly').objectStore(store).openCursor();
      cur.onsuccess = function() { var c = cur.result; if (c) { out.push({ key: c.key, val: c.value }); c.continue(); } else res(out); };
      cur.onerror = function() { res(out); };
    } catch (e) { res([]); }
  });
}
function idbDelSW(db, store, key) { try { db.transaction(store, 'readwrite').objectStore(store).delete(key); } catch (e) {} }

// Sube todos los pendientes de un store por REST. Idempotente (on_conflict + merge-duplicates).
// Borra del espejo solo lo que subió OK; lo que falle (sin señal) queda para el próximo sync.
// ⛔ SUBE POR RPC, NO CONTRA LA TABLA. La llave `anon` que usa este worker ya no tiene permisos
// sobre `viajes_chofer` ni `checklist`: se los quitamos el 15/08 para que nadie pueda leer la
// operación con la llave que está en el JS público. Si esto siguiera apuntando a
// `/rest/v1/<tabla>`, la cola de fondo moriría EN SILENCIO — el chofer cierra la app creyendo que
// lo suyo sube solo, y no sube nunca.
async function flushStore(store, rpc) {
  var db;
  try { db = await idbOpenSW(); } catch (e) { return; }
  var items = await idbEntriesSW(db, store);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    try {
      var r = await fetch(SUPA_URL + '/rest/v1/rpc/' + rpc, {
        method: 'POST',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': 'Bearer ' + SUPA_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ p: it.val })
      });
      if (r.ok) idbDelSW(db, store, it.key);
    } catch (e) { /* sin señal: se reintenta en el próximo sync */ }
  }
}

// ══ MESSAGE — recibir mensajes del cliente ══
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Betangar Chofer Service Worker cargado v2');
