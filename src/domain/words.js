const TYPE_LABELS = {
  vocabulary: '词汇',
  phrase: '词组',
  course: '课程词汇',
}

export function wordKey(word) {
  return `${word?.__datasetId ?? 'unknown'}:${word?.term ?? ''}`
}

export function pronunciationFor(word, lang = 'en-GB') {
  if (!word) return ''
  return lang === 'en-US'
    ? word.americanPronunciation || word.britishPronunciation || ''
    : word.britishPronunciation || word.americanPronunciation || ''
}

export function typeLabel(word) {
  return TYPE_LABELS[word?.__type] ?? '词条'
}

