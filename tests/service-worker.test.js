import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { deferred } from './helpers/component.js'

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const scope = 'https://example.com/Study/'

function worker({ cache, fetchResponse = async () => new Response('network'), openError = false }) {
  const listeners = {}
  const context = vm.createContext({
    URL, Request,
    self: { registration: { scope }, addEventListener: (name, handler) => { listeners[name] = handler } },
    caches: { open: async () => { if (openError) throw new Error('SecurityError'); return cache } },
    fetch: fetchResponse,
  })
  vm.runInContext(source, context)
  return async (path, mode = 'cors') => {
    let response
    const background = []
    listeners.fetch({
      request: { url: `${scope}${path}`, method: 'GET', mode },
      respondWith(value) { response = value },
      waitUntil(value) { background.push(value) },
    })
    return { response: await response, background }
  }
}

test('缓存写入失败不会吞掉成功的页面或脚本响应', async () => {
  for (const [path, mode] of [['', 'navigate'], ['assets/app.js', 'cors']]) {
    const fetch = worker({ cache: { match: async () => undefined, put: async () => { throw new Error('QuotaExceededError') } } })
    const result = await fetch(path, mode)
    assert.equal(await result.response.text(), 'network')
    await Promise.all(result.background)
  }
})

test('后台缓存写入不阻塞资源返回', async () => {
  const write = deferred()
  const fetch = worker({ cache: { match: async () => undefined, put: () => write.promise, keys: async () => [] } })
  const result = await fetch('assets/app.js')
  assert.equal(await result.response.text(), 'network')
  write.resolve(); await Promise.all(result.background)
})

test('缓存打开或读取失败时仍请求网络', async () => {
  for (const options of [{ openError: true }, { cache: { match: async () => { throw new Error('cache damaged') } } }]) {
    const result = await worker(options)('assets/app.js')
    assert.equal(await result.response.text(), 'network')
    await Promise.all(result.background)
  }
})

test('离线导航回退到缓存首页，静态资源命中缓存后不请求网络', async () => {
  const fetch = worker({
    cache: { match: async request => request === scope || request.url?.endsWith('.js') ? new Response('cached') : undefined },
    fetchResponse: async () => { throw new Error('offline') },
  })
  assert.equal(await (await fetch('other', 'navigate')).response.text(), 'cached')
  assert.equal(await (await fetch('assets/app.js')).response.text(), 'cached')
})
