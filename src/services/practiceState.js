export const PRACTICE_STATE_KEY = 'study-english:practice-state:v2'
const LEGACY_PRACTICE_STATE_KEY = 'study-english:practice-state:v1'

export function readPracticeState() {
  try {
    const currentState = localStorage.getItem(PRACTICE_STATE_KEY)
    if (currentState) return JSON.parse(currentState)

    const legacyState = JSON.parse(localStorage.getItem(LEGACY_PRACTICE_STATE_KEY) || '{}')
    if (!Object.keys(legacyState).length) return {}

    // V1 had no stable accent default. Preserve all user data while migrating
    // only that setting to the V2 English (UK) default.
    return {
      ...legacyState,
      version: 2,
      settings: {
        ...legacyState.settings,
        accent: 'en-GB',
      },
    }
  } catch (error) {
    console.warn('无法读取本地练习记录，将使用默认设置。', error)
    return {}
  }
}

export function writePracticeState(state) {
  try {
    localStorage.setItem(PRACTICE_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    // Storage can fail in privacy mode or when the browser quota is exhausted.
    // Learning must remain usable even when persistence is unavailable.
    console.warn('无法保存本地练习记录。', error)
  }
}

