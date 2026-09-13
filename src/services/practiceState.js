export const PRACTICE_STATE_KEY = 'study-english:practice-state:v2'
const LEGACY_PRACTICE_STATE_KEY = 'study-english:practice-state:v1'
const BOOLEAN_SETTINGS = [
  'dictionaryPronunciationEnabled', 'autoRead', 'recordProgress',
  'particlesEnabled', 'randomPractice', 'trackErrors', 'hideWord',
]

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeProgress(value) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, index]) =>
    Number.isSafeInteger(index) && index >= 0,
  ))
}

function sanitizeState(value) {
  if (!isRecord(value)) return {}
  const settings = {}
  if (isRecord(value.settings)) {
    for (const key of BOOLEAN_SETTINGS) {
      if (typeof value.settings[key] === 'boolean') settings[key] = value.settings[key]
    }
    if (['en-GB', 'en-US'].includes(value.settings.accent)) settings.accent = value.settings.accent
  }

  // 本地数据可能来自旧版本或损坏的缓存；逐字段校验，只丢弃无效部分。
  return {
    version: 2,
    activeCategoryId: typeof value.activeCategoryId === 'string' ? value.activeCategoryId : undefined,
    progressByCategory: sanitizeProgress(value.progressByCategory),
    browseProgressByCategory: sanitizeProgress(value.browseProgressByCategory),
    wrongWordsByCategory: isRecord(value.wrongWordsByCategory)
      ? Object.fromEntries(Object.entries(value.wrongWordsByCategory)
        .filter(([, words]) => Array.isArray(words))
        .map(([id, words]) => [id, [...new Set(words.filter((word) => typeof word === 'string'))]]))
      : {},
    settings,
  }
}

function readStoredObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return isRecord(value) ? value : undefined
  } catch (error) {
    console.warn('无法读取本地练习记录，将使用默认设置。', error)
    return undefined
  }
}

export function readPracticeState() {
  const currentState = readStoredObject(PRACTICE_STATE_KEY)
  if (currentState) return sanitizeState(currentState)

  const legacyState = readStoredObject(LEGACY_PRACTICE_STATE_KEY)
  if (!legacyState) return {}
  const migrated = sanitizeState(legacyState)
  // 保留旧版的进度、错题和有效设置，只将旧版默认口音迁移为英式。
  migrated.settings.accent = 'en-GB'
  return migrated
}

export function readLegacyPracticeIndex(categoryId) {
  try {
    const value = localStorage.getItem(`study-progress:${categoryId}`)
    if (value === null || !value.trim()) return undefined
    const index = Number(value)
    return Number.isSafeInteger(index) && index >= 0 ? index : undefined
  } catch {
    // 禁用存储不代表词库加载失败，继续使用内存中的默认进度。
    return undefined
  }
}

export function writePracticeState(state) {
  try {
    localStorage.setItem(PRACTICE_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    // 隐私设置或配额不足只影响持久化，不能中断学习。
    console.warn('无法保存本地练习记录。', error)
  }
}
