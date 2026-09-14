import assert from 'node:assert/strict'
import test from 'node:test'
import { auctionAmount, createStockMarket, ENDPOINTS, money, newsTone, normalizeBillboard, number, percent, publicRequest, safeUrl, shanghaiDate, volumeComparison } from '../src/services/stockMarket.js'

const date = '2026-09-14'
const kline = (day, amount) => `${day},1,1,1,1,100,${amount}`
const history = Array.from({ length: 20 }, (_, i) => kline(`2026-08-${String(i + 1).padStart(2, '0')}`, 100))
const trend = (time, amount, day = date) => `${day} ${time},1,1,1,1,10,${amount},1`

test('成交额以此前20日为基准，排除当天并严格大于3倍', () => {
  const input = [...history, kline(date, 999999)].reverse()
  assert.equal(volumeComparison(input, date, 301).ratio, 3.01)
  assert.equal(volumeComparison(input, date, 300).ratio > 3, false)
  assert.equal(volumeComparison(input, date, 301).average, 100)
  assert.equal(volumeComparison(input, date, 301).baselineEnd, '2026-08-20')
})

test('历史不足、重复日期、缺失字段及零基准不会伪造爆量倍数', () => {
  assert.equal(volumeComparison(history.slice(1), date, 1000), null)
  assert.equal(volumeComparison([...history.slice(1), history[1]], date, 1000), null)
  assert.equal(volumeComparison(history.map(row => row.replace(/100$/, '0')), date, 1000), null)
  assert.equal(volumeComparison([...history.slice(1), kline('2026-08-01', '-')], date, 1000), null)
  assert.equal(volumeComparison(history, date, null), null)
})

test('竞价汇总09:25到09:30前，包含09:26记账而不混入连续竞价或其他日期', () => {
  assert.equal(auctionAmount([trend('09:24', 999), trend('09:25', 0), trend('09:26', 200), trend('09:29', 100), trend('09:30', 900), trend('09:31', 800), trend('09:26', 5555, '2026-09-11')], date), 300)
  assert.equal(auctionAmount([trend('09:25', 0), trend('09:30', 0)], date), 0)
  assert.equal(auctionAmount([trend('09:26', 200)], date), null)
  assert.equal(auctionAmount([trend('09:30', 200)], date), null)
  assert.equal(auctionAmount([trend('09:26', '-'), trend('09:30', 0)], date), null)
})

test('龙虎榜去重合并原因，重叠披露不累计金额', () => {
  const base = { SECURITY_CODE: '000001', SECURITY_NAME_ABBR: '平安银行', TRADE_DATE: date, BILLBOARD_NET_AMT: 200 }
  const rows = normalizeBillboard([{ ...base, EXPLANATION: '日涨幅偏离' }, { ...base, EXPLANATION: '三日涨幅偏离', BILLBOARD_NET_AMT: 500 }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].reason, '日涨幅偏离；三日涨幅偏离')
  assert.equal(rows[0].net, 200)
  assert.equal(rows[0].price, null)
})

test('展示区分缺失值和0，新闻链接拒绝脚本协议', () => {
  for (const value of [null, undefined, '', '-', NaN, Infinity]) { assert.equal(number(value), null); assert.equal(money(value), '—') }
  assert.equal(money(0), '0.00')
  assert.equal(percent(0), '0.00%')
  assert.equal(percent(10, true), '+10.00%')
  assert.equal(safeUrl('javascript:alert(1)'), '')
  assert.equal(safeUrl('http://finance.eastmoney.com/a/1.html'), 'https://finance.eastmoney.com/a/1.html')
  assert.equal(shanghaiDate(new Date('2026-09-13T17:00:00Z')), date)
})

test('消息关键词分类保留中性与否定情况，不推断行业新闻为个股利好', () => {
  assert.equal(newsTone('平安银行：拟回购股份', '平安银行'), 'positive')
  assert.equal(newsTone('平安银行：被罚30万元', '平安银行'), 'negative')
  assert.equal(newsTone('平安银行：不存在回购计划', '平安银行'), 'neutral')
  assert.equal(newsTone('银行业迎政策利好', '平安银行'), 'neutral')
  assert.equal(newsTone('平安银行：增持与减持公告', '平安银行'), 'neutral')
})

test('新闻按时间排序，仅包含截止所选日期的近期相关安全链接', async () => {
  const article = (title, day, code) => ({ title, date: `${day} 12:00:00`, code, content: '平安银行消息', mediaName: '来源' })
  const service = createStockMarket({ storage: null, request: async (endpoint, params) => {
    assert.equal(endpoint, ENDPOINTS.news)
    assert.equal(JSON.parse(params.param).param.cmsArticleWebOld.sort, 'time')
    return { code: 0, result: { cmsArticleWebOld: [article('<em>平安银行</em>：拟回购', date, '1'), article('平安银行：被罚', '2026-09-13', '2'), article('平安银行旧新闻', '2025-09-01', '3'), article('平安银行未来新闻', '2026-09-15', '4'), { ...article('平安银行恶意链接', date, '5'), url: 'javascript:alert(1)' }] } }
  } })
  const rows = await service.news({ code: '000001', name: '平安银行' }, date)
  assert.deepEqual(rows.map(row => row.tone), ['positive', 'negative'])
  assert.equal(rows[0].title, '平安银行：拟回购')
})

