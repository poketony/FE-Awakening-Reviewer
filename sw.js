const CACHE = "fe-awakening-reviewer-v3";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./lib/github.js", "./lib/catalog.js", "./lib/message-format.js", "./lib/validation.js", "./lib/safe-editor.js", "./lib/game-renderer.js", "./lib/hair-colors.js"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.url.includes("api.github.com") || event.request.url.includes("raw.githubusercontent.com")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
