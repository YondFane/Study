const localSearchTextCache = new WeakMap()
const normalizedIndexCache = new WeakMap()
const datasetSourceTextCache = new WeakMap()

export function normalizeSearchKeyword(value) {
  return String(value ?? '').trim().toLowerCase()
}

function searchableTextFor(word) {
  if (!localSearchTextCache.has(word)) {
    // Dataset entries are immutable for the page lifetime. Normalize their fields
    // once instead of repeating seven lowercase conversions on every keystroke.
    const text = [
      word.term,
      word.britishPronunciation,
      word.americanPronunciation,
      word.definition,
      word.exampleSentence,
      word.exampleTranslation,
      word.__datasetLabel,
    ].map((value) => String(value ?? '').toLowerCase()).join('\n')
    localSearchTextCache.set(word, text)
  }
  return localSearchTextCache.get(word)
}

export function wordMatchesKeyword(word, keyword) {
  return searchableTextFor(word).includes(keyword)
}

function normalizedTermsFor(searchIndex, datasetId) {
  if (!normalizedIndexCache.has(searchIndex)) normalizedIndexCache.set(searchIndex, new Map())
  const datasetCache = normalizedIndexCache.get(searchIndex)

  if (!datasetCache.has(datasetId)) {
    const terms = searchIndex.datasets[datasetId] ?? []
    datasetCache.set(datasetId, terms.map((term) => normalizeSearchKeyword(term)))
  }
  return datasetCache.get(datasetId)
}

function datasetSourceText(dataset) {
  if (!datasetSourceTextCache.has(dataset)) {
    datasetSourceTextCache.set(
      dataset,
      normalizeSearchKeyword(`${dataset.label}\n${dataset.categoryLabel}`),
    )
  }
  return datasetSourceTextCache.get(dataset)
}

export function searchGlobalIndex(searchIndex, datasets, keyword) {
  const results = []

  for (const dataset of datasets) {
    const terms = searchIndex.datasets[dataset.id] ?? []
    const normalizedTerms = normalizedTermsFor(searchIndex, dataset.id)
    const sourceMatches = datasetSourceText(dataset).includes(keyword)

    for (let rowIndex = 0; rowIndex < terms.length; rowIndex += 1) {
      if (!sourceMatches && !normalizedTerms[rowIndex].includes(keyword)) continue

      results.push({
        term: terms[rowIndex],
        britishPronunciation: '',
        americanPronunciation: '',
        definition: '',
        __categoryId: dataset.categoryId,
        __categoryLabel: dataset.categoryLabel,
        __datasetId: dataset.id,
        __datasetLabel: dataset.label,
        __type: dataset.type,
        __searchRowIndex: rowIndex,
      })
    }
  }

  return results
}
