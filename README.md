# Study

Study 是一个基于 Vue 3 和 Vite 构建的纯前端英语词汇学习网站，提供分类词库浏览、全局搜索、英美发音、逐字母练习、错题复习和学习进度记录。项目不依赖后端服务，可直接部署到 GitHub Pages。

## 访问地址

- 在线访问：<https://yondfane.github.io/Study>
- GitHub 仓库：<https://github.com/YondFane/Study>

## 项目数据

- 8 个导航分类：中考、高考、四级、六级、专八、雅思、托福、新概念英语。
- 16 个词库数据集，包含词汇、词组和新概念英语第一至第四册。
- 共 37,824 条原始记录。
- 共 12,751 个忽略大小写去重后的单词音频，词组和短语不计入音频数量。
- 当前音频总容量约 379.77 MB，包含 MP3 和 WAV 文件。

完整的数据文件、记录数和字段说明见 [`data/excel/README.md`](data/excel/README.md)，音频目录及续传说明见 [`data/audio/README.md`](data/audio/README.md)。

## 主要功能

### 词库浏览

- 顶部导航按照考试或课程分类展示词库。
- 分类下通过下拉列表切换词汇、词组或新概念英语册次。
- 每次只按需加载一个数据集，避免首次打开时下载全部词库。
- 左侧列表采用虚拟滚动，仅渲染可视区域和缓冲行，支持直接恢复到词库中的任意位置。
- 自动保存每个词库最后浏览的位置，再次打开时恢复。
- 详情区域展示词条、英美音标、中文释义和数据来源等信息。
- 桌面端和移动端分别提供适配的列表、卡片与切词手势。

### 搜索

- 在当前词库中按词条、音标、释义或来源实时筛选。
- 支持跨全部数据集的全局搜索。
- 全局搜索首先加载只包含词条名称的轻量索引；打开某条结果时才加载其完整词库。
- 修改关键词、切换词库或离开浏览页后，尚未完成的旧搜索和详情请求不会覆盖当前页面。

### 发音

单词播放采用三级回退策略：

1. “接口发音”开启时优先请求有道公共音频接口；600 ms 内未开始播放或请求失败时自动回退。
2. 英式通过 `data/audio/type-1/lookup`、美式通过 `data/audio/type-2/lookup` 的分片索引查找项目内的 MP3/WAV 文件并播放。
3. 项目音频不存在或无法播放时，使用设备的 Web Speech API。

页面支持英式 `en-GB` 和美式 `en-US`。开启“接口发音”时使用“在线接口 → 项目音频 → 设备语音”的回退顺序；在线接口连续失败 2 次后会熔断 5 分钟，其间直接使用项目音频。关闭开关只会停用在线接口，仍按“项目音频 → 设备语音”的顺序发音。

### 单词练习

- 逐字母输入答案，错误字母会即时标记并提示。
- 答对后的短暂提示期间禁止重复提交；手动切词、切换模式或离开页面会取消旧题的自动跳转。
- 支持顺序练习、随机练习和指定序号跳转。
- 可隐藏词条、自动朗读、记录进度、关闭粒子背景。
- 按词库保存错题，并提供错题专项练习和清空功能。
- 底部通过“分类 + 内容”两级下拉列表切换练习词库。
- 提供上一个、下一个词库快捷按钮，当前词库名称和条目数始终可见。

练习页面快捷键：

| 快捷键 | 功能 |
| --- | --- |
| `Enter` | 提交当前答案 |
| `Esc` | 重新播放当前词条 |
| `2` | 隐藏或显示当前词条 |

## 使用手册

### 浏览和搜索词条

1. 打开在线地址或本地开发页面。
2. 在顶部选择中考、高考、四级等分类。
3. 使用分类旁的下拉列表选择词汇、词组或新概念英语册次。
4. 在左侧词表中滚动浏览，列表会自动继续加载。
5. 点击词条查看详情；使用“英式”“美式”按钮播放发音。
6. 在搜索框输入内容可筛选当前词库；点击“全局搜索”或按 `Enter` 搜索全部词库。

### 开始练习

1. 点击页面右上角的“开始练习”。
2. 使用顶部开关设置发音、自动朗读、进度记录、粒子背景、随机练习和错题统计。
3. 点击字母输入区域后逐字母输入答案，按 `Enter` 提交。
4. 使用页面中部按钮播放词条、隐藏词条、进入下一词或开始错题练习。
5. 使用底部两个下拉列表切换分类和具体词库，也可以点击左右箭头顺序切换。
6. 点击左上角“返回词库”回到浏览页面。

### 本地记录与缓存

