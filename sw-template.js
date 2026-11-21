const cacheName = __CACHE_NAME__
const files = __CACHE_FILES__

self.addEventListener('install', event => {
  const requests = Object.entries(files).map(([path, integrity]) =>
    new Request(path, { cache: 'reload', integrity }),
  )
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(requests)))
})

self.addEventListener('message', event => {
  if (event.data === 'activate-update') event.waitUntil(self.skipWaiting())
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

async function fromCache(pathname) {
  return caches.open(cacheName)
    .then(cache => cache.match(pathname))
    .catch(() => undefined)
}

async function navigate(request) {
  try {
    const response = await fetch(request, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    return response.ok ? response : (await fromCache('/')) ?? response
  } catch {
    return (await fromCache('/')) ?? Response.error()
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(navigate(request))
    }
  } else if (Object.hasOwn(files, url.pathname)) {
    event.respondWith(fromCache(url.pathname).then(cached => cached ?? fetch(request)))
  }
})
