import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick } from 'vue'
import { browserStubs, mountLogic } from './helpers/component.js'
import * as wordDomain from '../src/domain/words.js'

test('恢复第 5000 个词及滚动末尾时，渲染窗口始终有界且序号正确', async t => {
  browserStubs()
  const words = Array.from({ length: 5604 }, (_, index) => ({ term: `word${index}`, __datasetId: 'a' }))
  const app = mountLogic('../../src/components/VirtualWordList.vue', { '../domain/words.js': wordDomain }, { words, selectedWord: words[4999] })
  t.after(app.unmount)
  const s = app.state
  s.viewport.value = { scrollTop: 0, clientHeight: 640 }
  s.revealSelection()
  assert.ok(s.visibleWords.value.length <= 23)
  assert.ok(s.visibleWords.value.includes(words[4999]))
  assert.ok(s.startIndex.value > 4900)
  s.scrollToIndex(5603)
  assert.equal(s.endIndex.value, 5604)
  assert.equal(s.visibleWords.value.at(-1), words[5603])
  s.scrollToIndex(0)
  assert.equal(s.startIndex.value, 0)
  assert.equal(s.visibleWords.value[0], words[0])
  await nextTick()
})

test('方向键和 End 可跨虚拟窗口定位', async t => {
  browserStubs()
  const words = Array.from({ length: 5604 }, (_, index) => ({ term: `word${index}` }))
  const app = mountLogic('../../src/components/VirtualWordList.vue', { '../domain/words.js': wordDomain }, { words })
  t.after(app.unmount)
  const s = app.state
  let focused
  s.viewport.value = { scrollTop: 0, clientHeight: 640, querySelector: selector => ({ focus() { focused = selector } }) }
  await s.handleKeydown({ key: 'End', target: {}, preventDefault() {} })
  assert.equal(focused, '[data-row-index="5603"]')
  assert.equal(s.endIndex.value, 5604)
  await s.handleKeydown({ key: 'Home', target: {}, preventDefault() {} })
  assert.equal(focused, '[data-row-index="0"]')
})

test('末尾筛选为少量结果或空列表时清除旧偏移，调整高度后仍显示目标词', async t => {
  browserStubs()
  const words = Array.from({ length: 5604 }, (_, index) => ({ term: `word${index}` }))
  const app = mountLogic('../../src/components/VirtualWordList.vue', { '../domain/words.js': wordDomain }, { words })
  t.after(app.unmount)
  const s = app.state
  s.viewport.value = { scrollTop: 0, clientHeight: 640 }
  s.scrollToIndex(5603)
  app.setProps({ words: words.slice(0, 2), selectedWord: words[1] })
  await nextTick(); await nextTick()
  assert.equal(s.startIndex.value, 0)
  assert.equal(s.visibleWords.value.length, 2)
  app.setProps({ words: [], selectedWord: null })
  await nextTick()
  assert.equal(s.endIndex.value, 0)
  assert.equal(s.visibleWords.value.length, 0)
  await s.handleKeydown({ key: 'End' })
  app.setProps({ words, selectedWord: words[4999] })
  s.viewport.value.clientHeight = 320
  await nextTick(); await nextTick()
  assert.equal(s.viewportHeight.value, 320)
  assert.ok(s.visibleWords.value.includes(words[4999]))
  assert.ok(s.visibleWords.value.length <= 18)
})
