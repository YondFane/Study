<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { getStockMarket, money, number, percent, shanghaiDate } from '../services/stockMarket.js'
import { MARKET_THEMES, readMarketTheme, saveMarketTheme } from '../services/stockPreferences.js'

defineEmits(['back'])
const market = getStockMarket()
const theme = ref(readMarketTheme())
watch(theme, saveMarketTheme)
const tabs = [
  { id: 'billboard', label: '龙虎榜', en: 'DRAGON & TIGER', icon: '◎', title: '循资金足迹，看市场焦点。', description: '追踪异常交易与席位资金，结合近期消息读懂每一次上榜。' },
  { id: 'limits', label: '天梯榜', en: 'LIMIT-UP LADDER', icon: '▥', title: '沿连板梯队，发现强势股。', description: '从首板到高位连板，查看涨停逻辑、封单资金与筹码换手。' },
  { id: 'volume', label: '爆量榜', en: 'VOLUME BREAKOUT', icon: '↗', title: '捕捉成交异动，寻找新线索。', description: '以过去 20 个交易日为基准，筛选当日成交额超过均值 3 倍的股票。' },
  { id: 'auction', label: '竞价榜', en: 'OPENING AUCTION', icon: '◷', title: '从开盘竞价，观察资金先手。', description: '聚焦开盘集合竞价成交额前 50 名，联动个股最新消息面。' },
]
const active = ref('billboard'), date = ref(shanghaiDate()), today = ref(shanghaiDate())
const tab = computed(() => tabs.find(item => item.id === active.value))
const result = shallowRef(null), loading = ref(false), error = ref(''), stopped = ref(false), progress = ref(null)
const query = ref(''), tier = ref('all'), selectedCode = ref(''), page = ref(1), detailPanel = ref(null)
const articles = shallowRef([]), newsLoading = ref(false), newsError = ref(''), newsFilter = ref('all')
const newsLimit = ref(12)
let controller, newsController, requestId = 0, newsId = 0
const scanning = computed(() => ['volume', 'auction'].includes(active.value))
const rows = computed(() => result.value?.rows ?? [])
const selected = computed(() => rows.value.find(item => item.code === selectedCode.value))
const filtered = computed(() => rows.value.filter(stock => {
  const matches = `${stock.code}${stock.name}${stock.reason ?? ''}`.toLowerCase().includes(query.value.trim().toLowerCase())
  return matches && (active.value !== 'limits' || tier.value === 'all' || (tier.value === '3' ? stock.boards >= 3 : stock.boards === Number(tier.value)))
}))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 25)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 25, page.value * 25))
const filteredNews = computed(() => articles.value.filter(item => newsFilter.value === 'all' || item.tone === newsFilter.value))
const visibleNews = computed(() => filteredNews.value.slice(0, newsLimit.value))
watch(newsFilter, () => { newsLimit.value = 12 })
const toneLabels = { positive: '利好线索', negative: '利空线索', neutral: '相关消息' }
const counts = computed(() => [1, 2, 3].map(n => rows.value.filter(s => n === 3 ? s.boards >= 3 : s.boards === n).length))
const metricLabel = computed(() => ({ billboard: '龙虎榜净买入', limits: '封单金额', volume: '成交额倍数', auction: '竞价成交额' })[active.value])
const ready = computed(() => !!result.value)
const totalAmount = computed(() => ready.value ? rows.value.reduce((sum, s) => sum + (s.amount ?? 0), 0) : null)
const status = computed(() => loading.value ? (ready.value ? '更新中' : '正在同步') : error.value ? (ready.value ? '刷新失败' : '连接异常') : stopped.value ? '已停止' : !ready.value ? '等待获取' : result.value.complete === false ? '数据不完整' : '已同步')
const metric = stock => active.value === 'volume' ? `${stock.ratio.toFixed(2)}×` : money(stock[({ billboard: 'net', limits: 'seal', auction: 'auction' })[active.value]])
const changeClass = value => number(value) === null ? '' : value > 0 ? 'rise' : value < 0 ? 'fall' : ''
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
const displayTime = value => value ? timeFormatter.format(new Date(value)) : '—'