- 学习进度、浏览位置、错题和页面设置保存在当前浏览器的 `localStorage` 中。
- 状态存储键为 `study-english:practice-state:v2`。
- 已访问的构建资源由浏览器缓存和 Service Worker 复用。
- 音频目录映射拆成 64 个小分片并使用浏览器 HTTP 缓存，首次发音只加载当前单词对应的分片。
- 隐私模式、清除站点数据或更换设备会丢失本地学习记录。
- 读取时逐字段校验本地记录，保留有效的进度、错题和设置；存储被禁用或缓存写入失败时，仍可正常学习和加载网络资源。
- GitHub Pages 是静态托管，浏览器产生的个人进度不会写回 GitHub 仓库。

## 实现逻辑

### 数据加载

`data/excel/index.js` 导出分类、数据集清单和异步加载函数：

```js
import {
  categories,
  datasets,
  loadDataset,
  loadSearchIndex,
} from './data/excel/index.js'

const words = await loadDataset('cet4-vocabulary')
const searchIndex = await loadSearchIndex()
```

- `loadDataset(id)` 使用动态 `import()` 加载指定 JSON，并在当前页面会话中复用结果。
- `loadSearchIndex()` 加载轻量词条索引，不包含完整释义和音标。
- 词表使用固定 64px 行高的虚拟列表，只渲染可视行和上下各 6 行缓冲；桌面和手机抽屉共用组件。
- 词汇、词组和课程数据统一使用 `term`、`britishPronunciation`、`americanPronunciation`、`definition` 字段。

### 音频映射与发布

音频文件使用 SHA-256 哈希路径保存，`catalog.json` 是完整目录的维护数据源。构建前会从中生成 64 个 `lookup/*.json` 小分片；网页首次播放时只加载当前单词对应的约 20 KB 分片，不再下载约 2 MB 的完整目录。

生产构建结束后，`vite.config.js` 会把以下内容复制到 `dist`：

```text
data/audio/type-1/catalog.json  -> dist/data/audio/type-1/catalog.json
data/audio/type-1/lookup/       -> dist/data/audio/type-1/lookup/
data/audio/type-1/files/        -> dist/data/audio/type-1/files/
data/audio/type-2/catalog.json  -> dist/data/audio/type-2/catalog.json
data/audio/type-2/lookup/       -> dist/data/audio/type-2/lookup/
data/audio/type-2/files/        -> dist/data/audio/type-2/files/
```

开发服务器通过相同的 `/Study/data/audio/` 地址读取源音频，因此开发环境和 GitHub Pages 使用一致的播放路径。

### 状态管理

页面使用 Vue 3 Composition API 管理词库、搜索、练习和播放状态。状态变化后将必要字段写入 `localStorage`，不保存完整词库和音频内容。切换词库时会恢复该词库独立的练习进度、浏览位置和错题列表。

### GitHub Pages 路径

Vite 的基础路径固定为：

```js
base: '/Study/'
```

脚本、样式、动态词库、音频目录和 Service Worker 都通过该基础路径访问。修改仓库名或部署路径时，需要同步修改 `vite.config.js`。

## 技术栈

- Vue 3 Composition API
- Vite 6
- pnpm 10
- 原生 Web Speech API
- Service Worker、Cache API 和 `localStorage`
- Canvas 粒子动画
- GitHub Actions 与 GitHub Pages

## 项目目录

```text
Study/
├─ .github/workflows/deploy.yml       # GitHub Pages 自动部署
├─ data/
│  ├─ excel/                          # JSON 词库、清单和轻量搜索索引
│  ├─ examples/                       # AI 例句任务、结果和生成进度
│  └─ audio/type-1/                   # 音频目录、文件和续传记录
├─ public/
│  └─ sw.js                           # 运行时缓存 Service Worker
├─ scripts/
│  ├─ download-audio.mjs              # 音频下载与断点续传
│  ├─ generate-examples.mjs           # AI 例句生成与断点续传
│  ├─ start-example-generation.mjs     # 隐藏后台启动例句生成
│  ├─ apply-examples.mjs              # 把成功例句写入各词库
│  ├─ generate-search-index.mjs       # 生成轻量搜索索引
│  └─ normalize-audio-extensions.mjs  # 修正音频真实扩展名
├─ src/
│  ├─ components/ParticleBackground.vue
│  ├─ App.vue                         # 浏览、搜索、发音和练习核心逻辑
│  ├─ main.js                         # Vue 与 Service Worker 入口
│  └─ style.css                       # 全局和响应式样式
├─ index.html
├─ package.json
└─ vite.config.js
```

## 本地开发

建议使用 Node.js 20 和 pnpm 10。

```bash
pnpm install
pnpm dev
```

默认开发地址：

```text
http://localhost:5173/Study/
```

生产构建与本地预览：

```bash
pnpm build
pnpm preview
```

