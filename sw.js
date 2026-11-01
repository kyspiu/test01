const CACHE_NAME = "komunikator-v2";
const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./supabase-client.js",
    "./auth.js",
    "./login.html",
    "./manifest.json",
    "./icon.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});