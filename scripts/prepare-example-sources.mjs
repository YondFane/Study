import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const examplesRoot = resolve(projectRoot, 'data/examples')
const catalogPath = resolve(examplesRoot, 'catalog.json')
const sourcesRoot = resolve(examplesRoot, 'sources')
const tatoebaRoot = resolve(sourcesRoot, 'tatoeba')
const wordnetRoot = resolve(sourcesRoot, 'wordnet')
const indexesRoot = resolve(sourcesRoot, 'indexes')
const tatoebaRawPath = resolve(tatoebaRoot, 'sentences_CC0.csv')
const wordnetArchivePath = resolve(wordnetRoot, 'wordnet.zip')
const tatoebaIndexPath = resolve(indexesRoot, 'tatoeba-index.json')
const wordnetIndexPath = resolve(indexesRoot, 'wordnet-index.json')
const sourceManifestPath = resolve(indexesRoot, 'manifest.json')

const TATOEBA_URL = 'https://downloads.tatoeba.org/exports/sentences_CC0.csv'
const WORDNET_URL = 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip'
const WORDNET_UPSTREAM_URL = 'https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz'
const WORDNET_SHA256 = 'cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59'
const refresh = process.argv.includes('--refresh')

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'our', 'she',
  'that', 'the', 'their', 'they', 'this', 'to', 'was', 'we', 'were', 'with', 'you', 'your',
])

const blockedSentencePatterns = [
  /https?:\/\//i,
  /\b(?:fuck|shit|bitch|porn)\b/i,
  /\b(?:Tom|Mary|John|Alice|Bob|Jack|Jane|Mike|Michael|Peter|Susan|Linda|Nancy)\b/,
  /[{}<>]/,
]

function normalizeTerm(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .trim()
    .toLocaleLowerCase('en-US')
}

