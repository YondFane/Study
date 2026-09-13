import assert from 'node:assert/strict'
import test from 'node:test'
import { PRACTICE_STATE_KEY, readPracticeState, readLegacyPracticeIndex, writePracticeState } from '../src/services/practiceState.js'

function storage(entries) {
  globalThis.localStorage = { getItem: key => entries[key] ?? null, setItem: (key, value) => { entries[key] = value } }
}

test('损坏或类型错误的缓存不会使初始化报错', t => {
  t.mock.method(console, 'warn', () => {})
  for (const value of ['null', '[]', '123', '"bad"', '{']) {
    storage({ [PRACTICE_STATE_KEY]: value })
    assert.deepEqual(readPracticeState(), {})
  }
})

test('仅保留有效进度、错题和布尔设置', () => {
  storage({ [PRACTICE_STATE_KEY]: JSON.stringify({
    settings: { autoRead: 'false', hideWord: true, accent: 'en-US' },
    progressByCategory: { good: 12, negative: -1, fraction: 2.5, invalid: null },
    browseProgressByCategory: [],
    wrongWordsByCategory: { good: ['cat', null, 12, 'cat'], invalid: 'cat' },
  }) })
  const state = readPracticeState()
  assert.deepEqual(state.settings, { hideWord: true, accent: 'en-US' })
  assert.deepEqual(state.progressByCategory, { good: 12 })
  assert.deepEqual(state.browseProgressByCategory, {})
  assert.deepEqual(state.wrongWordsByCategory, { good: ['cat'] })
})

test('V1 迁移保留有效记录并设置英式默认口音', () => {
  storage({ 'study-english:practice-state:v1': JSON.stringify({
    progressByCategory: { a: 50 }, wrongWordsByCategory: { a: ['cat'] }, settings: { autoRead: false },
  }) })
  const state = readPracticeState()
  assert.equal(state.progressByCategory.a, 50)
  assert.deepEqual(state.wrongWordsByCategory.a, ['cat'])
  assert.deepEqual(state.settings, { autoRead: false, accent: 'en-GB' })
  writePracticeState(state)
  assert.deepEqual(readPracticeState(), state)
})

test('存储被禁用时所有读写入口均安全降级', t => {
  t.mock.method(console, 'warn', () => {})
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('QuotaExceededError') },
  }
  assert.deepEqual(readPracticeState(), {})
  assert.equal(readLegacyPracticeIndex('a'), undefined)
  assert.doesNotThrow(() => writePracticeState({}))
})

test('旧版独立进度校验数值范围', () => {
  for (const [value, expected] of [['42', 42], ['0', 0], ['-1', undefined], ['2.5', undefined], ['', undefined]]) {
    storage({ 'study-progress:a': value })
    assert.equal(readLegacyPracticeIndex('a'), expected)
  }
})
