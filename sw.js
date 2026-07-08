const CACHE_NAME = "gym-app-v1";
const APP_SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. NE JAMAIS intercepter Google Apps Script (Données dynamiques et synchronisation)
  if (url.hostname.includes("script.google.com")) return;

  // 2. Uniquement les requêtes GET locales (Fichiers, assets, structure)
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Si la réponse est valide, on la clone et on met à jour le cache
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // EN CAS DE PANNE RÉSEAU :
        return caches.match(event.request).then((cachedResponse) => {
          // Si le fichier précis est dans le cache (ex: une image, un JS), on le sert
          if (cachedResponse) return cachedResponse;

          // Si c'est une navigation (ex: l'utilisateur recharge une page /une-route)
          // on lui sert le fichier principal de l'application (l'index.html de l'APP_SHELL)
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
      })
  );
});