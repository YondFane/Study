import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick } from 'vue'
import { browserStubs, deferred, mountLogic } from './helpers/component.js'
import * as wordDomain from '../src/domain/words.js'
import * as search from '../src/utils/search.js'
import * as practiceState from '../src/services/practiceState.js'
import { useDebouncedRef } from '../src/composables/useDebouncedRef.js'

async function setup({ cached = {}, disabledStorage = false } = {}) {
  const clock = browserStubs()
  const stored = { [practiceState.PRACTICE_STATE_KEY]: JSON.stringify(cached) }
  globalThis.localStorage = {
    getItem(key) { if (disabledStorage) throw new Error('SecurityError'); return stored[key] ?? null },
    setItem(key, value) { if (disabledStorage) throw new Error('SecurityError'); stored[key] = value },
  }
  const entries = ['cat', 'dog', 'bird'].map(term => ({ term, __datasetId: 'a' }))
  const initial = { id: 'a', categoryId: 'group', load: async () => entries }
  const indexRequest = deferred()
  const detailRequests = []
  const component = mountLogic('../../src/App.vue', {
    './composables/useDebouncedRef.js': { useDebouncedRef },
    './components/VirtualWordList.vue': { default: {} },
    './domain/library.js': {
      libraryCategories: [initial], navigationGroups: [{ id: 'group', options: [initial] }],
      datasetDefinitions: [{ id: 'a', label: 'A' }],
      loadLibrarySearchIndex: () => indexRequest.promise,
      loadLibraryDatasetEntry: () => { const request = deferred(); detailRequests.push(request); return request.promise },
    },
    './domain/words.js': wordDomain,
    './services/practiceState.js': practiceState,
    './services/pronunciation.js': { createPronunciationService: () => ({ speak() {}, stop() {}, refreshVoices() {} }) },
    './utils/search.js': search,
  })
  await nextTick()
  await nextTick()
  return { ...component, clock, indexRequest, detailRequests, entries, stored }
}

test('连续正确提交只前进一次', async t => {
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  s.openPractice()
  s.answer.value = 'cat'
  s.submitAnswer(); s.submitAnswer()
  assert.equal(s.submissionPending.value, true)
  app.clock.runTimers()
  assert.equal(s.practiceIndex.value, 1)
  assert.equal(s.submissionPending.value, false)
})

test('答对后手动切词不会跳过下一题或删除未作答错题', async t => {
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  s.openPractice()
  s.wrongWords.value = [...app.entries]
  s.startWrongPractice()
  s.answer.value = 'cat'; s.submitAnswer()
  s.nextPracticeWord()
  app.clock.runTimers()
  assert.equal(s.practiceWord.value.term, 'dog')
  assert.deepEqual(s.wrongWords.value.map(word => word.term), ['cat', 'dog', 'bird'])
})

test('正确错题只移除提交时的词条，最后一题显示完成状态', async t => {
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  s.openPractice(); s.wrongWords.value = app.entries.slice(0, 2); s.startWrongPractice()
  for (const word of ['cat', 'dog']) {
    s.answer.value = word; s.submitAnswer(); s.submitAnswer(); app.clock.runTimers()
  }
  assert.equal(s.wrongWords.value.length, 0)
  assert.equal(s.wrongPracticeCompleted.value, true)
})

test('重新练习、离开页面和切词库会取消旧题跳转', async t => {
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  for (const change of [() => s.resetPractice(), () => { s.viewMode.value = 'library' },
    () => s.selectCategory({ id: 'b', load: async () => [{ term: 'fish', __datasetId: 'b' }] })]) {
    s.openPractice(); s.answer.value = s.practiceWord.value.term; s.submitAnswer()
    await change(); app.clock.runTimers()
    assert.equal(s.practiceIndex.value, 0)
    assert.equal(s.submissionPending.value, false)
  }
})

