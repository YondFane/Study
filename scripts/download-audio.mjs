import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataRoot = resolve(projectRoot, 'data/excel')
const audioRoot = resolve(projectRoot, 'data/audio')
const audioType = Number(readArgument('type', '1'))
const concurrency = Math.max(1, Number(readArgument('concurrency', '4')))
const maxAttemptsPerRun = Math.max(1, Number(readArgument('max-attempts', '3')))
const requestIntervalMs = Math.max(0, Number(readArgument('request-interval', '120')))
const limit = Math.max(0, Number(readArgument('limit', '0')))
const onlyFailed = process.argv.includes('--only-failed')
const force = process.argv.includes('--force')
const requestTimeoutMs = 15_000
const minimumAudioBytes = 1_000
const maximumAudioBytes = 2_000_000

if (![1, 2].includes(audioType)) throw new Error('--type must be 1 or 2')

const typeRoot = resolve(audioRoot, `type-${audioType}`)
const journalPath = resolve(typeRoot, 'download-records.jsonl')
const progressPath = resolve(typeRoot, 'progress.json')
const catalogPath = resolve(typeRoot, 'catalog.json')
const manifest = JSON.parse(await readFile(resolve(dataRoot, 'manifest.json'), 'utf8'))
const includedDatasets = manifest.datasets.filter((dataset) =>
  dataset.type === 'vocabulary' || dataset.type === 'course',
)

function readArgument(name, fallback) {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function audioFileFor(key, extension = 'mp3') {
  const hash = createHash('sha256').update(`${audioType}:${key}`).digest('hex')
  return `type-${audioType}/files/${hash.slice(0, 2)}/${hash}.${extension}`
}

function detectAudioFormat(bytes) {
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
  ) return 'wav'
  throw new Error(`Unsupported audio signature: ${bytes.subarray(0, 12).toString('hex')}`)
}

async function collectCatalog() {
  const words = new Map()
  for (const dataset of includedDatasets) {
    const datasetPath = resolve(dataRoot, dataset.path.replace(/^\.\//, ''))
    const entries = JSON.parse(await readFile(datasetPath, 'utf8'))
    for (const entry of entries) {
      const term = String(entry.term ?? '').trim()
      if (!term || /\s/u.test(term)) continue
      const key = term.toLocaleLowerCase('en-US')
      if (!words.has(key)) words.set(key, term)
    }
  }

  return [...words.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, term]) => ({ key, term, file: audioFileFor(key) }))
}

