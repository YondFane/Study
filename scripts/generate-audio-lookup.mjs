import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const SHARD_COUNT = 64

// FNV-1a is intentionally duplicated in the browser audio service. It is fast,
// deterministic for JavaScript strings, and keeps the 12k terms evenly spread.
function lookupShard(key) {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % SHARD_COUNT).toString(16).padStart(2, '0')
}

async function generateLookup(audioType) {
  const audioRoot = resolve(projectRoot, `data/audio/type-${audioType}`)
  const catalog = JSON.parse(await readFile(resolve(audioRoot, 'catalog.json'), 'utf8'))
  const lookupRoot = resolve(audioRoot, 'lookup')
  const shards = Array.from({ length: SHARD_COUNT }, () => Object.create(null))

  for (const entry of catalog.entries ?? []) {
    if (!entry?.key || !entry?.file) continue
    const shardIndex = Number.parseInt(lookupShard(entry.key), 16)
    shards[shardIndex][entry.key] = entry.file
  }

  await rm(lookupRoot, { recursive: true, force: true })
  await mkdir(lookupRoot, { recursive: true })
  await Promise.all(shards.map((entries, index) => {
    const filename = `${index.toString(16).padStart(2, '0')}.json`
    return writeFile(resolve(lookupRoot, filename), JSON.stringify(entries))
  }))

  return catalog.entries?.length ?? 0
}

const counts = await Promise.all([1, 2].map(generateLookup))
console.log(`Generated 64 audio lookup shards for type-1 (${counts[0]}) and type-2 (${counts[1]}).`)