function tokensOf(value) {
  return normalizeTerm(value).match(/[a-z]+(?:['-][a-z]+)*|\d+%?/g) || []
}

function sentenceSequence(value) {
  return ` ${tokensOf(value).join(' ')} `
}

function isIndexableTerm(key) {
  const tokens = tokensOf(key)
  if (!tokens.length || tokens.length > 8 || stopWords.has(key)) return false
  if (tokens.length === 1 && tokens[0].length < 2) return false
  if (/\b(?:sb|sth|somebody|something)\.?\b|\.{2,}|[/()[\]{}]/i.test(key)) return false
  return tokens.join(' ') === normalizeTerm(key).replace(/[^a-z0-9%'-]+/g, ' ').trim()
}

function containsTerm(sentence, key) {
  const needle = ` ${tokensOf(key).join(' ')} `
  return needle.length > 2 && sentenceSequence(sentence).includes(needle)
}

function sentenceScore(sentence, key) {
  const words = tokensOf(sentence)
  const idealLengthPenalty = Math.abs(words.length - 12) * 2
  const targetPosition = sentenceSequence(sentence).indexOf(` ${tokensOf(key).join(' ')} `)
  const quotePenalty = /[“”"']/.test(sentence) ? 8 : 0
  const digitPenalty = /\d/.test(sentence) && !/\d/.test(key) ? 4 : 0
  const punctuationBonus = /[.!?]$/.test(sentence.trim()) ? -2 : 0
  return idealLengthPenalty + Math.max(0, targetPosition / 80) + quotePenalty + digitPenalty + punctuationBonus
}

function addCandidate(best, key, candidate, limit = 5) {
  const candidates = best.get(key) || []
  if (candidates.some((item) => item.sentence === candidate.sentence)) return
  candidates.push(candidate)
  candidates.sort((left, right) => left.score - right.score)
  best.set(key, candidates.slice(0, limit))
}

function isSuitableSentence(sentence) {
  const wordCount = tokensOf(sentence).length
  if (wordCount < 5 || wordCount > 24) return false
  if (!/^[A-Z]/.test(sentence.trim())) return false
  if (!/[a-z]/i.test(sentence) || blockedSentencePatterns.some((pattern) => pattern.test(sentence))) return false
  const wordsAfterFirst = sentence.trim().split(/\s+/).slice(1).join(' ')
  if (/\b[A-Z][a-z]{2,}\b/.test(wordsAfterFirst)) return false
  return true
}

async function pathExists(path) {
  try {
    return (await stat(path)).size > 0
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function downloadFile(url, destination) {
  if (!refresh && await pathExists(destination)) {
    console.log(`Using cached download: ${destination}`)
    return
  }

  await mkdir(dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.part`
  console.log(`Downloading ${url}`)
  let response
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': 'Study-example-source-builder/1.0' },
        signal: AbortSignal.timeout(15 * 60 * 1000),
      })
      break
    } catch (error) {
      lastError = error
      if (attempt === 5) break
      console.log(`  Connection attempt ${attempt} failed; retrying...`)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 2000))
    }
  }
  if (!response) throw lastError
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}: ${url}`)

  const total = Number(response.headers.get('content-length') || 0)
  let downloaded = 0
  let lastReported = 0
  const progressStream = new TransformStream({
    transform(chunk, controller) {
      downloaded += chunk.byteLength
      if (downloaded - lastReported >= 5 * 1024 * 1024) {
        lastReported = downloaded
        const suffix = total ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ''
        console.log(`  ${(downloaded / 1024 / 1024).toFixed(1)} MB${suffix}`)
      }
      controller.enqueue(chunk)
    },
  })
  const body = response.body.pipeThrough(progressStream)
  await pipeline(Readable.fromWeb(body), createWriteStream(temporaryPath))
  await rename(temporaryPath, destination)
  console.log(`Saved ${(downloaded / 1024 / 1024).toFixed(1)} MB: ${destination}`)
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with code ${code}`)))
  })
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function ensureWordNetExtracted() {
  const existing = await findFiles(wordnetRoot, /^data\.(?:noun|verb|adj|adv)$/)
  if (existing.length >= 4 && !refresh) return existing
  console.log('Extracting WordNet database...')
  await run('tar', ['-xf', wordnetArchivePath, '-C', wordnetRoot])
  const extracted = await findFiles(wordnetRoot, /^data\.(?:noun|verb|adj|adv)$/)
  if (extracted.length < 4) throw new Error('WordNet extraction completed but data files were not found.')
  return extracted
}

async function findFiles(root, pattern) {
  const matches = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (pattern.test(entry.name)) matches.push(path)
    }
  }
  try {
    await walk(root)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return matches
}

async function loadCatalogTerms() {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  const definitionsByKey = new Map()
  for (const entry of catalog.entries) {
    if (!definitionsByKey.has(entry.key)) definitionsByKey.set(entry.key, new Set())
    definitionsByKey.get(entry.key).add(entry.definition)
  }

  return [...definitionsByKey]
    .filter(([key, definitions]) => definitions.size === 1 && isIndexableTerm(key))
    .map(([key]) => ({ key, tokens: tokensOf(key) }))
}

function buildTermSequenceMap(terms) {
  const map = new Map()
  const lengths = new Set()
  for (const term of terms) {
    map.set(term.tokens.join(' '), term.key)
    lengths.add(term.tokens.length)
  }
  return { map, lengths: [...lengths].sort((left, right) => left - right) }
}

async function buildTatoebaIndex(terms) {
  console.log('Building Tatoeba CC0 index...')
  const termSequences = buildTermSequenceMap(terms)
  const best = new Map()
  let englishSentences = 0
  const lines = createInterface({ input: createReadStream(tatoebaRawPath, { encoding: 'utf8' }), crlfDelay: Infinity })

  for await (const line of lines) {
    const columns = line.split('\t')
    if (columns.length < 3 || columns[1] !== 'eng') continue
    const id = columns[0]
    const sentence = columns[2].trim()
    englishSentences += 1
    if (!isSuitableSentence(sentence)) continue

    const sentenceTokens = tokensOf(sentence)
    for (const length of termSequences.lengths) {
      if (length > sentenceTokens.length) break
      for (let start = 0; start <= sentenceTokens.length - length; start += 1) {
        const key = termSequences.map.get(sentenceTokens.slice(start, start + length).join(' '))
        if (!key) continue
        const score = sentenceScore(sentence, key)
        addCandidate(best, key, {
          sentence,
          score,
          source: {
            type: 'tatoeba',
            id,
            license: 'CC0-1.0',
            url: `https://tatoeba.org/en/sentences/show/${id}`,
          },
        })
      }
    }
  }

  const entries = Object.fromEntries([...best]
    .map(([key, candidates]) => [key, { candidates }])
    .sort(([left], [right]) => left.localeCompare(right, 'en')))
  await writeFile(tatoebaIndexPath, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, 'utf8')
  console.log(`Tatoeba: ${englishSentences.toLocaleString()} English CC0 sentences; ${best.size.toLocaleString()} catalog terms matched.`)
  return { sentenceCount: englishSentences, matchCount: best.size }
}

async function buildWordNetIndex(terms, dataFiles) {
  console.log('Building WordNet example index...')
  const allowedTerms = new Set(terms.map((term) => term.key))
  const best = new Map()
  let exampleCount = 0

  for (const path of dataFiles) {
    const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line || /^\s/.test(line) || !line.includes('|')) continue
      const separator = line.indexOf('|')
      const fields = line.slice(0, separator).trim().split(/\s+/)
      const gloss = line.slice(separator + 1)
      const lemmaCount = Number.parseInt(fields[3], 16)
      if (!Number.isFinite(lemmaCount)) continue
      const lemmas = []
      for (let index = 0; index < lemmaCount; index += 1) {
        lemmas.push(normalizeTerm(fields[4 + index * 2].replaceAll('_', ' ')))
      }
      const examples = [...gloss.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim())
      exampleCount += examples.length
      if (!examples.length) continue

      for (const key of lemmas) {
        if (!allowedTerms.has(key)) continue
        for (const example of examples.filter((candidate) => isSuitableSentence(candidate) && containsTerm(candidate, key))) {
          const sentence = /[.!?]$/.test(example) ? example : `${example}.`
          addCandidate(best, key, {
            sentence,
            score: sentenceScore(sentence, key),
            source: {
              type: 'wordnet',
              synsetOffset: fields[0],
              partOfSpeech: fields[2],
              version: '3.0',
              license: 'Princeton-WordNet',
              url: 'https://wordnet.princeton.edu/license-and-commercial-use',
            },
          })
        }
      }
    }
  }

  const entries = Object.fromEntries([...best]
    .map(([key, candidates]) => [key, { candidates }])
    .sort(([left], [right]) => left.localeCompare(right, 'en')))
  await writeFile(wordnetIndexPath, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, 'utf8')
  console.log(`WordNet: ${exampleCount.toLocaleString()} example strings; ${best.size.toLocaleString()} catalog terms matched.`)
  return { exampleCount, matchCount: best.size }
}

