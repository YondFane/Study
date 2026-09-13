# StudyEnglish

StudyEnglish 是一个基于 Vue 3 和 Vite 构建的纯前端英语词汇学习网站，提供分类词库浏览、全局搜索、英美发音、逐字母练习、错题复习和学习进度记录。项目不依赖后端服务，可直接部署到 GitHub Pages。

## 访问地址

- 在线访问：<https://yondfane.github.io/StudyEnglish>
- GitHub 仓库：<https://github.com/YondFane/StudyEnglish>

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

开发服务器通过相同的 `/StudyEnglish/data/audio/` 地址读取源音频，因此开发环境和 GitHub Pages 使用一致的播放路径。

### 状态管理

页面使用 Vue 3 Composition API 管理词库、搜索、练习和播放状态。状态变化后将必要字段写入 `localStorage`，不保存完整词库和音频内容。切换词库时会恢复该词库独立的练习进度、浏览位置和错题列表。

### GitHub Pages 路径

Vite 的基础路径固定为：

```js
base: '/StudyEnglish/'
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
StudyEnglish/
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
http://localhost:5173/StudyEnglish/
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

部署完成后访问：<https://yondfane.github.io/StudyEnglish>

## 注意事项

- 不要删除 `vite.config.js` 中的 `/StudyEnglish/` 基础路径，否则 GitHub Pages 资源会出现 404。
- 不要一次性静态导入全部词库，这会显著增加首屏体积。
- `data/audio/type-1`、`data/audio/type-2` 的 `catalog.json`、`lookup` 和实际音频目录必须同时发布。
- 在线发音接口受网络和第三方服务状态影响，失败时会自动回退到设备语音。
- 设备语音的效果取决于浏览器和操作系统安装的英语语音包。
