// ═══════════════════════════════════════════════════════════════
//  Service Worker (รวม 2 หน้าที่ไว้ในไฟล์เดียว)
//  1) Offline-friendly cache — เปิดเว็บได้แม้เน็ตหลุด/ช้า
//  2) Push Notification — แจ้งเตือนเพลงใหม่
//  วางไฟล์นี้ไว้ที่ root ของเว็บ (ต้องเป็น /service-worker.js)
// ═══════════════════════════════════════════════════════════════
const CACHE_NAME = 'song-id-guardian-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/icon.png',
  '/manifest.json',
];

// ── ติดตั้งครั้งแรก: ดาวน์โหลดหน้าเว็บหลักเก็บไว้ในเครื่อง ──────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

// ── ลบแคชเวอร์ชันเก่าทิ้งตอนอัปเดต service worker ──────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── กลยุทธ์การแคช: API สดก่อนเสมอ, ไฟล์หน้าเว็บแคชก่อนแล้วอัปเดตเงียบๆ ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // ไม่แคช POST (โหวต, ping ฯลฯ)

  const url = new URL(request.url);

  // API calls: เน็ตก่อนเสมอ (ข้อมูลต้องสด) — ถ้าเน็ตหลุดค่อย fallback เป็นแคชล่าสุดถ้ามี
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ไฟล์หน้าเว็บ/static: แคชก่อน เร็วกว่าและใช้ได้ตอนออฟไลน์ แล้วค่อยอัปเดตแคชเงียบๆ เบื้องหลัง
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ── รับ push event จากเซิร์ฟเวอร์ (แจ้งเตือนเพลงใหม่) ───────────
self.addEventListener('push', (event) => {
  let data = { title: '🎵 มีเพลงใหม่เข้าคลัง!', body: 'มีเพลงใหม่ถูกเพิ่มเข้า Song-ID Guardian', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'new-song',
    renotify: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ── กดที่ notification แล้วเปิด/โฟกัสแท็บเว็บ ───────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