test('索引返回前修改关键词，旧搜索不能覆盖新输入', async t => {
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  s.query.value = 'cat'
  const pending = s.executeGlobalSearch()
  s.query.value = 'dog'
  app.indexRequest.resolve({ datasets: { a: ['cat', 'dog'] } })
  await pending
  assert.equal(s.globalSearchMode.value, false)
  assert.equal(s.globalSearchResults.value.length, 0)
  await s.executeGlobalSearch()
  assert.equal(s.globalSearchKeyword.value, 'dog')
  assert.equal(s.globalSearchResults.value[0].term, 'dog')
})

test('切换词库后忽略旧搜索和旧详情', async t => {
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  s.query.value = 'cat'
  const pending = s.executeGlobalSearch()
  await s.selectCategory({ id: 'b', load: async () => [{ term: 'fish', __datasetId: 'b' }] })
  app.indexRequest.resolve({ datasets: { a: ['cat'] } })
  await pending
  assert.equal(s.globalSearchMode.value, false)
  assert.equal(s.selectedWord.value.term, 'fish')

  s.query.value = 'cat'; await s.executeGlobalSearch()
  assert.equal(s.selectedWordLoading.value, true)
  s.query.value = ''
  app.detailRequests[0].resolve(app.entries[0])
  await nextTick(); await nextTick()
  assert.equal(s.selectedWord.value.term, 'fish')
  assert.equal(s.globalSearchResults.value.length, 0)
  assert.equal(s.selectedWordLoading.value, false)
})

test('快速切分类时只接受最后一次加载，保留各自错题和进度', async t => {
  const app = await setup({ cached: {
    progressByCategory: { a: 2, b: 1 }, wrongWordsByCategory: { a: ['a:cat'], b: ['b:fish'] },
  } }); t.after(app.unmount)
  const s = app.state
  const old = deferred()
  const pending = s.selectCategory({ id: 'old', load: () => old.promise })
  await s.selectCategory({ id: 'b', load: async () => [{ term: 'fish', __datasetId: 'b' }, { term: 'ant', __datasetId: 'b' }] })
  old.resolve([{ term: 'stale', __datasetId: 'old' }]); await pending; await nextTick()
  assert.equal(s.activeCategory.value.id, 'b')
  assert.equal(s.practiceIndex.value, 1)
  assert.deepEqual(s.wrongWords.value.map(word => word.term), ['fish'])
  assert.deepEqual(s.wrongWordsByCategory.value.a, ['a:cat'])
  assert.equal(s.progressByCategory.value.a, 2)
})

test('存储被禁用仍能载入词库并练习', async t => {
  t.mock.method(console, 'warn', () => {})
  const app = await setup({ disabledStorage: true }); t.after(app.unmount)
  assert.equal(app.state.loadError.value, '')
  assert.equal(app.state.words.value.length, 3)
  app.state.openPractice()
  assert.equal(app.state.practiceWord.value.term, 'cat')
})

test('较早的详情失败不能清除新详情的加载状态或替换选中词', async t => {
  t.mock.method(console, 'error', () => {})
  const app = await setup(); t.after(app.unmount)
  const s = app.state
  const first = { term: 'cat', __datasetId: 'a', __searchRowIndex: 0 }
  const second = { term: 'dog', __datasetId: 'a', __searchRowIndex: 1 }
  s.globalSearchMode.value = true
  s.globalSearchResults.value = [first, second]
  const old = s.selectWord(first)
  const current = s.selectWord(second)
  app.detailRequests[0].reject(new Error('old request failed')); await old
  assert.equal(s.selectedWord.value, second)
  assert.equal(s.selectedWordLoading.value, true)
  app.detailRequests[1].resolve(app.entries[1]); await current
  assert.equal(s.selectedWord.value.term, 'dog')
  assert.equal(s.selectedWordLoading.value, false)
})

test('卸载组件时取消尚未执行的自动跳题', async () => {
  const app = await setup()
  app.state.openPractice(); app.state.answer.value = 'cat'; app.state.submitAnswer()
  app.unmount(); app.clock.runTimers()
  assert.equal(app.state.practiceIndex.value, 0)
  assert.equal(app.state.submissionPending.value, false)
})
