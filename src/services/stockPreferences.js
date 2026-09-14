export const MARKET_THEMES = [
  { id: 'light', label: '晴日绿' },
  { id: 'blue', label: '晴空蓝' },
  { id: 'dark', label: '深夜墨' },
]
const THEME_KEY = 'study-market:theme:v1'

export function readMarketTheme() {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_KEY)
    if (MARKET_THEMES.some(theme => theme.id === saved)) return saved
  } catch { /* Browser storage is optional. */ }
  return 'light'
}

export function saveMarketTheme(value) {
  if (!MARKET_THEMES.some(theme => theme.id === value)) return
  try { globalThis.localStorage?.setItem(THEME_KEY, value) } catch { /* Keep in-memory selection. */ }
}
