# 例句生成数据

本目录保存 Study 的去重例句任务、生成结果和断点记录。任务覆盖词汇、词组及新概念英语词条，并按“忽略大小写的词条 + 规范化释义”去重。

## 文件说明

- `catalog.json`：从 `data/excel` 整理出的 18,339 条去重任务。
- `examples.jsonl`：生成成功的英文例句与中文翻译，逐行追加写入。
- `generation-records.jsonl`：每次成功或失败的处理记录，用于断点续跑。
- `generation-error.log`：方便人工检查的失败摘要。
- `progress.json`：总数、成功数、失败数、剩余数、模型和更新时间。
- `runner-state.json`：后台生成进程的 PID、启动时间和日志路径；本地文件，不提交到 Git。
- `runner-output.log` / `runner-error.log`：后台生成的标准输出与错误日志；本地文件，不提交到 Git。
- `sources/`：Tatoeba CC0、WordNet 原始文件和本地索引；不会提交到 Git。

## 本地 Ollama 配置

默认调用本机 Ollama 的 `qwen3:8b`，不需要 API Key。复制 `.env.example` 为 `.env.local`，按需调整：

```dotenv
EXAMPLE_AI_PROVIDER=ollama
EXAMPLE_AI_MODEL=qwen3:8b
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_NUM_CTX=4096
OLLAMA_KEEP_ALIVE=15m
EXAMPLE_AI_REVIEW=true
OLLAMA_THINK_FOR_UNDEFINED=false
```

先确认 Ollama 正在运行且模型已经安装：

```powershell
ollama list
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

## 使用方法

只整理任务，不调用模型：

```powershell
pnpm run prepare:examples
```

首次运行时下载开放语料并建立索引：

```powershell
pnpm run prepare:example-sources
```

处理优先级如下：

1. Tatoeba CC0 提供英文例句，Ollama 只翻译中文。
2. WordNet 提供英文例句，Ollama 只翻译中文。
3. 前两者没有合适例句时，Ollama 同时生成英文例句和中文翻译。

语料索引只使用词条拼写和词边界明确、释义不冲突的匹配。原始语料不会进入网页构建产物。

先生成 5 条进行质量检查：

```powershell
pnpm run generate:examples -- --limit=5 --batch-size=5
```

确认后在当前终端处理全部剩余任务：

```powershell
pnpm run generate:examples
```

需要关闭终端后继续运行时，使用隐藏后台进程：

```powershell
pnpm run start:example-generation
Get-Content data/examples/progress.json
Get-Content data/examples/runner-output.log -Tail 20
```

后台命令会先检查 `runner-state.json` 中的 PID，避免重复启动。进程意外中断后再次执行同一命令即可从现有成功记录继续。

后台启动默认使用 2 路内部并发。所有结果写入、去重集合和 `progress.json` 更新都经过同一进程的串行提交队列，避免并行请求破坏 JSONL 或重复占用例句。显存不足或 Ollama 不稳定时可改为前台单路运行：

```powershell
pnpm run generate:examples -- --batch-size=10 --concurrency=1
```

只重试失败记录：

```powershell
pnpm run generate:examples -- --only-failed
```

可用参数：

- `--provider=ollama|openai`：选择生成服务。
- `--model=qwen3:8b`：覆盖本次运行的模型。
- `--term=abashed`：只处理指定词条，适合测试或人工修正疑难词。
- `--limit=500`：限制本次最多处理条数；省略表示处理全部剩余任务。
- `--batch-size=5`：每次请求的词条数量；Ollama 默认 5。
- `--concurrency=2`：单进程内并发请求数；后台启动默认 2。不要同时启动多个生成进程。
- `--max-attempts=3`：请求或内容校验失败时的最大尝试次数。
- `--timeout=180000`：单次请求超时毫秒数。
- `--only-failed`：只重试失败任务。
- `--force`：忽略成功记录并重新生成，不建议日常使用。
- `--no-review`：跳过第二遍中英文质量审校；速度更快但不建议全量任务使用。

生成器默认关闭 Qwen3 思考输出，避免推理过程显著拖慢全量任务或耗尽输出长度。疑难词可临时设置 `OLLAMA_THINK_FOR_UNDEFINED=true` 后单条重跑。所有响应通过 JSON Schema 约束格式；随后默认再执行一次独立审校，修正英文语法、中文量词和机械翻译。最后检查句长、中英文完整性、目标词使用情况和重复句子。每批结束后都会更新进度，因此中断后可继续运行。

## 写回网页数据

将成功结果合并到 `data/excel` 的词库 JSON：

```powershell
pnpm run apply:examples
```

未生成成功的词条保持原样，网页会隐藏缺失的例句区域。