async function load(force = false) {
  controller?.abort()
  const id = ++requestId
  controller = new AbortController()
  const signal = controller.signal, current = active.value, selectedDate = date.value
  today.value = shanghaiDate()
  const previousSelection = selectedCode.value
  error.value = ''; stopped.value = false; progress.value = null; page.value = 1
  const key = `${current}:${selectedDate}`, saved = market.getBoard(key)
  result.value = saved
  selectedCode.value = saved?.rows.some(row => row.code === previousSelection) ? previousSelection : saved?.rows[0]?.code ?? ''
  if (!force && saved && Date.now() - saved.savedAt < 60000) { loading.value = false; return }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || selectedDate > today.value) { error.value = '请选择有效日期，不能查询未来行情。'; loading.value = false; return }
  loading.value = true
  try {
    const data = current === 'billboard' ? await market.billboard(selectedDate, signal)
      : current === 'limits' ? await market.limits(selectedDate, signal)
        : await market.scan(current, selectedDate, signal, value => { if (id === requestId) progress.value = value })
    if (id !== requestId) return
    const updated = { ...data, savedAt: Date.now(), fetchedAt: new Date().toISOString() }
    result.value = updated; market.saveBoard(key, updated)
    selectedCode.value = updated.rows.some(row => row.code === selectedCode.value) ? selectedCode.value : updated.rows[0]?.code ?? ''
  } catch (e) {
    if (id !== requestId) return
    if (e.name === 'AbortError') stopped.value = true
    else error.value = e.message || '数据获取失败，请稍后重试。'
  } finally { if (id === requestId) loading.value = false }
}
async function loadNews() {
  newsController?.abort()
  const id = ++newsId
  articles.value = []; newsLimit.value = 12; newsError.value = ''; newsLoading.value = false
  if (!selected.value) return
  newsController = new AbortController(); newsLoading.value = true
  try {
    const data = await market.news(selected.value, date.value, newsController.signal)
    if (id === newsId) articles.value = data
  } catch (e) { if (id === newsId && e.name !== 'AbortError') newsError.value = e.message }
  finally { if (id === newsId) newsLoading.value = false }
}
function choose(stock) {
  selectedCode.value = stock.code; newsFilter.value = 'all'
  if (window.matchMedia('(max-width: 1000px)').matches) detailPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function navigateTab(event, index) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  active.value = tabs[next].id
  document.getElementById(`market-tab-${active.value}`)?.focus()
}
watch([active, date], () => { tier.value = 'all'; query.value = ''; load() })
watch([selectedCode, date], loadNews)
watch([query, tier], () => { page.value = 1 })
onMounted(() => load())
onBeforeUnmount(() => { ++requestId; ++newsId; controller?.abort(); newsController?.abort(); market.flush() })
</script>