async function readLatestRecords() {
  const records = new Map()
  try {
    const lines = (await readFile(journalPath, 'utf8')).split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (record?.key) records.set(record.key, record)
      } catch {
        // An interrupted final append should not prevent earlier completed records from resuming.
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return records
}

async function isCompleted(entry, record) {
  if (!record || record.status !== 'success' || record.file !== entry.file) return false
  try {
    const fileStat = await stat(resolve(audioRoot, entry.file))
    return fileStat.isFile() && fileStat.size === record.bytes && fileStat.size >= minimumAudioBytes
  } catch {
    return false
  }
}

let nextRequestAt = 0
let requestSlot = Promise.resolve()
async function waitForRequestSlot() {
  let releaseSlot
  const previousSlot = requestSlot
  requestSlot = new Promise((resolvePromise) => { releaseSlot = resolvePromise })
  await previousSlot
  const delay = Math.max(0, nextRequestAt - Date.now())
  if (delay) await wait(delay)
  nextRequestAt = Date.now() + requestIntervalMs
  releaseSlot()
}

async function fetchAudio(entry) {
  const googleLanguage = audioType === 1 ? 'en-GB' : 'en-US'
  const candidates = [
    {
      provider: 'youdao',
      voice: `type-${audioType}`,
      url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(entry.term)}&type=${audioType}`,
    },
    ...(audioType === 1 ? [
      {
        provider: 'youdao',
        voice: 'type-2-fallback',
        url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(entry.term)}&type=2`,
      },
      {
        provider: 'youdao',
        voice: 'default-fallback',
        url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(entry.term)}`,
      },
    ] : []),
    {
      provider: 'google-dictionary-static',
      voice: `${audioType === 1 ? 'en-GB' : 'en-US'}-fallback`,
      url: `https://ssl.gstatic.com/dictionary/static/sounds/20200429/${encodeURIComponent(entry.key)}--_${audioType === 1 ? 'gb' : 'us'}_1.mp3`,
    },
    {
      provider: 'google-translate-tts',
      voice: `${googleLanguage}-fallback`,
      url: `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${googleLanguage}&q=${encodeURIComponent(entry.term)}`,
    },
    {
      provider: 'google-translate-tts',
      voice: `${googleLanguage}-fallback`,
      url: `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${googleLanguage}&q=${encodeURIComponent(entry.term)}`,
    },
  ]
  let lastError = ''
  let lastStatus = 0
  let attemptsThisRun = 0

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const candidateAttempts = candidateIndex === 0 ? maxAttemptsPerRun : Math.min(2, maxAttemptsPerRun)
    for (let attempt = 1; attempt <= candidateAttempts; attempt += 1) {
      attemptsThisRun += 1
      try {
        await waitForRequestSlot()
        const response = await fetch(candidate.url, {
          headers: {
            Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1',
            'User-Agent': candidate.provider === 'google-translate-tts'
              ? 'Mozilla/5.0'
              : 'Study/1.0 audio cache builder',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(requestTimeoutMs),
        })
        lastStatus = response.status
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (!contentType.startsWith('audio/')) throw new Error(`Unexpected content type: ${contentType || 'missing'}`)

        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length < minimumAudioBytes) throw new Error(`Audio is too small: ${bytes.length} bytes`)
        if (bytes.length > maximumAudioBytes) throw new Error(`Audio is too large: ${bytes.length} bytes`)

        const format = detectAudioFormat(bytes)
        const file = audioFileFor(entry.key, format)
        const absolutePath = resolve(audioRoot, file)
        const temporaryPath = `${absolutePath}.${process.pid}.part`
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(temporaryPath, bytes)
        await rename(temporaryPath, absolutePath)

        return {
          status: 'success',
          file,
          format,
          bytes: bytes.length,
          httpStatus: response.status,
          url: candidate.url,
          provider: candidate.provider,
          voice: candidate.voice,
          fallback: candidateIndex > 0,
          attemptsThisRun,
        }
      } catch (error) {
        lastError = `${candidate.provider}: ${error?.message || String(error)}`
        if (attempt < candidateAttempts) await wait(500 * (2 ** (attempt - 1)))
      }
    }
  }

  return {
    status: 'failed',
    bytes: 0,
    httpStatus: lastStatus,
    url: candidates.at(-1).url,
    error: lastError,
    attemptsThisRun,
  }
}

