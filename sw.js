/* We❤PDF service worker — cache-first so the app works offline after the first visit */
const CACHE = 'welovepdf-v1';
const CORE = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/tools/merge.js', 'js/tools/split.js', 'js/tools/rotate.js',
  'js/tools/organize.js', 'js/tools/editor.js', 'js/tools/forms.js', 'js/tools/convert.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/pdf-lib.min.js', 'vendor/fflate.min.js',
  'fonts/hanken-400.woff2', 'fonts/hanken-500.woff2', 'fonts/hanken-600.woff2',
  'fonts/hanken-700.woff2', 'fonts/hanken-800.woff2',
  'img/icon-192.png', 'img/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
