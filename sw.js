// DeltaForm Check — Service Worker
// 처음 실행 후 모든 자원을 캐싱해 완전 오프라인 동작 가능하게 함

const CACHE_VERSION = "deltaform-check-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./aruco_dicts.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./opencv.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // OpenCV.js는 크니까 실패해도 install은 성공시킴
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(e => console.warn("cache fail:", url, e)))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // 캐시 우선 — 오프라인 작동
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // 오프라인 + 미캐시 → 그냥 fail
        return new Response("offline", { status: 503 });
      });
    })
  );
});
