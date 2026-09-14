import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick } from 'vue'
import { deferred, mountLogic } from './helpers/component.js'
import * as stockMarket from '../src/services/stockMarket.js'
import * as stockPreferences from '../src/services/stockPreferences.js'

const flush = async () => { await nextTick(); await nextTick() }
function setup() {
  const requests = [], news = [], boards = new Map()
  const request = (kind, date, signal) => {
    const task = { ...deferred(), kind, date, signal }; requests.push(task); return task.promise
  }
  const service = {
    billboard: (date, signal) => request('billboard', date, signal),
    limits: (date, signal) => request('limits', date, signal),
    scan: request,
    news: (stock, date, signal) => { const task = { ...deferred(), stock, date, signal }; news.push(task); return task.promise },
    flush() {},
    getBoard: key => boards.get(key) ?? null,
    saveBoard: (key, value) => boards.set(key, value),
  }
  const app = mountLogic('../../src/components/StockPage.vue', {
    '../services/stockMarket.js': { ...stockMarket, getStockMarket: () => service },
    '../services/stockPreferences.js': stockPreferences,
  })
  return { ...app, requests, news, boards }
}

test('快速切换榜单取消旧请求，迟到结果不会覆盖新榜单', async t => {
  const app = setup(); t.after(app.unmount)
  app.state.active.value = 'limits'; await flush()
  assert.equal(app.requests[0].signal.aborted, true)
  app.requests[1].resolve({ rows: [{ code: '000002', name: '测试二', boards: 2 }] }); await flush()
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }] }); await flush()
  assert.equal(app.state.rows.value[0].code, '000002')
  assert.equal(app.state.loading.value, false)
})

test('换股时取消旧新闻，迟到新闻不串到新股票', async t => {
  const app = setup(); t.after(app.unmount)
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }, { code: '000002', name: '测试二' }] }); await flush()
  app.state.selectedCode.value = '000002'; await flush()
  assert.equal(app.news[0].signal.aborted, true)
  app.news[1].resolve([{ title: '当前股票新闻' }]); await flush()
  app.news[0].resolve([{ title: '旧股票新闻' }]); await flush()
  assert.equal(app.state.articles.value[0].title, '当前股票新闻')
})

test('日期切换清空旧榜，当前请求失败不会展示过期数据', async t => {
  const app = setup(); t.after(app.unmount)
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }] }); await flush()
  app.state.date.value = '2026-08-01'; await flush()
  assert.equal(app.state.rows.value.length, 0)
  assert.equal(app.state.articles.value.length, 0)
  app.requests[1].reject(new Error('当前日期接口失败')); await flush()
  assert.equal(app.state.error.value, '当前日期接口失败')
  assert.equal(app.state.ready.value, false)
})

test('首板、两板、三板以上筛选和搜索重置分页', async t => {
  const app = setup(); t.after(app.unmount)
  app.state.active.value = 'limits'; await flush()
  app.requests[1].resolve({ rows: [1, 2, 3, 4].map(boards => ({ code: `00000${boards}`, name: `股票${boards}`, boards })) }); await flush()
  app.state.tier.value = '3'; await flush()
  assert.deepEqual(app.state.filtered.value.map(s => s.boards), [3, 4])
  app.state.page.value = 2
  app.state.query.value = '000004'; await flush()
  assert.equal(app.state.page.value, 1)
  assert.equal(app.state.filtered.value.length, 1)
  assert.equal(app.state.filtered.value[0].boards, 4)
})

test('离开股票页会取消榜单与新闻请求', async () => {
  const app = setup()
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }] }); await flush()
  app.unmount()
  assert.equal(app.requests[0].signal.aborted, true)
  assert.equal(app.news[0].signal.aborted, true)
})


test('刷新时保留已读榜单，失败明确标记且不改写获取时间', async t => {
  const app = setup(); t.after(app.unmount)
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }] }); await flush()
  const fetchedAt = app.state.result.value.fetchedAt
  const refreshing = app.state.load(true)
  assert.equal(app.state.rows.value[0].code, '000001')
  assert.equal(app.state.status.value, '更新中')
  app.requests[1].reject(new Error('刷新失败'))
  await refreshing; await flush()
  assert.equal(app.state.rows.value[0].code, '000001')
  assert.equal(app.state.status.value, '刷新失败')
  assert.equal(app.state.result.value.fetchedAt, fetchedAt)
})

test('切回一分钟内的榜单不重复请求，主题切换不触发行情请求', async t => {
  const app = setup(); t.after(app.unmount)
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }] }); await flush()
  app.state.active.value = 'limits'; await flush()
  app.requests[1].resolve({ rows: [] }); await flush()
  app.state.active.value = 'billboard'; await flush()
  assert.equal(app.requests.length, 2)
  assert.equal(app.state.rows.value[0].code, '000001')
  app.state.theme.value = 'blue'; await flush()
  assert.equal(app.requests.length, 2)
})

test('消息按12条递增加载，切换消息分类恢复首批', async t => {
  const app = setup(); t.after(app.unmount)
  app.requests[0].resolve({ rows: [{ code: '000001', name: '测试一' }] }); await flush()
  app.news[0].resolve(Array.from({ length: 36 }, (_, i) => ({ title: `消息${i}`, tone: 'positive' }))); await flush()
  assert.equal(app.state.visibleNews.value.length, 12)
  app.state.newsLimit.value += 12
  assert.equal(app.state.visibleNews.value.length, 24)
  app.state.newsFilter.value = 'positive'; await flush()
  assert.equal(app.state.visibleNews.value.length, 12)
})