let journalWrite = Promise.resolve()
function appendRecord(record) {
  journalWrite = journalWrite.then(() => appendFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8'))
  return journalWrite
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const collectedCatalog = await collectCatalog()
if (collectedCatalog.length !== 12_751) {
  throw new Error(`Expected 12,751 unique single-word entries, found ${collectedCatalog.length.toLocaleString()}`)
}

await mkdir(typeRoot, { recursive: true })
const latestRecords = await readLatestRecords()
const catalog = collectedCatalog.map((entry) => {
  const record = latestRecords.get(entry.key)
  return record?.status === 'success' && record.file ? { ...entry, file: record.file } : entry
})
const catalogFormats = catalog.reduce((counts, entry) => {
  const format = latestRecords.get(entry.key)?.format
  if (format) counts[format] = (counts[format] ?? 0) + 1
  return counts
}, {})
await writeJson(catalogPath, {
  schemaVersion: 1,
  audioType,
  sources: [
    'https://dict.youdao.com/dictvoice',
    'https://ssl.gstatic.com/dictionary/static/sounds',
    'https://translate.googleapis.com/translate_tts',
    'https://translate.google.com/translate_tts',
  ],
  total: catalog.length,
  formats: catalogFormats,
  includedDatasets: includedDatasets.map(({ id, label, type }) => ({ id, label, type })),
  entries: catalog,
})

const completedKeys = new Set()
let completedBytes = 0
for (const entry of catalog) {
  const record = latestRecords.get(entry.key)
  if (!force && await isCompleted(entry, record)) {
    completedKeys.add(entry.key)
    completedBytes += record.bytes
  }
}

let queue = catalog.filter((entry) => {
  if (completedKeys.has(entry.key)) return false
  if (!onlyFailed) return true
  return latestRecords.get(entry.key)?.status === 'failed'
})
if (limit) queue = queue.slice(0, limit)

let stopping = false
let processedThisRun = 0
let successThisRun = 0
let failedThisRun = 0
let bytesThisRun = 0
let lastCompleted
const startedAt = new Date().toISOString()

process.on('SIGINT', () => {
  stopping = true
  console.log('\nStopping after active downloads finish...')
})
process.on('SIGTERM', () => {
  stopping = true
  console.log('\nStopping after active downloads finish...')
})

async function saveProgress() {
  const knownSuccess = completedKeys.size + successThisRun
  const latestFailedKeys = new Set(
    [...latestRecords.entries()]
      .filter(([key, record]) => record.status === 'failed' && !completedKeys.has(key))
      .map(([key]) => key),
  )
  const totalFailed = new Set([
    ...latestFailedKeys,
    ...catalog
      .filter((entry) => latestRecords.get(entry.key)?.status === 'failed')
      .map((entry) => entry.key),
  ]).size

  const progress = {
    schemaVersion: 1,
    audioType,
    total: catalog.length,
    success: knownSuccess,
    failed: totalFailed,
    pending: Math.max(0, catalog.length - knownSuccess - totalFailed),
    bytes: completedBytes + bytesThisRun,
    processedThisRun,
    successThisRun,
    failedThisRun,
    startedAt,
    updatedAt: new Date().toISOString(),
    stopped: stopping,
    lastCompleted,
    catalog: 'catalog.json',
    journal: 'download-records.jsonl',
  }
  progressWrite = progressWrite.then(() => writeJson(progressPath, progress))
  return progressWrite
}

let queueIndex = 0
let progressWrite = Promise.resolve()
async function worker() {
  while (!stopping) {
    const currentIndex = queueIndex
    queueIndex += 1
    if (currentIndex >= queue.length) return
    const entry = queue[currentIndex]
    const previousAttempts = Number(latestRecords.get(entry.key)?.attempts ?? 0)
    const result = await fetchAudio(entry)
    const record = {
      key: entry.key,
      term: entry.term,
      file: entry.file,
      ...result,
      attempts: previousAttempts + result.attemptsThisRun,
      updatedAt: new Date().toISOString(),
    }
    delete record.attemptsThisRun
    latestRecords.set(entry.key, record)
    await appendRecord(record)

    processedThisRun += 1
    lastCompleted = { key: entry.key, term: entry.term, status: record.status }
    if (record.status === 'success') {
      successThisRun += 1
      bytesThisRun += record.bytes
    } else {
      failedThisRun += 1
    }

    if (processedThisRun % 25 === 0) await saveProgress()
    if (processedThisRun % 100 === 0 || processedThisRun === queue.length) {
      const totalDone = completedKeys.size + successThisRun
      console.log(`${new Date().toISOString()} success=${totalDone}/${catalog.length} failedThisRun=${failedThisRun} bytes=${completedBytes + bytesThisRun}`)
    }
  }
}

console.log(`Audio type: ${audioType}`)
console.log(`Catalog: ${catalog.length.toLocaleString()} unique words`)
console.log(`Already complete: ${completedKeys.size.toLocaleString()}`)
console.log(`Queued this run: ${queue.length.toLocaleString()}`)
console.log(`Concurrency: ${concurrency}; minimum request interval: ${requestIntervalMs}ms`)

await saveProgress()
await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, worker))
await journalWrite
await saveProgress()

const finalCatalog = collectedCatalog.map((entry) => {
  const record = latestRecords.get(entry.key)
  return record?.status === 'success' && record.file ? { ...entry, file: record.file } : entry
})
const finalCatalogFormats = finalCatalog.reduce((counts, entry) => {
  const format = latestRecords.get(entry.key)?.format
  if (format) counts[format] = (counts[format] ?? 0) + 1
  return counts
}, {})
await writeJson(catalogPath, {
  schemaVersion: 1,
  audioType,
  sources: [
    'https://dict.youdao.com/dictvoice',
    'https://ssl.gstatic.com/dictionary/static/sounds',
    'https://translate.googleapis.com/translate_tts',
    'https://translate.google.com/translate_tts',
  ],
  total: finalCatalog.length,
  formats: finalCatalogFormats,
  includedDatasets: includedDatasets.map(({ id, label, type }) => ({ id, label, type })),
  entries: finalCatalog,
})

console.log(`Finished. successThisRun=${successThisRun} failedThisRun=${failedThisRun} stopped=${stopping}`)
if (failedThisRun) process.exitCode = 2
