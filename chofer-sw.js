// BETANGAR — Service Worker Choferes
// Versión del cache — cambiar para forzar actualización
var CACHE_NAME = 'betangar-chofer-v1';

// Archivos a cachear para funcionar offline
var ARCHIVOS_CACHE = [
  '/chofer.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

// Instalar — cachear archivos
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ARCHIVOS_CACHE).catch(function(err) {
        console.log('Cache parcial:', err);
        // Cachear solo el HTML si el CDN falla
        return cache.add('/chofer.html');
      });
    })
  );
  self.skipWaiting();
});

// Activar — limpiar caches viejos
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — servir desde cache si no hay internet
self.addEventListener('fetch', function(event) {
  // Solo cachear GET requests
  if (event.request.method !== 'GET') return;
  
  // Requests a Supabase — no cachear, son datos en tiempo real
  if (event.request.url.includes('supabase.co')) return;
  
  event.respondWith(
    // Intentar red primero
    fetch(event.request).then(function(response) {
      // Si la respuesta es válida, guardar en cache y devolver
      if (response && response.status === 200) {
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    }).catch(function() {
      // Sin red — servir desde cache
      return caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        // Si no está en cache y es el HTML principal, devolver el chofer.html cacheado
        if (event.request.destination === 'document') {
          return caches.match('/chofer.html');
        }
      });
    })
  );
});
