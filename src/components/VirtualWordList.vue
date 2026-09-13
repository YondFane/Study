<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { pronunciationFor, wordKey } from '../domain/words.js'

const props = defineProps({
  words: { type: Array, required: true },
  selectedWord: { type: Object, default: null },
})
const emit = defineEmits(['select'])
const viewport = ref(null)
const scrollTop = ref(0)
const viewportHeight = ref(640)
const ROW_HEIGHT = 64
const OVERSCAN = 6
let resizeObserver

// 固定行高配合上下占位区，只挂载可视行和缓冲行，不随浏览进度积累节点。
const startIndex = computed(() => Math.max(0, Math.min(
  Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN,
  Math.max(0, props.words.length - 1),
)))
const endIndex = computed(() => Math.min(props.words.length,
  Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN,
))
const visibleWords = computed(() => props.words.slice(startIndex.value, endIndex.value))

function measureViewport() {
  if (!viewport.value?.clientHeight) return
  viewportHeight.value = viewport.value.clientHeight
  scrollTop.value = viewport.value.scrollTop
}

function scrollToIndex(index) {
  const element = viewport.value
  if (!element || index < 0 || index >= props.words.length) return
  const top = index * ROW_HEIGHT
  const height = element.clientHeight || viewportHeight.value
  if (top < element.scrollTop) element.scrollTop = top
  else if (top + ROW_HEIGHT > element.scrollTop + height) {
    element.scrollTop = top + ROW_HEIGHT - height
  }
  // 同步窗口位置，确保跳到第几千行时直接渲染目标附近的行。
  scrollTop.value = element.scrollTop
}

function revealSelection() {
  measureViewport()
  scrollToIndex(props.words.indexOf(props.selectedWord))
}

async function handleKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || !props.words.length) return
  const row = event.target.closest?.('[data-row-index]')
  const current = row ? Number(row.dataset.rowIndex) : Math.floor(scrollTop.value / ROW_HEIGHT)
  const pageSize = Math.max(1, Math.floor(viewportHeight.value / ROW_HEIGHT))
  const targets = {
    ArrowDown: current + 1, ArrowUp: current - 1,
    PageDown: current + pageSize, PageUp: current - pageSize,
    Home: 0, End: props.words.length - 1,
  }
  if (!(event.key in targets)) return
  event.preventDefault()
  const index = Math.min(Math.max(targets[event.key], 0), props.words.length - 1)
  scrollToIndex(index)
  await nextTick()
  // 虚拟化后保留跨渲染窗口的键盘导航，不要求目标按钮事先存在。
  viewport.value?.querySelector(`[data-row-index="${index}"]`)?.focus({ preventScroll: true })
  emit('select', props.words[index])
}

watch(() => props.selectedWord, () => nextTick(revealSelection))
watch(() => props.words, (words, previous) => {
  // 详情加载会替换某一行对象，不能因此把全局搜索列表滚回顶部。
  const sameRows = words.length === previous.length
    && words.every((word, index) => wordKey(word) === wordKey(previous[index]))
  if (!sameRows && viewport.value) {
    viewport.value.scrollTop = 0
    scrollTop.value = 0
  }
  nextTick(revealSelection)
})

onMounted(() => {
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(revealSelection)
    resizeObserver.observe(viewport.value)
  }
  window.addEventListener('resize', revealSelection)
  revealSelection()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', revealSelection)
})
defineExpose({ scrollToIndex })
</script>

<template>
  <div
    ref="viewport"
    class="word-list virtual-word-list"
    tabindex="0"
    aria-label="词条列表，可用方向键、Home 和 End 键切换词条"
    @scroll.passive="scrollTop = $event.currentTarget.scrollTop"
    @keydown="handleKeydown"
  >
    <div aria-hidden="true" :style="{ height: `${startIndex * ROW_HEIGHT}px` }"></div>
    <button
      v-for="(word, index) in visibleWords"
      :key="`${wordKey(word)}-${startIndex + index}`"
      type="button"
      :data-row-index="startIndex + index"
      :class="{ selected: selectedWord === word }"
      :aria-pressed="selectedWord === word"
      :title="word.term"
      @click="emit('select', word)"
    >
      <span class="word-index">{{ String(startIndex + index + 1).padStart(2, '0') }}</span>
      <span class="word-name">{{ word.term }}</span>
      <span class="word-phonetic">
        {{ pronunciationFor(word) }}<template v-if="word.__datasetLabel"> · {{ word.__datasetLabel }}</template>
      </span>
      <span class="arrow">→</span>
    </button>
    <div aria-hidden="true" :style="{ height: `${(words.length - endIndex) * ROW_HEIGHT}px` }"></div>
  </div>
</template>

<style scoped>
/* 行高必须与窗口计算一致；完整长词仍在详情区和悬停提示中展示。 */
.virtual-word-list { overflow-anchor: none; }
.virtual-word-list > button { height: 64px; min-height: 64px; box-sizing: border-box; }
.word-name { white-space: nowrap; }
</style>