<template>
  <section class="stock-page" :data-theme="theme">
    <header class="market-header">
      <button class="back-button" type="button" @click="$emit('back')" aria-label="返回 Study">← <span>Study</span></button>
      <a class="market-brand" href="#market-main" aria-label="Market 股票工作台"><span class="brand-symbol">S<span></span></span><strong>MARKET<span>股票工作台</span></strong></a>
      <div class="market-source"><i></i> 公开市场数据 <span>·</span> A 股</div>
      <label class="theme-picker"><span>主题</span><select v-model="theme" aria-label="股票页面主题"><option v-for="preset in MARKET_THEMES" :key="preset.id" :value="preset.id">{{ preset.label }}</option></select></label>
    </header>
    <nav class="market-nav" role="tablist" aria-label="股票榜单">
      <button v-for="(item, index) in tabs" :id="`market-tab-${item.id}`" :key="item.id" type="button" role="tab"
        :aria-selected="active === item.id" aria-controls="market-main" :tabindex="active === item.id ? 0 : -1"
        :class="{ active: active === item.id }" @click="active = item.id" @keydown="navigateTab($event, index)">
        <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span><span>{{ item.label }}<small>{{ item.en }}</small></span><span class="nav-number">0{{ index + 1 }}</span>
      </button>
    </nav>
    <main id="market-main" role="tabpanel" :aria-labelledby="`market-tab-${active}`" class="market-main">
      <div class="intro-row">
        <div><p class="eyebrow">MARKET INTELLIGENCE <span>/</span> {{ tab.en }}</p><h1>{{ tab.title }}</h1><p class="intro-copy">{{ tab.description }}</p></div>
        <div class="date-tools"><label>行情日期 <input v-model="date" type="date" :max="today" aria-label="行情日期"></label>
          <button type="button" class="refresh-button" :disabled="loading" @click="load(true)"><span aria-hidden="true">↻</span> 刷新数据</button>
        </div>
      </div>
      <div class="stats-row" aria-label="当前榜单概览">
        <div class="stat"><span>{{ active === 'auction' ? '竞价榜股票' : '入榜股票' }} <i>01</i></span><strong>{{ ready ? rows.length : '—' }}<small>只</small></strong><p>{{ result?.complete === false ? '仅统计已成功读取的股票' : '以当前数据源返回为准' }}</p></div>
        <div class="stat"><span>{{ active === 'limits' ? '最高连板' : active === 'volume' ? '最高成交额倍数' : active === 'billboard' ? '最高披露净买入' : '入榜股票成交额' }} <i>02</i></span>
          <strong v-if="active === 'limits'">{{ ready && rows.length ? Math.max(...rows.map(s => s.boards)) : '—' }}<small>板</small></strong>
          <strong v-else-if="active === 'volume'">{{ ready && rows.length ? rows[0].ratio.toFixed(2) : '—' }}<small>倍</small></strong>
          <strong v-else>{{ money(active === 'billboard' ? (rows[0]?.net ?? null) : totalAmount) }}<small>元</small></strong><p>{{ active === 'limits' ? '首板 · 二板 · 三板及以上' : active === 'volume' ? '基准不包含当日成交额' : active === 'billboard' ? '按对应上榜披露区间统计' : '当日累计成交额' }}</p>
        </div>
        <div class="stat"><span>{{ active === 'auction' ? '竞价统计时段' : active === 'volume' ? '爆量筛选标准' : '消息观察窗口' }} <i>03</i></span><strong class="stat-rule">{{ active === 'auction' ? '09:25' : active === 'volume' ? '> 3.00' : '近 7 日' }}<small>{{ active === 'auction' ? '开盘竞价' : active === 'volume' ? '倍' : '新闻 / 公告' }}</small></strong><p>{{ active === 'auction' ? '09:30 后确认完整分时数据' : active === 'volume' ? '对比前 20 个交易日均额' : '截止所选日期，逐条链接原文' }}</p></div>
        <div class="stat sync-stat"><span>数据状态 <i class="status-dot" :class="{ good: ready && result?.complete !== false }"></i></span><strong class="stat-rule">{{ status }}</strong><p>获取时间 {{ displayTime(result?.fetchedAt) }} <span>北京时间</span></p></div>
      </div>
      <div class="workspace-grid">
        <section class="ranking-panel" aria-label="股票排名">
          <div class="panel-heading"><div><h2>{{ tab.label }}<span class="small-badge">{{ active === 'auction' ? (result?.complete === false ? '部分结果' : 'TOP 50') : 'A-SHARES' }}</span></h2><p>{{ active === 'limits' ? '连板数优先，同梯队按封单金额排序' : `${metricLabel}由高到低` }} · 点击股票查看消息面</p></div><span class="panel-icon" aria-hidden="true">{{ tab.icon }}</span></div>
          <div class="list-toolbar"><div v-if="active === 'limits'" class="tier-filter" aria-label="连板筛选">
              <button v-for="(label, index) in ['全部', '首日涨停', '两日连板', '三日以上']" :key="label" type="button" :aria-pressed="tier === (index ? String(index) : 'all')" :class="{ selected: tier === (index ? String(index) : 'all') }" @click="tier = index ? String(index) : 'all'">{{ label }}<small v-if="ready">{{ index ? counts[index - 1] : rows.length }}</small></button>
            </div><span v-else class="list-label">{{ ready ? `${filtered.length} 只股票` : '等待真实行情' }}</span>
            <label class="stock-search"><span aria-hidden="true">⌕</span><input v-model="query" type="search" placeholder="搜索名称 / 代码" aria-label="搜索股票名称或代码"></label>
          </div>
          <div v-if="loading && !ready" class="state-box" role="status"><span class="loading-orbit" aria-hidden="true"></span><h3>{{ progress?.phase || '正在连接公开数据源' }}</h3><p>{{ scanning ? '逐股核对真实成交数据，首次扫描可能需要数分钟至二十分钟。' : '正在读取所选日期的榜单，请稍候。' }}</p><template v-if="progress"><progress :value="progress.done" :max="progress.total"></progress><span class="progress-caption">{{ progress.done }} / {{ progress.total }} 只<span v-if="progress.failed"> · {{ progress.failed }} 只缺失</span></span></template><button type="button" class="outline-button" @click="controller?.abort()">停止{{ scanning ? '扫描' : '获取' }}</button></div>
          <div v-else-if="error && !ready" class="state-box error-state" role="alert"><span class="state-symbol" aria-hidden="true">!</span><h3>暂时无法获取榜单</h3><p>{{ error }}</p><button type="button" class="outline-button" @click="load(true)">重新获取</button></div>
          <div v-else-if="stopped && !ready" class="state-box" role="status"><span class="state-symbol" aria-hidden="true">Ⅱ</span><h3>已停止获取</h3><p>已完成的计算输入会保留在缓存中，重新获取可复用。</p><button type="button" class="outline-button" @click="load(true)">重新获取</button></div>
          <template v-else-if="ready">
            <div v-if="loading || error || stopped" class="refresh-notice" :class="{ failed: error }" role="status">
              <span v-if="loading">正在更新，暂显示 {{ displayTime(result.fetchedAt) }} 获取的结果。<span v-if="progress"> {{ progress.done }} / {{ progress.total }} 只</span></span>
              <span v-else>{{ error ? `刷新失败：${error}` : '已停止更新。' }} 当前保留 {{ displayTime(result.fetchedAt) }} 的结果。</span>
              <button v-if="loading" type="button" @click="controller?.abort()">停止更新</button>
            </div>
            <div v-if="result.complete === false" class="partial-warning" role="status">{{ result.failed }} 只股票数据缺失，本次结果不构成完整全市场排名。<button type="button" @click="load(true)">重试补全 ↗</button></div>
            <div v-if="filtered.length" class="table-scroll">
              <table><thead><tr><th scope="col">排名 / 股票</th><th scope="col">涨跌幅</th><th scope="col">{{ metricLabel }}</th><th scope="col">{{ active === 'volume' ? '前 20 日均额' : '换手率' }}</th><th scope="col">{{ active === 'billboard' ? '上榜原因' : active === 'limits' ? '连板 / 涨停原因' : active === 'volume' ? '当日成交额' : '消息面' }}</th></tr></thead>
                <tbody><tr v-for="(stock, index) in visible" :key="stock.code" :class="{ 'selected-row': selectedCode === stock.code }">
                  <td><button type="button" class="stock-select" :aria-pressed="selectedCode === stock.code" :aria-label="`查看${stock.name}的消息面`" @click="choose(stock)"><span class="rank" :class="{ 'rank-top': (page - 1) * 25 + index < 3 }">{{ String((page - 1) * 25 + index + 1).padStart(2, '0') }}</span><span><strong>{{ stock.name }}</strong><small>{{ stock.code }} <i v-if="active === 'limits'">{{ stock.industry }}</i></small></span></button></td>
                  <td :class="changeClass(stock.change)" class="numeric">{{ percent(stock.change, true) }}</td><td class="numeric metric-number" :class="active === 'billboard' ? changeClass(stock.net) : ''">{{ metric(stock) }}</td><td class="numeric muted">{{ active === 'volume' ? money(stock.average) : percent(stock.turnover) }}</td>
                  <td><span v-if="active === 'limits'" class="board-tag">{{ stock.boards }} 板</span><span v-if="active === 'billboard' || active === 'limits'" class="reason-preview" :title="stock.reason">{{ stock.reason || '原因待披露' }}</span><span v-else-if="active === 'volume'" class="numeric muted">{{ money(stock.amount) }}</span><button v-else type="button" class="news-link" @click="choose(stock)">查看消息 <span>↗</span></button></td>
                </tr></tbody></table>
            </div>
            <div v-else class="state-box"><span class="state-symbol" aria-hidden="true">⌕</span><h3>{{ query || tier !== 'all' ? '没有符合筛选的股票' : '该日期暂无入榜股票' }}</h3><p>{{ query || tier !== 'all' ? '试试其他名称、代码或连板分组。' : result.note }}</p><button v-if="query || tier !== 'all'" type="button" class="outline-button" @click="query = ''; tier = 'all'">清除筛选</button></div>
            <div v-if="filtered.length" class="table-footer"><span>{{ (page - 1) * 25 + 1 }}–{{ Math.min(page * 25, filtered.length) }} / {{ filtered.length }} 只</span><div><button type="button" :disabled="page <= 1" aria-label="上一页股票" @click="page--">←</button><span>{{ page }} / {{ pages }}</span><button type="button" :disabled="page >= pages" aria-label="下一页股票" @click="page++">→</button></div></div>
          </template>
        </section>
        <aside ref="detailPanel" class="insight-panel" aria-label="个股消息面">
          <div class="insight-heading"><span class="eyebrow">STOCK INSIGHT</span><span class="small-badge">消息面</span></div>
          <template v-if="selected">
            <div class="selected-stock"><div><h2>{{ selected.name }}</h2><span>{{ selected.code }} <span class="market-tag">{{ selected.code.startsWith('6') ? '沪市' : /^[489]/.test(selected.code) ? '北交所' : '深市' }}</span></span></div><div class="stock-price"><strong>{{ selected.price?.toFixed(2) ?? '—' }}</strong><span :class="changeClass(selected.change)">{{ percent(selected.change, true) }}</span></div></div>
            <div class="detail-metrics"><div><span>{{ metricLabel }}</span><strong :class="active === 'billboard' ? changeClass(selected.net) : ''">{{ metric(selected) }}</strong></div><div><span>换手率</span><strong>{{ percent(selected.turnover) }}</strong></div></div>
            <div v-if="active === 'billboard' || active === 'limits'" class="reason-card"><div><span class="reason-dot"></span><h3>{{ active === 'billboard' ? '上榜原因' : '涨停原因' }}</h3></div><p>{{ selected.reason || '数据源暂未披露涨停原因，可结合下方新闻查看。' }}</p><small>{{ active === 'billboard' ? '东方财富 · 龙虎榜披露' : '选股宝 · 涨停原因解读' }}<span v-if="active === 'limits'"> · {{ selected.firstSeal }} 首封</span></small></div>
            <div v-else-if="active === 'volume'" class="reason-card"><div><span class="reason-dot"></span><h3>爆量计算</h3></div><p>{{ money(selected.amount) }} ÷ {{ money(selected.average) }} = <b>{{ selected.ratio.toFixed(2) }} 倍</b></p><small>基准：{{ selected.baselineStart }} 至 {{ selected.baselineEnd }}<br>下方新闻为可能相关的爆量线索，不代表已确认原因。</small></div>
            <div v-else class="reason-card"><div><span class="reason-dot"></span><h3>开盘竞价</h3></div><p>竞价成交额 <b>{{ money(selected.auction) }}元</b></p><small>{{ date }} · 09:25–09:30 前成交<br>新闻用于了解消息背景，不代表已确认的竞价原因。</small></div>
            <div class="news-heading"><h3>{{ active === 'volume' ? '可能的爆量消息' : '近期消息' }}</h3><span>近 7 日</span></div>
            <div class="news-filters" aria-label="消息类型筛选"><button v-for="item in [{ id: 'all', label: '全部' }, { id: 'positive', label: '利好线索' }, { id: 'negative', label: '利空线索' }]" :key="item.id" type="button" :class="{ selected: newsFilter === item.id }" :aria-pressed="newsFilter === item.id" @click="newsFilter = item.id">{{ item.label }}</button></div>
            <p class="news-disclaimer">利好 / 利空按标题关键词初筛，需结合原文确认；混合或不明确消息保留为相关消息。</p>
            <div v-if="newsLoading" class="news-empty" role="status">正在读取个股消息…</div><div v-else-if="newsError" class="news-empty" role="status">{{ newsError }}<button type="button" class="news-link" @click="loadNews">重试 ↗</button></div>
            <div v-else-if="!visibleNews.length" class="news-empty">{{ newsFilter === 'all' ? '近 7 日暂未检索到相关消息。' : '近 7 日暂未检索到此类线索，不代表不存在相关信息。' }}</div>
            <div v-else class="news-feed"><article v-for="article in visibleNews" :key="article.url"><div><span class="news-tone" :class="article.tone">{{ toneLabels[article.tone] }}</span><time>{{ article.date.slice(5, 16) }}</time></div><a :href="article.url" target="_blank" rel="noopener noreferrer">{{ article.title }} <span aria-hidden="true">↗</span></a><p>{{ article.content }}</p><small>{{ article.source || '东方财富新闻' }} · 查看原文</small></article></div>
            <button v-if="visibleNews.length < filteredNews.length" type="button" class="load-more-news" @click="newsLimit += 12">加载更多消息（剩余 {{ filteredNews.length - visibleNews.length }} 条）</button>
            <a class="more-news" :href="`https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(selected.name)}`" target="_blank" rel="noopener noreferrer">在东方财富查看全部消息 <span>↗</span></a>
          </template>
          <div v-else class="insight-empty"><span aria-hidden="true">◎</span><h3>每一笔异动，都有迹可循。</h3><p>选择榜单中的股票，查看上榜原因、关键数据与近期消息。</p><div><span>01 <b>关注异动</b></span><span>02 <b>核对消息</b></span><span>03 <b>回看来源</b></span></div></div>
        </aside>
      </div>
      <div class="method-note"><span aria-hidden="true">ⓘ</span><p>{{ result?.note || (scanning ? '仅支持当日。完整榜单需核对全市场有成交的 A 股；获取失败会标记缺失，请留意扫描完整度。' : '龙虎榜通常在收盘后披露；休市日与尚未披露的日期可能没有榜单。') }}</p></div>
      <footer class="market-footer"><span>STUDY <b>/</b> MARKET</span><p>数据来源：<a href="https://data.eastmoney.com/stock/tradedetail.html" target="_blank" rel="noopener noreferrer">东方财富</a><span>·</span><a href="https://xuangubao.cn" target="_blank" rel="noopener noreferrer">选股宝</a></p><small>公开行情可能延迟 · 以交易所及公司披露为准</small></footer>
    </main>
  </section>
</template>

<style scoped src="./stock-page.css"></style>