运行回归测试：

```bash
pnpm test
```

测试覆盖重复提交、错题移除、异步搜索和分类切换、虚拟列表位置恢复、本地存储异常，以及 Service Worker 缓存失败和离线回退。

生产构建会重新生成搜索索引，并复制约 380 MB 的音频文件，因此构建时间和 `dist` 目录体积会明显增加。

## 数据维护

修改词库 JSON 后重新生成搜索索引：

```bash
pnpm run generate:search-index
```

音频目录变化后重新生成浏览器分片索引：

```bash
pnpm run generate:audio-lookup
```

`pnpm dev` 会自动刷新音频分片，`pnpm build` 会自动执行搜索和音频两个索引生成任务；生成的分片不提交到 Git。

建立去重例句任务目录（不调用模型）：

```bash
pnpm run prepare:examples
```

首次使用时下载 Tatoeba CC0 与 WordNet，并建立本地语料索引：

```powershell
pnpm run prepare:example-sources
```

原始语料和索引保存在 `data/examples/sources`，已从 Git 中排除，不会部署到 GitHub Pages。例句按“Tatoeba CC0 英文例句 → WordNet 英文例句 → Ollama 从零生成”的顺序选择；语料库英文例句的中文翻译由 Ollama 本地生成。

开放语料的来源、授权和 WordNet 完整免责声明见 `data/examples/THIRD_PARTY_NOTICES.md`。发布包含 WordNet 例句的数据时必须保留该文件。

本地启动 Ollama 并安装 `qwen3:8b` 后，先生成 5 条检查质量：

```powershell
pnpm run generate:examples -- --limit=5 --batch-size=5
```

默认配置使用 `http://127.0.0.1:11434` 的 Ollama，不需要 API Key。模型、上下文和服务地址可以复制 `.env.example` 为 `.env.local` 后调整；进度会逐批写入 `data/examples`，中断后再次运行即可继续。

全量任务建议用隐藏后台进程执行，关闭当前终端后仍可继续：

```powershell
pnpm run start:example-generation
Get-Content data/examples/progress.json
Get-Content data/examples/runner-output.log -Tail 20
```

后台进程信息保存在 `data/examples/runner-state.json`，重复执行启动命令不会创建第二个生成进程。

后台生成默认采用 2 路进程内并发，并通过串行落盘队列保护例句文件、失败记录和断点。不要手动启动多个生成脚本；需要调整时使用 `--concurrency=1|2`。

把已经成功生成的例句合并到词库：

```bash
pnpm run apply:examples
```

下载缺失音频或继续上次中断的任务：

```bash
pnpm run download:audio
```

只重试失败记录：

```bash
pnpm run download:audio -- --only-failed
```

检查并修正音频真实格式与扩展名：

```bash
pnpm run normalize:audio
```

英式和美式音频的下载进度分别保存在 `data/audio/type-1/progress.json`、`data/audio/type-2/progress.json`，逐条结果记录在各自目录的 `download-records.jsonl`，中断后可继续执行。

## 部署

仓库已配置 `.github/workflows/deploy.yml`：

1. 将代码推送到 `main` 分支。
2. GitHub Actions 使用 Node.js 20 和 pnpm 10 安装依赖。
3. 执行 `pnpm build` 生成搜索索引、页面资源和音频目录。
4. 上传 `dist` 并部署到 GitHub Pages。

也可以在 GitHub Actions 页面手动运行 `Deploy to GitHub Pages` 工作流。

部署完成后访问：<https://yondfane.github.io/Study>

## 注意事项

- 不要删除 `vite.config.js` 中的 `/Study/` 基础路径，否则 GitHub Pages 资源会出现 404。
- 不要一次性静态导入全部词库，这会显著增加首屏体积。
- `data/audio/type-1`、`data/audio/type-2` 的 `catalog.json`、`lookup` 和实际音频目录必须同时发布。
- 在线发音接口受网络和第三方服务状态影响，失败时会自动回退到设备语音。
- 设备语音的效果取决于浏览器和操作系统安装的英语语音包。

## 股票工作台

保留现有股票页入口与访问验证。进入后，顶部导航切换龙虎榜、天梯榜、爆量榜、竞价榜；支持搜索、分页、日期选择、手动刷新与个股消息面。桌面使用榜单 / 消息两栏，手机使用纵向布局，宽表格可横向滚动。

右上角提供晴日绿（默认明亮）、晴空蓝（明亮）、深夜墨三套主题。选择保存到浏览器 `study-market:theme:v1`；切换主题不会重新请求行情。股票页代码与样式按需加载，进入股票工作台时才下载。

### 数据来源与统计口径

