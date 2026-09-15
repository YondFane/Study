import assert from 'node:assert/strict'
import test from 'node:test'
import { createStockMarket, ENDPOINTS, shanghaiDate } from '../src/services/stockMarket.js'

const history = Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')},1,1,1,1,100,100`)
const stocks = count => Array.from({ length: count }, (_, i) => ({ f12: String(i + 1).padStart(6, '0'), f13: 0, f14: `股票${i}`, f2: 1, f6: 400, f124: Date.now() / 1000 }))
const pause = async () => {}

test('竞价扫描只取50只，失败补全后才标记全市场排名', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T10:00:00+08:00') })
  const date = shanghaiDate(), rows = stocks(55), updates = []
  let broken = true, calls = 0
  const market = createStockMarket({ storage: null, pause, request: async (endpoint, params) => {
    if (endpoint === ENDPOINTS.quotes) return { rc: 0, data: { total: rows.length, diff: rows } }
    assert.equal(endpoint, ENDPOINTS.auction)
    calls++
    const rank = Number(params.secid.split('.')[1])
    if (broken && rank === 55) throw new Error('竞价断连')
    return { rc: 0, data: { trends: [`${date} 09:26,1,1,1,1,1,${rank * 100},1`, `${date} 09:30,1,1,1,1,1,999999,1`] } }
  } })
  const partial = await market.scan('auction', date, undefined, undefined, value => updates.push(value))
  assert.equal(partial.complete, false)
  assert.equal(partial.failed, 1)
  assert.equal(partial.rows.length, 50)
  assert.equal(partial.rows[0].auction, 5400)
  assert.ok(updates.every(value => !value.complete && value.rows.length <= 50))
  broken = false
  const result = await market.scan('auction', date)
  assert.equal(result.complete, true)
  assert.equal(result.rows[0].auction, 5500)
  assert.equal(result.rows.at(-1).auction, 600)
  assert.equal(calls, 56, '成功竞价输入可复用，只重试失败股票')
})

test('失败页有限重试后保留部分榜单，续读仅请求失败页并复用已计算均额', async () => {
  const rows = stocks(101), pages = [], waits = []
  let broken = true, histories = 0
  const market = createStockMarket({ storage: null, pause: async ms => { waits.push(ms) }, request: async (endpoint, params) => {
    if (endpoint === ENDPOINTS.quotes) {
      pages.push(params.pn)
      if (params.pn === 2 && broken) throw new Error('连接断开')
      return { rc: 0, data: { total: 101, diff: rows.slice((params.pn - 1) * 100, params.pn * 100) } }
    }
    histories++
    return { rc: 0, data: { klines: history } }
  } })
  const partial = await market.scan('volume', shanghaiDate())
  assert.deepEqual(pages, [1, 2, 2, 2])
  assert.ok(waits.includes(1000) && waits.includes(2000))
  assert.equal(partial.complete, false)
  assert.equal(partial.rows.length, 100)
  assert.equal(partial.quoteReceived, 100)
  assert.equal(partial.quoteTotal, 101)
  assert.match(partial.warning, /第 2 页/)
  broken = false
  const complete = await market.scan('volume', shanghaiDate())
  assert.deepEqual(pages, [1, 2, 2, 2, 2])
  assert.equal(histories, 101)
  assert.equal(complete.complete, true)
  assert.equal(complete.rows.length, 101)
})

test('重试恢复后继续完整扫描；首次页面全失败时给出页码且不生成空榜', async () => {
  let calls = 0
  const market = createStockMarket({ storage: null, pause, request: async endpoint => {
    if (endpoint === ENDPOINTS.quotes) {
      if (++calls === 1) throw new Error('暂时断连')
      return { rc: 0, data: { total: 1, diff: stocks(1) } }
    }
    return { rc: 0, data: { klines: history } }
  } })
  assert.equal((await market.scan('volume', shanghaiDate())).complete, true)
  assert.equal(calls, 2)
  let failures = 0
  const broken = createStockMarket({ storage: null, pause, request: async () => { failures++; throw new Error('断连') } })
  await assert.rejects(broken.scan('volume', shanghaiDate()), /第 1 页/)
  assert.equal(failures, 3)
})

test('个股连续失败暂停后返回已算结果，流式快照始终标记为不完整', async t => {
  const rows = stocks(60), updates = []
  let now = Date.now(), requests = 0
  t.mock.method(Date, 'now', () => { now += 600; return now })
  const market = createStockMarket({ storage: null, pause, request: async (endpoint, params) => {
    if (endpoint === ENDPOINTS.quotes) return { rc: 0, data: { total: rows.length, diff: rows } }
    requests++
    if (params.secid !== '0.000001') throw new Error('数据源断开')
    return { rc: 0, data: { klines: history } }
  } })
  const result = await market.scan('volume', shanghaiDate(), undefined, undefined, value => updates.push(value))
  assert.equal(result.rows.length, 1)
  assert.equal(result.complete, false)
  assert.ok(result.pending > 0 && requests < rows.length)
  assert.equal(result.scanned + result.pending, rows.length)
  assert.match(result.warning, /已暂停扫描/)
  assert.ok(updates.some(value => value.rows.length === 1 && value.scanned < result.scanned))
  assert.ok(updates.every(value => value.complete === false))
  assert.equal(updates[0].rows.length, 0, '旧快照不能被后续数组修改')
})

test('重试等待期间取消立即结束，不再请求后续页', async () => {
  const controller = new AbortController()
  let requests = 0
  const market = createStockMarket({ storage: null, request: async () => { requests++; throw new Error('断连') } })
  await assert.rejects(market.scan('volume', shanghaiDate(), controller.signal, () => controller.abort()), { name: 'AbortError' })
  assert.equal(requests, 1)
})

test('过期断点从第一页重建，避免把过旧行情拼进新结果', async t => {
  const rows = stocks(101), pages = []
  const at = Date.now()
  let now = at
  t.mock.method(Date, 'now', () => now)
  const market = createStockMarket({ storage: null, pause, request: async (endpoint, params) => {
    if (endpoint === ENDPOINTS.quotes) {
      pages.push(params.pn)
      if (params.pn === 2) throw new Error('断连')
      return { rc: 0, data: { total: 101, diff: rows.slice(0, 100) } }
    }
    return { rc: 0, data: { klines: history } }
  } })
  await market.scan('volume', shanghaiDate())
  now = at + 16 * 60000
  await market.scan('volume', shanghaiDate())
  assert.deepEqual(pages, [1, 2, 2, 2, 1, 2, 2, 2])
})

test('重复分页不报全市场完成，并在下次重建证券列表', async () => {
  const rows = stocks(100), pages = []
  const market = createStockMarket({ storage: null, pause, request: async (endpoint, params) => {
    if (endpoint === ENDPOINTS.quotes) {
      pages.push(params.pn)
      return { rc: 0, data: { total: 101, diff: rows } }
    }
    return { rc: 0, data: { klines: history } }
  } })
  const result = await market.scan('volume', shanghaiDate())
  assert.equal(result.complete, false)
  assert.match(result.warning, /分页重复/)
  await market.scan('volume', shanghaiDate())
  assert.deepEqual(pages, [1, 2, 1, 2])
})