test('龙虎榜读取全部分页，不将API错误当空榜', async () => {
  let calls = 0
  const service = createStockMarket({ storage: null, request: async (_, params) => {
    calls++
    return { success: true, result: { pages: 2, data: [{ SECURITY_CODE: params.pageNumber === 1 ? '000001' : '000002', TRADE_DATE: date }] } }
  } })
  assert.equal((await service.billboard(date)).rows.length, 2)
  assert.equal(calls, 2)
  const broken = createStockMarket({ storage: null, request: async () => ({ success: false, code: 500, message: '来源失败' }) })
  await assert.rejects(broken.billboard(date), /来源失败/)
})

test('天梯榜按连板排序并拒绝跨日期的涨停原因', async () => {
  const service = createStockMarket({ storage: null, request: async endpoint => endpoint === ENDPOINTS.limits
    ? { rc: 0, data: { qdate: 20260914, pool: [{ c: '000001', lbc: 1, fund: 900, p: 12340 }, { c: '000002', lbc: 3, fund: 100 }] } }
    : { code: 20000, data: [{ symbol: '000001.SZ', last_limit_up: Date.parse('2026-09-11T06:00Z') / 1000, surge_reason: { stock_reason: '旧日期原因' } }] } })
  const result = await service.limits(date)
  assert.equal(result.rows[0].boards, 3)
  assert.equal(result.rows[1].price, 12.34)
  assert.equal(result.rows[1].reason, '')
})

test('扫描完整股票集合，对失败明确标记，成功结果按倍数排序', async () => {
  const today = shanghaiDate()
  const service = createStockMarket({ storage: null, request: async (endpoint, params) => {
    if (endpoint === ENDPOINTS.quotes) return { rc: 0, data: { total: 4, diff: [301, 300, 450, 500].map((amount, index) => ({ f12: `00000${index + 1}`, f13: 0, f14: '测试数据仅在单元测试中', f2: 1, f6: amount, f124: Date.now() / 1000 })) } }
    if (params.secid === '0.000004') throw new Error('network')
    return { rc: 0, data: { klines: history } }
  } })
  const result = await service.scan('volume', today)
  assert.deepEqual(result.rows.map(row => row.ratio), [4.5, 3.01])
  assert.equal(result.complete, false)
  assert.equal(result.failed, 1)
  assert.equal(result.total, 4)
})

test('请求取消不会返回部分数据作为完整榜单', async () => {
  const controller = new AbortController()
  const service = createStockMarket({ storage: null, request: async () => {
    controller.abort()
    return { rc: 0, data: { total: 1, diff: [{ f12: '000001', f2: 1, f6: 1000, f124: Date.now() / 1000 }] } }
  } })
  await assert.rejects(service.scan('volume', shanghaiDate(), controller.signal), { name: 'AbortError' })
})

test('缓存被禁用或损坏不会阻止公开行情读取', async () => {
  for (const storage of [{ getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('Quota') } }, { getItem: () => '{broken' }]) {
    const service = createStockMarket({ storage, request: async () => ({ code: 9201, success: false, result: null }) })
    assert.equal((await service.billboard(date)).rows.length, 0)
    service.flush()
  }
})

test('龙虎榜使用callback，其余行情使用cb，取消与超时清理请求', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const previousDocument = globalThis.document
  const scripts = []
  globalThis.document = {
    createElement: () => ({ remove() { this.removed = true } }),
    head: { append(script) { scripts.push(script) } },
  }
  t.after(() => { globalThis.document = previousDocument })
  for (const endpoint of [ENDPOINTS.billboard, ENDPOINTS.limits, ENDPOINTS.history, ENDPOINTS.news]) {
    const promise = publicRequest(endpoint, { q: '测试' })
    const script = scripts.at(-1), url = new URL(script.src)
    const callback = url.searchParams.get(endpoint === ENDPOINTS.billboard ? 'callback' : 'cb')
    assert.ok(callback)
    globalThis[callback]({ result: 'real-callback-shape' })
    assert.deepEqual(await promise, { result: 'real-callback-shape' })
    assert.equal(script.removed, true)
  }
  const controller = new AbortController()
  const pending = publicRequest(ENDPOINTS.history, {}, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(scripts.at(-1).removed, true)
  const timeout = publicRequest(ENDPOINTS.news)
  t.mock.timers.tick(15000)
  await assert.rejects(timeout, /超时/)
  t.mock.timers.tick(60000)
})
