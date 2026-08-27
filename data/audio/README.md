# 单词音频缓存

本目录保存 StudyEnglish 的单词发音文件及断点续传记录。当前下载范围为 7 个词汇库和新概念英语 1–4 册，排除带空格的词组/短语，忽略大小写去重后共 12,751 个单词。

## 目录结构

- `type-1/`：英式音频（有道 `type=1`）及对应目录、日志和进度。
- `type-2/`：美式音频（有道 `type=2`）及对应目录、日志和进度。
- `type-<类型>/catalog.json`：完整单词、哈希文件路径和数据来源清单。
- `type-<类型>/lookup/*.json`：由完整目录生成的 64 个浏览器查询分片，首次发音只请求其中一个。
- `type-<类型>/download-records.jsonl`：追加式下载日志，每行一条 JSON；保留每个单词最近一次成功或失败结果。
- `type-<类型>/progress.json`：当前成功、失败、待下载数量和容量摘要。
- `type-<类型>/files/<哈希前两位>/<SHA-256>.mp3|.wav`：实际音频文件。下载器根据真实文件头选择扩展名；使用哈希路径可规避 Windows 文件名限制，具体单词与文件的对应关系见 `catalog.json`。

## 下载和续传

```bash
pnpm run download:audio
```

下载或续传美式音频：

```bash
pnpm run download:audio -- --type=2
```

重复执行同一命令会校验成功记录和文件大小，跳过已经完成的音频，只重新下载失败或缺失项目。仅重试日志中明确失败的项目：

```bash
pnpm run download:audio -- --only-failed
```

常用参数：

- `--concurrency=4`：并发数，默认 4。
- `--request-interval=120`：任意两次请求之间的最小毫秒数，默认 120。
- `--max-attempts=3`：本次运行中每个文件的最大尝试次数，默认 3。
- `--limit=100`：本次最多处理多少条，省略表示处理全部。
- `--type=1|2`：音频类型，`1` 为英式，`2` 为美式。
- `--force`：忽略已有成功记录并重新下载，不建议日常使用。

下载采用临时文件加原子重命名；即使进程中断，也不会把未完成内容当成有效音频。

如果美式公共音频源经过重试后仍有少量失败，并且 Windows 已安装 `Microsoft Zira Desktop`，可生成本地 `en-US` WAV 补齐失败项：

```powershell
& .\scripts\generate-failed-audio.ps1
pnpm run download:audio -- --type=2 --only-failed
```

第二条命令不会重复下载，作用是校验生成文件并刷新 `catalog.json` 和 `progress.json`。

如果旧下载曾把 WAV 响应保存为 `.mp3`，可执行 `pnpm run normalize:audio` 按文件头修正扩展名并同步追加日志与更新目录映射。

下载或规范化音频后，运行 `pnpm run generate:audio-lookup` 刷新浏览器查询分片；本地开发和生产构建也会自动执行该任务。分片属于生成文件，不提交到 Git。

英式下载优先使用有道 `type=1`；美式下载优先使用有道 `type=2`，主来源缺失时只使用美式公共词典静态音频或 `en-US` 公共 TTS，避免混入英式回退音频。日志中的 `provider`、`voice` 与 `fallback` 字段会明确记录实际来源，便于后续筛选或替换备用音频。