页面没有演示股票或模拟行情，不需要用户配置 API Key，也不依赖后端。通过东方财富公开网页 JSONP 接口与选股宝 CORS 接口直接读取数据，可随原项目部署到 GitHub Pages。接口中的 `ut` 是公开网页客户端的固定参数，不是用户账号密钥。

| 模块 | 公开接口 | 口径 |
| --- | --- | --- |
| 龙虎榜 | `datacenter-web.eastmoney.com/api/data/v1/get`，`RPT_DAILYBILLBOARD_DETAILS` | 按所选日期取全部分页；同股合并上榜原因。金额取首条披露，不叠加日内和多日重叠区间；净买入金额按相应披露区间显示。通常收盘后发布。 |
| 天梯榜 | `push2ex.eastmoney.com/getTopicZTPool` | 按首板、两连板、三连板及以上筛选；展示封板资金、换手率。遵循供应商涨停池范围，不含 ST、科创板和未开板新股。 |
| 涨停原因 | `flash-api.xuangubao.cn/api/pool/detail?pool_name=limit_up` | 仅匹配股票代码和同一交易日；原因是供应商解读，缺失时标记待披露。 |
| 爆量榜 | `push2.eastmoney.com/api/qt/clist/get` + `push2his.eastmoney.com/api/qt/stock/kline/get` | 读取全市场有成交的 A 股，逐股计算当日成交额 / 此前 20 根交易日 K 线成交额均值，严格大于 3 才入榜。排除当日；历史不足、字段缺失或零基准单独计数。不能用行情“量比”替代。 |
| 竞价榜 | 全市场行情 + `push2.eastmoney.com/api/qt/stock/trends2/get` | 09:30 后逐股核对开盘竞价，汇总 09:25（含）至 09:30（不含）的分时成交额。接口可能将竞价成交记入 09:26。禁止用开盘价 × 全天成交量或全天成交额排名替代。完成后按竞价额降序取 50 只。 |
| 个股消息 | `search-api-web.eastmoney.com/search/jsonp` | 按时间检索最近 100 条结果，再筛选截止所选日期的近 7 日股票相关消息，显示来源、发布时间及原文链接。 |

利好 / 利空是标题关键词初筛的“线索”，不是确定结论。含否定、利好利空混合、未明确提及该股票的标题保留为相关消息。不会凭空生成涨停或爆量原因；爆量消息仅表示可能相关，需阅读原文确认。

### 时间、缓存与缺失数据

- 日期按 `Asia/Shanghai` 计算。龙虎榜支持历史日期，天梯榜历史范围取决于公开接口；涨停原因源仅能可靠补充当前返回日期。爆量、竞价只支持当日，不将上一交易日冒充今天。
- 爆量和竞价需逐股请求全市场，首次可能耗时较长。进度显示已核对 / 总数，可停止；切换榜单、日期和离开页面会取消旧请求，迟到响应不会覆盖新结果。
- 榜单与市场行情短期缓存 60 秒，新闻缓存 5 分钟。同一页面会话保留最多 8 份榜单，离开工作台后再次进入也可复用；60 秒至 15 分钟的榜单先展示已有结果，再后台更新。刷新失败或停止时保留原结果及其获取时间。
- 当天历史均额与已确认竞价额缓存到浏览器 `study-market:inputs:v1`，首次需要时才读取；不缓存失败响应，缓存被禁用或配额不足不影响读取。每日缓存以日期隔离。命中缓存的股票跳过网络请求间隔，仅实际请求保留限速；扫描进度最多每 150 毫秒更新，缓存分批写入，避免频繁阻塞页面。
- 表格每页展示 25 只股票；个股消息首批渲染 12 条，点击加载更多后分批展示，其余结果仍参与消息类型筛选。
- 历史接口返回的均额仅缓存平均值与起止日，避免保存全市场完整 K 线导致浏览器存储超额。
- 行情按代码稳定分页，读取全部股票后才计算；完整性校验失败会报错。个股请求缺失时必须显示“不完整”，竞价榜仅可称为已读取股票中的前 50 名。
- 公共接口可能限流、超时、断开或调整字段。连续失败会停止扫描并提示重试；不会填补假数据，也不承诺公开网页接口具有交易行情服务的可用性。
- `获取时间` 是该次读取完成时间；行情本身可能延迟，扫描期间的价格 / 当日成交额来自起始全市场分页读取，并非同一毫秒快照。

主要实现：`src/components/StockPage.vue`、`src/components/stock-page.css`、`src/services/stockMarket.js`、`src/services/stockPreferences.js`。运行 `pnpm test` 验证计算边界、日期过滤、完整性标记、分组搜索、异步取消、缓存扫描与主题偏好；运行 `pnpm build` 生成静态页面。测试中的构造数据仅用于断言，不参与产品展示。
