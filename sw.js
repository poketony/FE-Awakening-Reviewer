const CACHE = "fe-awakening-reviewer-v9";
const SHELL = [
  "./", "./index.html", "./styles.css", "./progress.css", "./app.js", "./progress.js", "./manifest-v2.webmanifest",
  "./assets/reviewer-logo.png", "./assets/reviewer-app-v2-192.png", "./assets/reviewer-app-v2-512.png",
  "./lib/github.js", "./lib/catalog.js", "./lib/message-format.js", "./lib/validation.js", "./lib/safe-editor.js",
  "./lib/game-renderer.js", "./lib/hair-colors.js", "./lib/review-progress.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.url.includes("api.github.com") || request.url.includes("raw.githubusercontent.com")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && request.url.startsWith(self.location.origin)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
