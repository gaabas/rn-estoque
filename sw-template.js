const cacheName = __CACHE_NAME__
const files = __CACHE_FILES__

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files.map(
    file => new Request(file, { cache: 'reload' }),
  ))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith('rn-estoque-') && key !== cacheName)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

async function cachedOrNetwork(pathname, request) {
  const cached = await caches.open(cacheName)
    .then(cache => cache.match(pathname))
    .catch(() => undefined)
  return cached ?? fetch(request)
}

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(cachedOrNetwork('/index.html', request))
  } else if (files.includes(url.pathname)) {
    event.respondWith(cachedOrNetwork(url.pathname, request))
  }
})