await mkdir(tatoebaRoot, { recursive: true })
await mkdir(wordnetRoot, { recursive: true })
await mkdir(indexesRoot, { recursive: true })

if (!await pathExists(catalogPath)) {
  throw new Error('Example catalog is missing. Run "pnpm run prepare:examples" first.')
}

await downloadFile(TATOEBA_URL, tatoebaRawPath)
await downloadFile(WORDNET_URL, wordnetArchivePath)
const wordnetDigest = await sha256File(wordnetArchivePath)
if (wordnetDigest !== WORDNET_SHA256) {
  throw new Error(`WordNet SHA-256 mismatch: expected ${WORDNET_SHA256}, received ${wordnetDigest}`)
}
console.log('WordNet SHA-256 verified.')
const wordnetDataFiles = await ensureWordNetExtracted()
const terms = await loadCatalogTerms()
console.log(`Indexable unambiguous catalog terms: ${terms.length.toLocaleString()}`)

const tatoebaStats = await buildTatoebaIndex(terms)
const wordnetStats = await buildWordNetIndex(terms, wordnetDataFiles)
const combinedKeys = new Set([
  ...Object.keys(JSON.parse(await readFile(tatoebaIndexPath, 'utf8')).entries),
  ...Object.keys(JSON.parse(await readFile(wordnetIndexPath, 'utf8')).entries),
])

await writeFile(sourceManifestPath, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: {
    tatoeba: {
      url: TATOEBA_URL,
      license: 'CC0-1.0',
      ...tatoebaStats,
    },
    wordnet: {
      distributionUrl: WORDNET_URL,
      upstreamUrl: WORDNET_UPSTREAM_URL,
      sha256: WORDNET_SHA256,
      license: 'Princeton-WordNet',
      ...wordnetStats,
    },
  },
  uniqueMatchedTerms: combinedKeys.size,
}, null, 2)}\n`, 'utf8')

console.log(`Source indexes ready: ${combinedKeys.size.toLocaleString()} unique catalog terms have corpus examples.`)
console.log(`Manifest: ${sourceManifestPath}`)
