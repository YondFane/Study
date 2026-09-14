// Public web endpoints: no account, private token or API key is required.
export const ENDPOINTS = {
  billboard: 'https://datacenter-web.eastmoney.com/api/data/v1/get',
  limits: 'https://push2ex.eastmoney.com/getTopicZTPool',
  quotes: 'https://push2.eastmoney.com/api/qt/clist/get',
  history: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
  auction: 'https://push2.eastmoney.com/api/qt/stock/trends2/get',
  news: 'https://search-api-web.eastmoney.com/search/jsonp',
  reasons: 'https://flash-api.xuangubao.cn/api/pool/detail',
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
export function shanghaiDate(value = new Date()) { return dateFormatter.format(value) }

export function number(value) {
  return value === null || value === undefined || value === '' || value === '-' || !Number.isFinite(Number(value)) ? null : Number(value)
}

export function money(value) {
  const n = number(value)
  if (n === null) return '—'
  const size = Math.abs(n)
  return size >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : size >= 1e4 ? `${(n / 1e4).toFixed(2)}万` : n.toFixed(2)
}

export function percent(value, signed = false) {
  const n = number(value)
  return n === null ? '—' : `${signed && n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

const textOnly = (value) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
export function safeUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href.replace(/^http:/, 'https:') : '' } catch { return '' }
}

let callbackId = 0
export function publicRequest(endpoint, params = {}, { signal } = {}) {
  if (!Object.values(ENDPOINTS).includes(endpoint)) return Promise.reject(new Error('未知行情数据源'))
  if (signal?.aborted) return Promise.reject(new DOMException('请求已停止', 'AbortError'))
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  if (endpoint === ENDPOINTS.reasons) {
    return fetch(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]), credentials: 'omit' })
      .then(r => { if (!r.ok) throw new Error(`数据源返回 HTTP ${r.status}`); return r.json() })
  }
  // These providers expose JSONP, so the same build also works on GitHub Pages.
  return new Promise((resolve, reject) => {
    const callback = `__studyMarket_${Date.now()}_${++callbackId}`
    const script = document.createElement('script')
    let timer
    const cleanup = (late = false) => {
      clearTimeout(timer)
      script.remove()
      signal?.removeEventListener('abort', abort)
      // A cancelled script can still arrive late. Leave a short-lived no-op callback.
      if (late) {
        globalThis[callback] = () => {}
        setTimeout(() => { delete globalThis[callback] }, 60000)
      } else delete globalThis[callback]
    }
    const fail = (error) => { cleanup(true); reject(error) }
    const abort = () => fail(new DOMException('请求已停止', 'AbortError'))
    globalThis[callback] = (payload) => { cleanup(); resolve(payload) }
    url.searchParams.set(endpoint === ENDPOINTS.billboard ? 'callback' : 'cb', callback)
    script.src = url.href
    script.referrerPolicy = 'no-referrer'
    script.onerror = () => fail(new Error('公开数据源连接失败，请稍后重试'))
    timer = setTimeout(() => fail(new Error('公开数据源响应超时，请稍后重试')), 15000)
    signal?.addEventListener('abort', abort, { once: true })
    document.head.append(script)
  })
}

export function normalizeBillboard(rows) {
  const stocks = new Map()
  for (const item of rows) {
    const code = item.SECURITY_CODE
    if (!/^\d{6}$/.test(code)) continue
    const reason = textOnly(item.EXPLANATION)
    if (stocks.has(code)) {
      const stock = stocks.get(code)
      if (reason && !stock.reasons.includes(reason)) stock.reasons.push(reason)
      stock.reason = stock.reasons.join('；')
      continue
    }
    stocks.set(code, {
      code, name: textOnly(item.SECURITY_NAME_ABBR), price: number(item.CLOSE_PRICE),
      change: number(item.CHANGE_RATE), turnover: number(item.TURNOVERRATE),
      amount: number(item.ACCUM_AMOUNT), net: number(item.BILLBOARD_NET_AMT),
      buy: number(item.BILLBOARD_BUY_AMT), sell: number(item.BILLBOARD_SELL_AMT),
      date: String(item.TRADE_DATE).slice(0, 10), reasons: reason ? [reason] : [], reason,
    })
  }
  // Never sum overlapping daily and three-day disclosure windows.
  return [...stocks.values()].sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity))
}

export function volumeComparison(klines, date, amount) {
  const rows = klines.map(line => { const f = line.split(','); return { date: f[0], amount: number(f[6]) } })
    .filter(row => row.date < date).sort((a, b) => a.date.localeCompare(b.date))
  const previous = [...new Map(rows.map(row => [row.date, row])).values()].slice(-20)
  if (previous.length !== 20 || previous.some(row => row.amount === null || row.amount < 0)) return null
  const average = previous.reduce((sum, row) => sum + row.amount, 0) / 20
  const current = number(amount)
  if (average <= 0 || current === null || current < 0) return null
  return { average, ratio: current / average, baselineStart: previous[0].date, baselineEnd: previous[19].date }
}

export function auctionAmount(trends, date) {
  const rows = trends.map(line => line.split(',')).filter(f => f[0].startsWith(`${date} `))
  // The provider buckets 09:25 executions in the 09:26 minute in some stocks.
  // 09:30 and later bars are deliberately excluded from the opening auction.
  if (!rows.some(f => f[0].slice(11, 16) >= '09:30')) return null
  const window = rows.filter(f => f[0].slice(11, 16) >= '09:25' && f[0].slice(11, 16) < '09:30')
  if (!window.length || window.some(f => number(f[6]) === null || number(f[6]) < 0)) return null
  return window.reduce((sum, f) => sum + number(f[6]), 0)
}

// Classification is intentionally conservative and remains a labelled keyword hint.
export function newsTone(title, stockName) {
  const name = textOnly(stockName).replace(/\s/g, '')
  const normalized = textOnly(title).replace(/\s/g, '')
  if (!name || !normalized.includes(name) || /否认|不涉及|未涉及|无.*计划|尚未|不构成|不存在|终止回购/.test(normalized)) return 'neutral'
  const positive = /预增|扭亏|中标|签订.*合同|获批|回购|增持|净利.*增长/.test(normalized)
  const negative = /预亏|亏损|减持|立案|处罚|被罚|违约|退市|下修|净利.*下降/.test(normalized)
  return positive === negative ? 'neutral' : positive ? 'positive' : 'negative'
}

function requireData(payload) {
  if (!payload || (payload.rc !== undefined && payload.rc !== 0)) throw new Error('公开行情接口返回异常')
  return payload.data
}

export function createStockMarket({ request = publicRequest, storage } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage } catch { /* restricted storage */ } }
  const memory = new Map()
  // A single bounded cache, containing only provider results and calculation inputs.
  let persisted, dirty = false
  function inputs() {
    const date = shanghaiDate()
    if (!persisted) {
      try { const cached = JSON.parse(storage?.getItem('study-market:inputs:v1') ?? 'null'); if (cached?.date === date && cached.items && typeof cached.items === 'object') persisted = cached } catch { /* optional cache */ }
    }
    if (persisted?.date !== date) persisted = { date, items: {} }
    return persisted
  }
  const boards = new Map()
  function getBoard(key) {
    const board = boards.get(key)
    if (board && Date.now() - board.savedAt < 15 * 60000) return board
    boards.delete(key)
    return null
  }
  function saveBoard(key, value) {
    boards.delete(key)
    boards.set(key, value)
    if (boards.size > 8) boards.delete(boards.keys().next().value)
  }
  let writes = 0
  function flush() {
    if (!dirty || !persisted) return
    try { storage?.setItem('study-market:inputs:v1', JSON.stringify(persisted)); dirty = false } catch { /* quota/privacy must not block quotes */ }
  }
  async function cached(key, ttl, loader, durable = false) {
    const entry = memory.get(key) ?? (durable ? inputs().items[key] : null)
    if (entry && Date.now() - entry.at < ttl) return entry.value
    const value = await loader()
    const updated = { at: Date.now(), value }
    memory.set(key, updated)
    if (memory.size > 12000) memory.delete(memory.keys().next().value)
    if (durable) { inputs().items[key] = updated; dirty = true; if (++writes % 500 === 0) flush() }
    return value
  }
  const api = (type, params, signal) => request(ENDPOINTS[type], params, { signal })

  async function billboard(date, signal) {
    const params = { reportName: 'RPT_DAILYBILLBOARD_DETAILS', columns: 'ALL', pageSize: 500,
      sortColumns: 'TRADE_DATE,SECURITY_CODE', sortTypes: '-1,1', filter: `(TRADE_DATE='${date}')` }
    const rows = []
    for (let pageNumber = 1; ; pageNumber++) {
      const payload = await api('billboard', { ...params, pageNumber }, signal)
      if (!payload.success && payload.code !== 9201) throw new Error(payload.message || '龙虎榜接口异常')
      if (!payload.result) return { rows: [], date, note: '该日期尚无龙虎榜披露。龙虎榜通常在收盘后公布，休市日不更新。' }
      if (!Array.isArray(payload.result.data)) throw new Error('龙虎榜数据格式已变化')
      rows.push(...payload.result.data)
      if (pageNumber >= payload.result.pages) break
      if (pageNumber > 20) throw new Error('龙虎榜分页异常，请重试')
    }
    return { rows: normalizeBillboard(rows.filter(row => String(row.TRADE_DATE).startsWith(date))), date,
      note: '按龙虎榜净买入排序；同股多条上榜原因合并。金额取首条披露口径，不叠加重叠统计区间。' }
  }

  async function limits(date, signal) {
    // Start independent pool and editorial requests together, avoiding serial latency.
    const reasonTask = cached(`reasons:${date}`, 60000, () => api('reasons', { pool_name: 'limit_up' }, signal))
      .then(value => ({ value }), error => ({ error }))
    const payload = await api('limits', { ut: '7eea3edcaed734bea9cbfc24409ed989', dpt: 'wz.ztzt', Pageindex: 0,
      pagesize: 10000, sort: 'fbt:asc', date: date.replaceAll('-', '') }, signal)
    const data = requireData(payload)
    if (!data) return { rows: [], date, note: '该日期暂无涨停池数据，可能尚未开盘、休市或超出接口历史范围。' }
    if (String(data.qdate) !== date.replaceAll('-', '')) throw new Error('涨停池返回日期与所选日期不一致')
    if (!Array.isArray(data.pool)) throw new Error('涨停池数据格式已变化')
    if (number(data.tc) !== null && data.tc > data.pool.length) throw new Error('涨停池返回不完整，请重新获取')
    let reasons = [], reasonNote = ''
    try {
      const reasonResult = await reasonTask
      if (reasonResult.error) throw reasonResult.error
      const reasonPayload = reasonResult.value
      if (reasonPayload.code !== 20000 || !Array.isArray(reasonPayload.data)) throw new Error('原因接口异常')
      reasons = reasonPayload.data.filter(row => row.last_limit_up && shanghaiDate(new Date(row.last_limit_up * 1000)) === date)
      if (!reasons.length) reasonNote = '；所选日期的涨停原因暂不可用'
    } catch (e) { if (signal?.aborted) throw e; reasonNote = '；涨停原因源暂不可用，可查看个股新闻' }
    const reasonMap = new Map(reasons.map(row => [row.symbol.split('.')[0], row]))
    return { date, rows: data.pool.map(row => ({
      code: row.c, name: row.n, price: number(row.p) === null ? null : row.p / 1000, change: number(row.zdp),
      amount: number(row.amount), turnover: number(row.hs), boards: number(row.lbc), seal: number(row.fund),
      firstSeal: String(row.fbt).padStart(6, '0').replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3'),
      industry: row.hybk, reason: textOnly(reasonMap.get(row.c)?.surge_reason?.stock_reason), date,
    })).sort((a, b) => b.boards - a.boards || b.seal - a.seal),
    note: `东方财富涨停池口径（不含 ST、科创板及未开板新股）；原因来自选股宝，仅匹配同一交易日${reasonNote}。` }
  }

  async function quotes(date, signal, onProgress) {
    return cached(`quotes:${date}`, 60000, async () => {
      const rows = new Map()
      let total = 0
      // Stable code order prevents changing intraday turnover ranks from duplicating pages.
      for (let pn = 1; ; pn++) {
        const data = requireData(await api('quotes', { pn, pz: 100, po: 0, np: 1, fltt: 2, invt: 2, fid: 'f12',
          fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048', fields: 'f12,f13,f14,f2,f3,f6,f8,f124' }, signal))
        if (!Array.isArray(data?.diff) || !data.diff.length) throw new Error('全市场行情分页缺失，无法生成完整榜单')
        total = number(data.total)
        if (!total || total < 0) throw new Error('全市场行情总数异常，无法确认扫描范围')
        for (const r of data.diff) rows.set(r.f12, { code: r.f12, market: r.f13, name: r.f14, price: number(r.f2),
          change: number(r.f3), amount: number(r.f6), turnover: number(r.f8),
          date: r.f124 ? shanghaiDate(new Date(r.f124 * 1000)) : '', quoteTime: r.f124 })
        onProgress?.({ phase: '正在读取全市场股票', done: rows.size, total, failed: 0, excluded: 0 })
        if (rows.size >= total) break
        if (pn > Math.ceil(total / 100) + 2) throw new Error('全市场行情分页不完整，请重试')
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      const active = [...rows.values()].filter(row => row.amount > 0 && row.price > 0)
      if (!active.some(row => row.date === date)) throw new Error('行情源尚无所选日期成交数据。爆量与竞价仅支持当日，请在交易开始后重试。')
      if (active.some(row => row.date !== date)) throw new Error('全市场行情混有其他日期，无法确认当日完整排名，请稍后重试')
      return active
    })
  }

  async function scan(kind, date, signal, onProgress) {
    if (date !== shanghaiDate()) throw new Error('爆量榜和竞价榜仅支持当日数据，请选择今天。')
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
    if (kind === 'auction' && clock < '09:30') throw new Error('开盘竞价成交额将在 09:30 后确认，请稍后刷新。')
    const stocks = await quotes(date, signal, onProgress)
    const rows = []
    let cursor = 0, done = 0, failed = 0, excluded = 0, consecutiveFailures = 0
    const startedAt = new Date().toISOString()
    let stoppedBySource = false
    let lastProgressAt = 0
    const progress = (force = false) => {
      if (!force && Date.now() - lastProgressAt < 150 && done !== stocks.length) return
      lastProgressAt = Date.now()
      onProgress?.({ phase: kind === 'volume' ? '核对前 20 个交易日成交额' : '核对开盘集合竞价成交额', done, total: stocks.length, failed, excluded })
    }
    progress()
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (cursor < stocks.length && !signal?.aborted && !stoppedBySource) {
        const stock = stocks[cursor++]
        const secid = `${stock.market ?? (stock.code.startsWith('6') ? 1 : 0)}.${stock.code}`
        let usedNetwork = false
        try {
          if (kind === 'volume') {
            const baseline = await cached(`baseline:${date}:${secid}`, 86400000, async () => {
              usedNetwork = true
              const data = requireData(await api('history', { secid, klt: 101, fqt: 0, lmt: 21,
                end: date.replaceAll('-', ''), fields1: 'f1,f2,f3', fields2: 'f51,f52,f53,f54,f55,f56,f57' }, signal))
              if (!Array.isArray(data?.klines) || !data.klines.length) throw new Error('历史数据缺失')
              const comparison = volumeComparison(data.klines, date, 1)
              // Store a small, auditable baseline instead of thousands of full OHLC arrays.
              if (!comparison) return null
              return { average: comparison.average, baselineStart: comparison.baselineStart, baselineEnd: comparison.baselineEnd }
            }, true)
            if (!baseline) excluded++
            else if (stock.amount / baseline.average > 3) rows.push({ ...stock, ...baseline, ratio: stock.amount / baseline.average })
          } else {
            const amount = await cached(`auction:${date}:${secid}`, 86400000, async () => {
              usedNetwork = true
              const data = requireData(await api('auction', { secid, fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11',
                fields2: 'f51,f52,f53,f54,f55,f56,f57,f58', ndays: 1, iscr: 1, iscca: 1 }, signal))
              if (!Array.isArray(data?.trends)) throw new Error('竞价分时数据缺失')
              const amount = auctionAmount(data.trends, date)
              if (amount === null) throw new Error('当日竞价成交数据尚未完整')
              return amount
            }, true)
            if (amount > 0) rows.push({ ...stock, auction: amount })
          }
          consecutiveFailures = 0
        } catch (e) {
          if (signal?.aborted) break
          failed++
          if (++consecutiveFailures >= 18) stoppedBySource = true
        }
        done++
        progress()
        // Bound request rate as well as concurrency; do not hammer public endpoints.
        if (usedNetwork) await new Promise(resolve => setTimeout(resolve, 500))
        else if (done % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
    }))
    flush()
    if (signal?.aborted) throw new DOMException('请求已停止', 'AbortError')
    if (stoppedBySource) throw new Error('公开接口连续失败，已停止扫描以避免持续请求。已成功读取的计算输入已缓存，请稍后重试。')
    rows.sort((a, b) => kind === 'volume' ? b.ratio - a.ratio : b.auction - a.auction)
    const complete = failed === 0 && done === stocks.length
    return { rows: kind === 'auction' ? rows.slice(0, 50) : rows, date, complete, scanned: done, total: stocks.length,
      failed, excluded, startedAt, note: kind === 'volume'
        ? `当日成交额 / 前 20 个交易日平均成交额 > 3；不含当日，使用未复权成交额。已核对 ${done}/${stocks.length} 只，${excluded} 只历史不足或基准无效，${failed} 只请求失败。盘中成交额尚未收齐。`
        : `汇总 09:25–09:30 前的分时成交额（含接口 09:26 记账），不含连续竞价。已核对 ${done}/${stocks.length} 只，${failed} 只缺失。${complete ? '全市场前 50 名。' : '当前仅为已读取股票中的前 50 名，非完整全市场排名。'}` }
  }

  async function news(stock, date, signal) {
    return cached(`news:${stock.code}:${date}`, 300000, async () => {
      const param = { uid: '', keyword: stock.name, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
        param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: 100, preTag: '', postTag: '' } } }
      const payload = await api('news', { param: JSON.stringify(param) }, signal)
      if (payload.code !== 0 || !Array.isArray(payload.result?.cmsArticleWebOld)) throw new Error('新闻接口暂不可用')
      const cutoff = new Date(`${date}T00:00:00+08:00`).getTime() - 7 * 86400000
      const end = new Date(`${date}T23:59:59+08:00`).getTime()
      const seen = new Set()
      return payload.result.cmsArticleWebOld.map(item => ({ title: textOnly(item.title), content: textOnly(item.content),
        date: item.date, source: textOnly(item.mediaName), url: safeUrl(item.url || `https://finance.eastmoney.com/a/${item.code}.html`) }))
        .filter(item => {
          const timestamp = Date.parse(`${item.date.replace(' ', 'T')}+08:00`)
          const relevant = `${item.title}${item.content}`.replace(/\s/g, '').includes(stock.name.replace(/\s/g, ''))
          if (!item.url || !relevant || timestamp < cutoff || timestamp > end || !Number.isFinite(timestamp) || seen.has(item.url)) return false
          seen.add(item.url); return true
        }).map(item => ({ ...item, tone: newsTone(item.title, stock.name) }))
        .sort((a, b) => b.date.localeCompare(a.date))
    })
  }

  return { billboard, limits, scan, news, flush, getBoard, saveBoard }
}

let sharedMarket
export function getStockMarket() { return sharedMarket ??= createStockMarket() }
