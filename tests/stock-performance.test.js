import assert from 'node:assert/strict'
import test from 'node:test'
import { createStockMarket, ENDPOINTS, shanghaiDate } from '../src/services/stockMarket.js'
import { MARKET_THEMES, readMarketTheme, saveMarketTheme } from '../src/services/stockPreferences.js'

test('300只股票命中均额缓存时，不请求历史、不等待500ms、不重复写盘', async t => {
  const date = shanghaiDate(), at = Date.now()
  const stocks = Array.from({ length: 300 }, (_, i) => ({ f12: String(i + 1).padStart(6, '0'), f13: 0, f14: '测试', f2: 10, f6: 400, f124: at / 1000 }))
  const items = Object.fromEntries(stocks.map(stock => [`baseline:${date}:0.${stock.f12}`, { at, value: { average: 100, baselineStart: '2026-08-17', baselineEnd: '2026-09-11' } }]))
  let reads = 0, writes = 0, network = 0
  const service = createStockMarket({
    storage: { getItem() { reads++; return JSON.stringify({ date, items }) }, setItem() { writes++ } },
    request: async endpoint => { network++; assert.equal(endpoint, ENDPOINTS.quotes); return { rc: 0, data: { total: stocks.length, diff: stocks } } },
  })
  assert.equal(reads, 0, '计算缓存不应阻塞股票首页初始化')
  const setTimeout = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    assert.notEqual(ms, 500, '缓存命中不应执行网络限速等待')
    return setTimeout(callback, ms, ...args)
  })
  const results = await service.scan('volume', date)
  assert.equal(results.complete, true)
  assert.equal(results.rows.length, 300)
  assert.equal(network, 1)
  assert.equal(reads, 1)
  service.flush()
  assert.equal(writes, 0)
})

test('榜单缓存限制容量和15分钟有效期', () => {
  const service = createStockMarket({ storage: null })
  for (let i = 0; i < 9; i++) service.saveBoard(`key${i}`, { savedAt: Date.now(), rows: [] })
  assert.equal(service.getBoard('key0'), null)
  assert.ok(service.getBoard('key8'))
  service.saveBoard('expired', { savedAt: Date.now() - 16 * 60000, rows: [] })
  assert.equal(service.getBoard('expired'), null)
})

test('三套主题默认明亮，记住选择并安全处理无效缓存', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage })
  let value = null
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => value, setItem: (_, next) => { value = next } } })
  assert.equal(MARKET_THEMES.length, 3)
  assert.equal(readMarketTheme(), 'light')
  for (const theme of MARKET_THEMES) { saveMarketTheme(theme.id); assert.equal(readMarketTheme(), theme.id) }
  value = 'invalid'
  assert.equal(readMarketTheme(), 'light')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
  assert.equal(readMarketTheme(), 'light')
  assert.doesNotThrow(() => saveMarketTheme('blue'))
})
