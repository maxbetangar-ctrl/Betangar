// ═══════════════════════════════════════════════════
// BETANGAR — Service Worker para chofer.html
// PWA Offline-First para choferes
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'betangar-chofer-v15'; // v15: reverse-geocoding OSM → muestra la CALLE (no solo coordenadas) en el sello y en la app

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

  // Para el chofer.html y sus recursos: Network First
  event.respondWith(
    fetch(event.request)
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

// ══ SYNC — sincronizar viajes guardados cuando vuelve internet ══
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-viajes') {
    console.log('[SW] Sincronizando viajes pendientes...');
    event.waitUntil(sincronizarViajes());
  }
  if (event.tag === 'sync-checklist') {
    console.log('[SW] Sincronizando checklists pendientes...');
    event.waitUntil(sincronizarChecklists());
  }
});

async function sincronizarViajes() {
  // Los viajes offline se guardan en localStorage del cliente
  // El SW notifica a los clientes para que sincronicen
  const clients = await self.clients.matchAll();
  clients.forEach(function(client) {
    client.postMessage({ type: 'SYNC_VIAJES' });
  });
}

async function sincronizarChecklists() {
  const clients = await self.clients.matchAll();
  clients.forEach(function(client) {
    client.postMessage({ type: 'SYNC_CHECKLIST' });
  });
}

// ══ MESSAGE — recibir mensajes del cliente ══
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Betangar Chofer Service Worker cargado v2');
