const CACHE_PREFIX = 'study-english-runtime-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const MAX_CACHED_FILES = 80

async function openRuntimeCache() {
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return undefined
  }
}

async function matchCached(cache, request) {
  try {
    return await cache?.match(request)
  } catch {
    return undefined
  }
}

async function trimCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_CACHED_FILES) return
  await Promise.all(keys.slice(0, keys.length - MAX_CACHED_FILES).map((key) => cache.delete(key)))
}

function cacheResponse(event, cachePromise, request, response) {
  if (!response?.ok || response.type === 'opaque') return response
  // 先复制响应并交给后台写入；配额不足、缓存损坏都不能拖慢或吞掉网络响应。
  const copy = response.clone()
  event.waitUntil(cachePromise.then(async (cache) => {
    if (!cache) return
    await cache.put(request, copy)
    await trimCache(cache)
  }).catch(() => undefined))
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    openRuntimeCache()
      .then((cache) => cache?.add(new Request(self.registration.scope, { cache: 'reload' })))
      .catch(() => undefined),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .catch(() => undefined),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const scopeUrl = new URL(self.registration.scope)
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cachePromise = openRuntimeCache()
      try {
        const response = await fetch(request)
        return cacheResponse(event, cachePromise, request, response)
      } catch (error) {
        const cache = await cachePromise
        const cached = (await matchCached(cache, request)) || (await matchCached(cache, self.registration.scope))
        if (cached) return cached
        throw error
      }
    })())
    return
  }

  if (!url.pathname.includes('/assets/')) return

  event.respondWith((async () => {
    const cachePromise = openRuntimeCache()
    const cached = await matchCached(await cachePromise, request)
    if (cached) return cached
    return cacheResponse(event, cachePromise, request, await fetch(request))
  })())
})
