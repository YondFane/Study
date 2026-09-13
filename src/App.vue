<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useDebouncedRef } from './composables/useDebouncedRef.js'
import VirtualWordList from './components/VirtualWordList.vue'
import {
  datasetDefinitions,
  libraryCategories as categories,
  loadLibraryDatasetEntry,
  loadLibrarySearchIndex,
  navigationGroups,
} from './domain/library.js'
import { pronunciationFor, typeLabel, wordKey } from './domain/words.js'
import { createPronunciationService } from './services/pronunciation.js'
import { readLegacyPracticeIndex, readPracticeState, writePracticeState } from './services/practiceState.js'
import {
  normalizeSearchKeyword,
  searchGlobalIndex,
  wordMatchesKeyword,
} from './utils/search.js'

// The canvas animation is only needed in practice mode. Keeping it async removes
// its setup code from the library page's critical JavaScript path.
const ParticleBackground = defineAsyncComponent(() =>
  import('./components/ParticleBackground.vue'),
)

const cachedState = readPracticeState()
const cachedSettings = cachedState.settings ?? {}
const initialCategory = categories.find((item) => item.id === cachedState.activeCategoryId)
  ?? categories[0]

const activeCategory = ref(initialCategory)
const activeNavigationGroup = computed(() =>
  navigationGroups.find((group) => group.id === activeCategory.value.categoryId)
    ?? navigationGroups[0],
)
const activePracticeDatasetIndex = computed(() =>
  categories.findIndex((category) => category.id === activeCategory.value.id),
)
const hasPreviousPracticeDataset = computed(() => activePracticeDatasetIndex.value > 0)
const hasNextPracticeDataset = computed(() =>
  activePracticeDatasetIndex.value >= 0
    && activePracticeDatasetIndex.value < categories.length - 1,
)
// Vocabulary collections are immutable after loading. shallowRef avoids creating
// reactive proxies for thousands of records while still reacting to list swaps.
const words = shallowRef([])
const selectedWord = shallowRef(null)
const detailPanel = ref(null)
const query = ref('')
const debouncedQuery = useDebouncedRef(query)
const globalSearchMode = ref(false)
const globalSearchLoading = ref(false)
const globalSearchResults = shallowRef([])
const globalSearchKeyword = ref('')
const globalSearchError = ref('')
const selectedWordLoading = ref(false)
const desktopWordList = ref(null)
const mobileWordList = ref(null)
const loading = ref(false)
const loadError = ref('')
const viewMode = ref('library')
const accent = ref(cachedSettings.accent === 'en-US' ? 'en-US' : 'en-GB')
const dictionaryPronunciationEnabled = ref(cachedSettings.dictionaryPronunciationEnabled ?? true)
const autoRead = ref(cachedSettings.autoRead ?? true)
const recordProgress = ref(cachedSettings.recordProgress ?? true)
const particlesEnabled = ref(cachedSettings.particlesEnabled ?? true)
const randomPractice = ref(cachedSettings.randomPractice ?? false)
const trackErrors = ref(cachedSettings.trackErrors ?? true)
const hideWord = ref(cachedSettings.hideWord ?? false)
const pronunciation = createPronunciationService({
  isOnlineEnabled: () => dictionaryPronunciationEnabled.value,
})
const practiceIndex = ref(0)
const wrongPracticeMode = ref(false)
const wrongPracticeIndex = ref(0)
const wrongPracticeCompleted = ref(false)
const answer = ref('')
const answerInput = ref(null)
const practiceKeyboardOpen = ref(false)
const letterShakeVersions = ref({})
const feedback = ref(null)
const submissionPending = ref(false)
const wrongWords = ref([])
const jumpNumber = ref(1)
const progressByCategory = ref(cachedState.progressByCategory ?? {})
const browseProgressByCategory = ref(cachedState.browseProgressByCategory ?? {})
const wrongWordsByCategory = ref(cachedState.wrongWordsByCategory ?? {})
const browseNavigationArmed = ref(false)
const mobileLibraryHeaderExpanded = ref(false)
const browseNavigationHint = ref('')
const isMobileCardMode = ref(false)
const mobileWordListOpen = ref(false)
const mobileDetailOpen = ref(false)
const mobileCardDragging = ref(false)
const mobileCardOffsetX = ref(0)
const mobileCardOffsetY = ref(0)
const mobileCardAxis = ref('')
const mobileCardPhase = ref('')
const mobileCardDirection = ref('')
const mobileSwipeHint = ref('左滑或上滑下一词 · 右滑或下滑上一词')
let cacheReady = false
let browseNavigationTimer
let browseNavigationCooldownUntil = 0
let lastBrowseWheelAt = 0
let detailTouchStartY = 0
let detailTouchStartedAtBottom = false
let mobileMediaQuery
let mobilePointerStartX = 0
let mobilePointerStartY = 0
let mobilePointerStartAt = 0
let mobileCardAnimationTimer
let mobileSwipeHintTimer
let practiceFocusScrollTimer
let practiceViewportBaselineHeight = 0
let practiceViewportContracted = false
let mobileCardCooldownUntil = 0
let selectedWordRequestId = 0
let globalSearchRequestId = 0
let categoryRequestId = 0
let answerAdvanceTimer

function cancelPendingAnswer() {
  // 切词、切换练习模式和离开页面时取消旧题的自动跳转。
  window.clearTimeout(answerAdvanceTimer)
  answerAdvanceTimer = undefined
  submissionPending.value = false
}

function invalidateSearchRequests() {
  // 只让最新搜索及其详情写回页面；动态 import 无法取消，用版本号隔离旧请求。
  globalSearchRequestId += 1
  selectedWordRequestId += 1
  globalSearchLoading.value = false
  selectedWordLoading.value = false
}

function saveCachedState() {
  if (!cacheReady) return

  writePracticeState({
    version: 2,
    activeCategoryId: activeCategory.value.id,
    progressByCategory: progressByCategory.value,
    browseProgressByCategory: browseProgressByCategory.value,
    wrongWordsByCategory: wrongWordsByCategory.value,
    settings: {
      accent: accent.value,
      dictionaryPronunciationEnabled: dictionaryPronunciationEnabled.value,
      autoRead: autoRead.value,
      recordProgress: recordProgress.value,
      particlesEnabled: particlesEnabled.value,
      randomPractice: randomPractice.value,
      trackErrors: trackErrors.value,
      hideWord: hideWord.value,
    },
    updatedAt: new Date().toISOString(),
  })
}

const filteredWords = computed(() => {
  if (globalSearchMode.value) return globalSearchResults.value

  const keyword = normalizeSearchKeyword(debouncedQuery.value)
  if (!keyword) return words.value

  return words.value.filter((item) => wordMatchesKeyword(item, keyword))
})

const selectedBrowseIndex = computed(() => filteredWords.value.indexOf(selectedWord.value))
const canBrowsePrevious = computed(() => selectedBrowseIndex.value > 0)
const canBrowseNext = computed(() =>
  filteredWords.value.length > 0
  && selectedBrowseIndex.value < filteredWords.value.length - 1,
)
const mobileCardStyle = computed(() => {
  if (!mobileCardDragging.value) return undefined
  const distance = Math.hypot(mobileCardOffsetX.value, mobileCardOffsetY.value)
  const scale = Math.max(0.965, 1 - distance / 2400)
  const rotation = mobileCardAxis.value === 'x' ? mobileCardOffsetX.value / 45 : 0

  return {
    transform: `translate3d(${mobileCardOffsetX.value}px, ${mobileCardOffsetY.value}px, 0) rotate(${rotation}deg) scale(${scale})`,
    opacity: Math.max(0.72, 1 - distance / 720),
    transition: 'none',
  }
})
const mobileCardAnimationClass = computed(() =>
  mobileCardPhase.value && mobileCardDirection.value
    ? `mobile-card-${mobileCardPhase.value}-${mobileCardDirection.value}`
    : '',
)
const practiceCollection = computed(() =>
  wrongPracticeMode.value ? wrongWords.value : words.value,
)
const currentPracticeIndex = computed(() =>
  wrongPracticeMode.value ? wrongPracticeIndex.value : practiceIndex.value,
)
const practiceTotal = computed(() => practiceCollection.value.length)
const practiceWord = computed(() =>
  practiceCollection.value[currentPracticeIndex.value] ?? null,
)
const practiceAnswerTarget = computed(() =>
  String(practiceWord.value?.term ?? '').replace(/[^a-z]/gi, '').toLowerCase(),
)
const answerSlots = computed(() =>
  [...practiceAnswerTarget.value].map((expected, index) => {
    const value = answer.value[index] ?? ''
    return {
      expected,
      value,
      correct: Boolean(value) && value.toLowerCase() === expected,
      wrong: Boolean(value) && value.toLowerCase() !== expected,
    }
  }),
)
const practiceWordCharacters = computed(() => {
  let answerIndex = 0
  return [...String(practiceWord.value?.term ?? '')].map((character, displayIndex) => {
    const isLetter = /[a-z]/i.test(character)
    if (!isLetter) {
      return {
        key: `${displayIndex}-${character}`,
        display: character === ' ' ? '\u00a0' : character,
        separator: true,
        correct: false,
      }
    }

    const inputIndex = answerIndex
    answerIndex += 1
    const typedCharacter = String(answer.value[inputIndex] ?? '').toLowerCase()
    const correct = Boolean(typedCharacter) && typedCharacter === character.toLowerCase()
    return {
      key: `${displayIndex}-${character}`,
      display: hideWord.value && !correct ? '•' : character,
      separator: false,
      correct,
    }
  })
})
const pendingLetterIndex = computed(() =>
  answer.value.length < practiceAnswerTarget.value.length ? answer.value.length : -1,
)

function restoreBrowseSelection(categoryId, entries = words.value) {
  const savedIndex = Number(browseProgressByCategory.value[categoryId])
  const restoredIndex = Number.isInteger(savedIndex)
    ? Math.min(Math.max(savedIndex, 0), Math.max(entries.length - 1, 0))
    : 0

  selectedWordRequestId += 1
  selectedWordLoading.value = false
  selectedWord.value = entries[restoredIndex] ?? null
  nextTick(scrollSelectedWordIntoView)
}

function selectNavigationGroup(group) {
  const currentOption = group.options.find((option) => option.id === activeCategory.value.id)
  selectCategory(currentOption ?? group.options[0])
}

function handleDatasetSelect(event) {
  const option = activeNavigationGroup.value.options.find((item) => item.id === event.target.value)
  if (option) selectCategory(option)
}

async function selectCategory(category) {
  if (loading.value && activeCategory.value.id === category.id) return
  invalidateSearchRequests()
  cancelPendingAnswer()
  if (activeCategory.value.id === category.id && words.value.length) {
    if (globalSearchMode.value) {
      globalSearchMode.value = false
      globalSearchResults.value = []
      globalSearchKeyword.value = ''
      globalSearchError.value = ''
      query.value = ''
      restoreBrowseSelection(category.id)
    }
    return
  }

  if (!loading.value && words.value.length) {
    wrongWordsByCategory.value[activeCategory.value.id] = wrongWords.value.map(wordKey)
  }

  wrongPracticeMode.value = false
  wrongPracticeIndex.value = 0
  wrongPracticeCompleted.value = false
  loading.value = true
  const requestId = ++categoryRequestId
  words.value = []
  selectedWord.value = null
  wrongWords.value = []
  loadError.value = ''
  globalSearchMode.value = false
  globalSearchResults.value = []
  globalSearchKeyword.value = ''
  globalSearchError.value = ''
  query.value = ''
  activeCategory.value = category

  try {
    const entries = await category.load()
    // 快速切换分类时，较慢的旧词库不能覆盖最后一次选择。
    if (requestId !== categoryRequestId) return
    words.value = entries
    restoreBrowseSelection(category.id, words.value)
    const legacyIndex = readLegacyPracticeIndex(category.id)
    const savedIndex = Number(progressByCategory.value[category.id] ?? legacyIndex)
    practiceIndex.value = recordProgress.value && Number.isInteger(savedIndex)
      ? Math.min(Math.max(savedIndex, 0), Math.max(words.value.length - 1, 0))
      : 0
    jumpNumber.value = practiceIndex.value + 1
    const savedWrongWords = new Set(wrongWordsByCategory.value[category.id] ?? [])
    wrongWords.value = words.value.filter((item) =>
      savedWrongWords.has(wordKey(item)) || savedWrongWords.has(item.term),
    )
    answer.value = ''
    feedback.value = null
    cacheReady = true
    saveCachedState()
  } catch (error) {
    if (requestId !== categoryRequestId) return
    words.value = []
    selectedWord.value = null
    loadError.value = '词库加载失败，请刷新页面重试。'
    console.error(error)
  } finally {
    if (requestId === categoryRequestId) {
      loading.value = false
      nextTick(scrollSelectedWordIntoView)
    }
  }
}

function handleSearchInput() {
  invalidateSearchRequests()
  globalSearchError.value = ''
  if (!globalSearchMode.value || query.value.trim() === globalSearchKeyword.value) return

  globalSearchMode.value = false
  globalSearchResults.value = []
  globalSearchKeyword.value = ''
  restoreBrowseSelection(activeCategory.value.id)
}

async function executeGlobalSearch() {
  const keyword = normalizeSearchKeyword(query.value)
  if (!keyword || globalSearchLoading.value || loading.value) return

  invalidateSearchRequests()
  const requestId = globalSearchRequestId
  const submittedQuery = query.value.trim()
  globalSearchLoading.value = true
  globalSearchError.value = ''
  resetBrowseNavigation()

  try {
    const searchIndex = await loadLibrarySearchIndex()
    if (requestId !== globalSearchRequestId) return
    const results = searchGlobalIndex(searchIndex, datasetDefinitions, keyword)

    globalSearchResults.value = results
    globalSearchKeyword.value = submittedQuery
    globalSearchMode.value = true
    selectedWord.value = null
    if (results[0]) selectWord(results[0])
  } catch (error) {
    if (requestId !== globalSearchRequestId) return
    globalSearchError.value = '全局搜索索引加载失败，请稍后重试。'
    console.error(error)
  } finally {
    if (requestId === globalSearchRequestId) globalSearchLoading.value = false
  }
}

async function selectPracticeCategory(category) {
  await selectCategory(category)
  if (autoRead.value) nextTick(speakPracticeWord)
}

async function selectPracticeNavigationGroup(groupId) {
  const group = navigationGroups.find((item) => item.id === groupId)
  if (!group) return

  const nextCategory = group.options.find((option) => option.type === activeCategory.value.type)
    ?? group.options[0]
  if (nextCategory) await selectPracticeCategory(nextCategory)
}

async function selectPracticeDataset(datasetId) {
  const category = categories.find((item) => item.id === datasetId)
  if (category) await selectPracticeCategory(category)
}

async function switchPracticeDataset(direction) {
  const targetIndex = activePracticeDatasetIndex.value + direction
  const category = categories[targetIndex]
  if (category) await selectPracticeCategory(category)
}

async function selectWord(word) {
  const requestId = ++selectedWordRequestId
  selectedWord.value = word
  selectedWordLoading.value = Number.isInteger(word?.__searchRowIndex)
  resetBrowseNavigation()
  nextTick(() => detailPanel.value?.scrollTo({ top: 0, behavior: 'smooth' }))

  if (!selectedWordLoading.value) return

  try {
    const entry = await loadLibraryDatasetEntry(word.__datasetId, word.__searchRowIndex)
    if (requestId !== selectedWordRequestId) return
    if (!entry) throw new Error(`Missing search result row: ${word.__datasetId}/${word.__searchRowIndex}`)

    const resultIndex = globalSearchResults.value.indexOf(word)
    if (resultIndex >= 0) {
      const updatedResults = [...globalSearchResults.value]
      updatedResults[resultIndex] = entry
      globalSearchResults.value = updatedResults
    }
    if (requestId === selectedWordRequestId) selectedWord.value = entry
  } catch (error) {
    if (requestId === selectedWordRequestId) {
      selectedWord.value = {
        ...word,
        definition: '词条详情加载失败，请点击后重试。',
      }
    }
    console.error(error)
  } finally {
    if (requestId === selectedWordRequestId) selectedWordLoading.value = false
  }
}

function isDetailAtBottom() {
  const panel = detailPanel.value
  if (!panel) return false
  return panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 4
}

function resetBrowseNavigation() {
  window.clearTimeout(browseNavigationTimer)
  browseNavigationArmed.value = false
  browseNavigationHint.value = ''
}

function scrollSelectedWordIntoView() {
  nextTick(() => {
    const index = selectedBrowseIndex.value
    desktopWordList.value?.scrollToIndex(index)
    mobileWordList.value?.scrollToIndex(index)
  })
}

function browseAdjacentWord(direction) {
  const list = filteredWords.value
  if (!list.length) return

  const currentIndex = selectedBrowseIndex.value
  const targetIndex = currentIndex < 0
    ? 0
    : Math.min(Math.max(currentIndex + direction, 0), list.length - 1)

  if (targetIndex === currentIndex) {
    browseNavigationHint.value = direction > 0 ? '已经是最后一个词条' : '已经是第一个词条'
    return
  }

  selectWord(list[targetIndex])
  browseNavigationCooldownUntil = Date.now() + 600
  resetBrowseNavigation()
  nextTick(() => {
    detailPanel.value?.scrollTo({ top: 0, behavior: 'smooth' })
    scrollSelectedWordIntoView()
  })
}

function requestNextWordByGesture(type) {
  if (Date.now() < browseNavigationCooldownUntil) return

  if (!canBrowseNext.value) {
    browseNavigationHint.value = '已经是最后一个词条'
    return
  }

  if (browseNavigationArmed.value) {
    browseAdjacentWord(1)
    return
  }

  browseNavigationArmed.value = true
  browseNavigationHint.value = type === 'touch'
    ? '再上滑一次，切换到下一个词条'
    : '再向下滚动一次，切换到下一个词条'
  window.clearTimeout(browseNavigationTimer)
  browseNavigationTimer = window.setTimeout(resetBrowseNavigation, 1200)
}

function handleDetailWheel(event) {
  if (event.deltaY <= 12 || !isDetailAtBottom()) return

  const now = Date.now()
  const beginsNewWheelGesture = now - lastBrowseWheelAt > 160
  lastBrowseWheelAt = now
  if (beginsNewWheelGesture) requestNextWordByGesture('wheel')
}

function handleDetailTouchStart(event) {
  detailTouchStartY = event.touches[0]?.clientY ?? 0
  detailTouchStartedAtBottom = isDetailAtBottom()
}

function handleDetailTouchEnd(event) {
  if (!detailTouchStartedAtBottom) return
  const endY = event.changedTouches[0]?.clientY ?? detailTouchStartY
  if (detailTouchStartY - endY >= 55) requestNextWordByGesture('touch')
}

function updateMobileCardMode(event) {
  isMobileCardMode.value = event.matches
  if (!event.matches) {
    mobileWordListOpen.value = false
    mobileDetailOpen.value = false
    resetMobileCardPosition()
  }
}

function showMobileSwipeHint(message) {
  mobileSwipeHint.value = message
  window.clearTimeout(mobileSwipeHintTimer)
  mobileSwipeHintTimer = window.setTimeout(() => {
    mobileSwipeHint.value = '左滑或上滑下一词 · 右滑或下滑上一词'
  }, 1500)
}

function resetMobileCardPosition() {
  mobileCardDragging.value = false
  mobileCardOffsetX.value = 0
  mobileCardOffsetY.value = 0
  mobileCardAxis.value = ''
}

function animateMobileWordChange(direction, gestureDirection) {
  if (Date.now() < mobileCardCooldownUntil || mobileCardPhase.value) return

  if (direction > 0 && !canBrowseNext.value) {
    showMobileSwipeHint('已经是最后一个词条')
    resetMobileCardPosition()
    return
  }
  if (direction < 0 && !canBrowsePrevious.value) {
    showMobileSwipeHint('已经是第一个词条')
    resetMobileCardPosition()
    return
  }

  resetMobileCardPosition()
  mobileCardCooldownUntil = Date.now() + 450
  mobileCardDirection.value = gestureDirection
  mobileCardPhase.value = 'leaving'
  window.clearTimeout(mobileCardAnimationTimer)
  mobileCardAnimationTimer = window.setTimeout(() => {
    browseAdjacentWord(direction)
    mobileCardPhase.value = 'entering'
    mobileCardAnimationTimer = window.setTimeout(() => {
      mobileCardPhase.value = ''
      mobileCardDirection.value = ''
    }, 260)
  }, 180)
}

function handleMobileCardPointerDown(event) {
  if (
    !isMobileCardMode.value
    || mobileDetailOpen.value
    || mobileWordListOpen.value
    || mobileCardPhase.value
    || event.target.closest('button, input, a, label')
  ) return

  mobilePointerStartX = event.clientX
  mobilePointerStartY = event.clientY
  mobilePointerStartAt = performance.now()
  mobileCardDragging.value = true
  mobileCardAxis.value = ''
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function handleMobileCardPointerMove(event) {
  if (!mobileCardDragging.value) return

  const deltaX = event.clientX - mobilePointerStartX
  const deltaY = event.clientY - mobilePointerStartY
  if (!mobileCardAxis.value && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
    mobileCardAxis.value = Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y'
  }

  if (mobileCardAxis.value === 'x') {
    mobileCardOffsetX.value = deltaX
    mobileCardOffsetY.value = 0
  } else if (mobileCardAxis.value === 'y') {
    mobileCardOffsetX.value = 0
    mobileCardOffsetY.value = deltaY
  }
}

function handleMobileCardPointerUp(event) {
  if (!mobileCardDragging.value) return

  const deltaX = event.clientX - mobilePointerStartX
  const deltaY = event.clientY - mobilePointerStartY
  const axis = mobileCardAxis.value || (Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y')
  const distance = axis === 'x' ? deltaX : deltaY
  const duration = Math.max(performance.now() - mobilePointerStartAt, 1)
  const velocity = Math.abs(distance) / duration
  const shouldSwitch = Math.abs(distance) >= 64 || (Math.abs(distance) >= 24 && velocity >= 0.35)

  if (!shouldSwitch) {
    resetMobileCardPosition()
    return
  }

  const direction = distance < 0 ? 1 : -1
  const gestureDirection = axis === 'x'
    ? (distance < 0 ? 'left' : 'right')
    : (distance < 0 ? 'up' : 'down')
  animateMobileWordChange(direction, gestureDirection)
}

function selectMobileWord(word) {
  selectWord(word)
  mobileWordListOpen.value = false
}

function speakDictionaryWord(text, lang) {
  pronunciation.speak(text, lang)
}

function speakWord(lang) {
  speakDictionaryWord(selectedWord.value?.term, lang)
}

function speakPracticeWord() {
  speakDictionaryWord(practiceWord.value?.term, accent.value)
}

function speakExampleSentence(sentence, lang = 'en-GB') {
  speakDictionaryWord(sentence, lang)
}

function openPractice() {
  if (loading.value || !words.value.length) return
  cancelPendingAnswer()
  wrongPracticeMode.value = false
  wrongPracticeCompleted.value = false

  if (recordProgress.value && !randomPractice.value) {
    const savedIndex = Number(progressByCategory.value[activeCategory.value.id])
    if (Number.isInteger(savedIndex)) {
      practiceIndex.value = Math.min(
        Math.max(savedIndex, 0),
        Math.max(words.value.length - 1, 0),
      )
    }
  } else if (!recordProgress.value) {
    const selectedIndex = words.value.indexOf(selectedWord.value)
    if (selectedIndex >= 0) practiceIndex.value = selectedIndex
  }

  jumpNumber.value = practiceIndex.value + 1
  answer.value = ''
  feedback.value = null
  viewMode.value = 'practice'
  nextTick(() => {
    answerInput.value?.focus()
    if (autoRead.value) speakPracticeWord()
  })
}

function nextPracticeWord() {
  cancelPendingAnswer()
  if (loading.value) return
  const collection = practiceCollection.value
  if (!collection.length) return

  let nextIndex
  if (randomPractice.value && collection.length > 1) {
    nextIndex = currentPracticeIndex.value
    while (nextIndex === currentPracticeIndex.value) {
      nextIndex = Math.floor(Math.random() * collection.length)
    }
  } else {
    nextIndex = (currentPracticeIndex.value + 1) % collection.length
  }

  if (wrongPracticeMode.value) {
    wrongPracticeIndex.value = nextIndex
  } else {
    practiceIndex.value = nextIndex
  }

  jumpNumber.value = nextIndex + 1
  answer.value = ''
  letterShakeVersions.value = {}
  feedback.value = null
  nextTick(() => answerInput.value?.focus())
}

function startWrongPractice() {
  cancelPendingAnswer()
  if (loading.value) return
  if (wrongPracticeMode.value) {
    wrongPracticeMode.value = false
    wrongPracticeCompleted.value = false
    answer.value = ''
    letterShakeVersions.value = {}
    feedback.value = null
    jumpNumber.value = practiceIndex.value + 1
    nextTick(() => {
      answerInput.value?.focus()
      if (autoRead.value) speakPracticeWord()
    })
    return
  }

  if (!wrongWords.value.length) {
    feedback.value = { type: 'hint', text: '当前词库还没有错题记录' }
    return
  }

  wrongPracticeMode.value = true
  wrongPracticeCompleted.value = false
  wrongPracticeIndex.value = 0
  answer.value = ''
  letterShakeVersions.value = {}
  feedback.value = null
  nextTick(() => {
    answerInput.value?.focus()
    if (autoRead.value) speakPracticeWord()
  })
}

function completeWrongWord(completedWord) {
  // 使用提交时绑定的词条，不能在延迟回调中重新读取另一道题。
  const removalIndex = wrongWords.value.findIndex((item) => wordKey(item) === wordKey(completedWord))
  if (removalIndex < 0) return
  wrongWords.value.splice(removalIndex, 1)

  answer.value = ''
  letterShakeVersions.value = {}

  if (!wrongWords.value.length) {
    wrongPracticeMode.value = false
    wrongPracticeCompleted.value = true
    wrongPracticeIndex.value = 0
    feedback.value = null
    return
  }

  wrongPracticeIndex.value = Math.min(removalIndex, wrongWords.value.length - 1)
  feedback.value = null
  nextTick(() => {
    answerInput.value?.focus()
    if (autoRead.value) speakPracticeWord()
  })
}

function returnToNormalPractice() {
  cancelPendingAnswer()
  wrongPracticeCompleted.value = false
  answer.value = ''
  letterShakeVersions.value = {}
  feedback.value = null
  jumpNumber.value = practiceIndex.value + 1
  nextTick(() => {
    answerInput.value?.focus()
    if (autoRead.value) speakPracticeWord()
  })
}

function focusAnswerInput() {
  answerInput.value?.focus()
}

function scrollPracticeInputIntoView(delay = 0) {
  window.clearTimeout(practiceFocusScrollTimer)
  practiceFocusScrollTimer = window.setTimeout(() => {
    if (!practiceKeyboardOpen.value) return
    answerInput.value?.closest('.answer-form')?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }, delay)
}

function syncPracticeViewportHeight() {
  const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight)
  if (!practiceKeyboardOpen.value) {
    practiceViewportBaselineHeight = viewportHeight
    practiceViewportContracted = false
  } else {
    practiceViewportBaselineHeight = Math.max(practiceViewportBaselineHeight, viewportHeight)
    if (viewportHeight < practiceViewportBaselineHeight * 0.9) {
      practiceViewportContracted = true
    } else if (practiceViewportContracted) {
      practiceKeyboardOpen.value = false
      practiceViewportContracted = false
    }
  }
  document.documentElement.style.setProperty('--practice-viewport-height', `${viewportHeight}px`)
  if (practiceKeyboardOpen.value) scrollPracticeInputIntoView(80)
}

function handlePracticeInputFocus() {
  syncPracticeViewportHeight()
  practiceKeyboardOpen.value = true
  scrollPracticeInputIntoView(180)
}

function handlePracticeInputBlur() {
  practiceKeyboardOpen.value = false
  practiceViewportContracted = false
  window.clearTimeout(practiceFocusScrollTimer)
}

function triggerLetterShake(index) {
  letterShakeVersions.value = {
    ...letterShakeVersions.value,
    [index]: (letterShakeVersions.value[index] ?? 0) + 1,
  }
}

function handleAnswerInput(event) {
  if (submissionPending.value) {
    event.target.value = answer.value
    return
  }
  const cleanedValue = event.target.value
    .replace(/[^a-z]/gi, '')
    .slice(0, practiceAnswerTarget.value.length)
    .toLowerCase()

  event.target.value = cleanedValue
  answer.value = cleanedValue

  const currentIndex = cleanedValue.length - 1

  if (
    currentIndex >= 0
    && !event.inputType?.startsWith('delete')
    && cleanedValue[currentIndex] !== practiceAnswerTarget.value[currentIndex]
  ) {
    triggerLetterShake(currentIndex)
  }
}

function submitAnswer() {
  if (submissionPending.value || loading.value || !practiceWord.value || viewMode.value !== 'practice') return
  const expected = practiceAnswerTarget.value
  const actual = answer.value.trim().toLowerCase()
  if (!actual) {
    feedback.value = { type: 'hint', text: '请输入词条后再提交' }
    return
  }

  if (actual === expected) {
    feedback.value = {
      type: 'success',
      text: wrongPracticeMode.value ? '回答正确，已移出错题记录！' : '回答正确，很棒！',
    }
    // 同一题只创建一个计时器，并绑定词库、题目位置和练习模式。
    const submittedWord = practiceWord.value
    const submittedCategoryId = activeCategory.value.id
    const submittedIndex = currentPracticeIndex.value
    const submittedWrongMode = wrongPracticeMode.value
    submissionPending.value = true
    answerAdvanceTimer = window.setTimeout(() => {
      cancelPendingAnswer()
      if (viewMode.value !== 'practice' || loading.value
        || activeCategory.value.id !== submittedCategoryId
        || practiceWord.value !== submittedWord
        || currentPracticeIndex.value !== submittedIndex
        || wrongPracticeMode.value !== submittedWrongMode) return
      if (submittedWrongMode) completeWrongWord(submittedWord)
      else nextPracticeWord()
    }, 650)
    return
  }

  answerSlots.value.forEach((slot, index) => {
    if (slot.wrong) triggerLetterShake(index)
  })
  feedback.value = { type: 'error', text: `再想一想，正确答案是 ${practiceWord.value.term}` }
  if (trackErrors.value && !wrongWords.value.some((item) => wordKey(item) === wordKey(practiceWord.value))) {
    wrongWords.value.push(practiceWord.value)
  }
}

function resetPractice() {
  cancelPendingAnswer()
  if (loading.value) return
  if (wrongPracticeMode.value) {
    wrongPracticeIndex.value = 0
  } else {
    practiceIndex.value = 0
  }
  jumpNumber.value = 1
  answer.value = ''
  letterShakeVersions.value = {}
  feedback.value = null
  wrongPracticeCompleted.value = false
  if (autoRead.value) nextTick(speakPracticeWord)
}

function jumpToWord() {
  cancelPendingAnswer()
  if (loading.value) return
  const target = Math.min(Math.max(Number(jumpNumber.value) || 1, 1), words.value.length)
  practiceIndex.value = target - 1
  jumpNumber.value = target
  answer.value = ''
  letterShakeVersions.value = {}
  feedback.value = null
  nextTick(() => answerInput.value?.focus())
}

function handleGlobalKeydown(event) {
  if (viewMode.value !== 'practice') return
  if (event.target.closest?.('.jump-control')) return

  if (event.key === 'Escape') {
    speakPracticeWord()
    return
  }

  if (event.key === '2') {
    event.preventDefault()
    hideWord.value = !hideWord.value
  }
}

watch(practiceIndex, (index) => {
  if (loading.value) return
  if (recordProgress.value && !randomPractice.value) {
    progressByCategory.value[activeCategory.value.id] = index
    saveCachedState()
  }
  if (viewMode.value === 'practice' && autoRead.value) nextTick(speakPracticeWord)
})

watch(selectedWord, (word) => {
  if (word && viewMode.value === 'library') {
    if (!globalSearchMode.value) {
      const browseIndex = words.value.indexOf(word)
      if (browseIndex >= 0) {
        browseProgressByCategory.value[activeCategory.value.id] = browseIndex
        saveCachedState()
      }
    }
    if (!Number.isInteger(word.__searchRowIndex)) {
      nextTick(() => speakDictionaryWord(word.term, 'en-GB'))
    }
  }
})

watch(wrongPracticeIndex, () => {
  if (viewMode.value === 'practice' && wrongPracticeMode.value && autoRead.value) {
    nextTick(speakPracticeWord)
  }
})

watch(recordProgress, (enabled) => {
  if (enabled && !randomPractice.value) {
    progressByCategory.value[activeCategory.value.id] = practiceIndex.value
  }
  saveCachedState()
})

watch(randomPractice, (enabled) => {
  if (!enabled && recordProgress.value) {
    progressByCategory.value[activeCategory.value.id] = practiceIndex.value
  }
  saveCachedState()
})

watch(
  [accent, dictionaryPronunciationEnabled, autoRead, particlesEnabled, trackErrors, hideWord],
  saveCachedState,
)

watch(dictionaryPronunciationEnabled, (enabled) => {
  if (!enabled) pronunciation.stop()
})

// 同步失效，防止同一轮事件中旧请求恰好完成并覆盖刚输入的内容。
watch(query, handleSearchInput, { flush: 'sync' })
watch([practiceWord, wrongPracticeMode, viewMode, activeCategory], cancelPendingAnswer, { flush: 'sync' })
watch(viewMode, invalidateSearchRequests, { flush: 'sync' })

watch(wrongWords, (items) => {
  if (!cacheReady || loading.value) return
  wrongWordsByCategory.value[activeCategory.value.id] = items.map(wordKey)
  saveCachedState()
}, { deep: true })

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  pronunciation.refreshVoices()
  window.speechSynthesis?.addEventListener?.('voiceschanged', pronunciation.refreshVoices)
  mobileMediaQuery = window.matchMedia('(max-width: 720px)')
  updateMobileCardMode(mobileMediaQuery)
  mobileMediaQuery.addEventListener?.('change', updateMobileCardMode)
  syncPracticeViewportHeight()
  window.visualViewport?.addEventListener('resize', syncPracticeViewportHeight)
})
onBeforeUnmount(() => {
  cancelPendingAnswer()
  invalidateSearchRequests()
  categoryRequestId += 1
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.speechSynthesis?.removeEventListener?.('voiceschanged', pronunciation.refreshVoices)
  pronunciation.stop()
  window.speechSynthesis?.cancel()
  mobileMediaQuery?.removeEventListener?.('change', updateMobileCardMode)
  window.visualViewport?.removeEventListener('resize', syncPracticeViewportHeight)
  document.documentElement.style.removeProperty('--practice-viewport-height')
  window.clearTimeout(browseNavigationTimer)
  window.clearTimeout(mobileCardAnimationTimer)
  window.clearTimeout(mobileSwipeHintTimer)
  window.clearTimeout(practiceFocusScrollTimer)
})

selectCategory(initialCategory)
</script>

<template>
  <main :class="['page-shell', { 'practice-shell': viewMode === 'practice' }]">
    <nav v-if="viewMode === 'library'" class="nav">
      <a class="brand" href="#" aria-label="Study English 首页">
        <span class="brand-mark">S</span>
        <span>
          <b>Study English</b>
          <small>Word Library</small>
        </span>
      </a>

      <div class="nav-tabs" aria-label="词库分类">
        <button
          v-for="group in navigationGroups"
          :key="group.id"
          :class="{ active: activeNavigationGroup.id === group.id }"
          :aria-label="group.label"
          :aria-pressed="activeNavigationGroup.id === group.id"
          @click="selectNavigationGroup(group)"
        >
          <span class="nav-label-desktop">{{ group.label }}</span>
          <span class="nav-label-mobile" aria-hidden="true">
            {{ group.id === 'new-concept-english' ? '新概念' : group.label }}
          </span>
        </button>
      </div>

      <label class="dataset-picker">
        <span>{{ activeNavigationGroup.label }}词库</span>
        <select :value="activeCategory.id" @change="handleDatasetSelect">
          <option
            v-for="option in activeNavigationGroup.options"
            :key="option.id"
            :value="option.id"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <label
        class="dictionary-audio-toggle"
        :title="dictionaryPronunciationEnabled ? '在线接口 → 项目音频 → 设备发音' : '项目音频 → 设备发音（不调用在线接口）'"
      >
        <span>接口发音</span>
        <input
          v-model="dictionaryPronunciationEnabled"
          type="checkbox"
          role="switch"
          :aria-label="dictionaryPronunciationEnabled ? '关闭在线接口，保留项目音频和设备发音' : '开启在线接口优先发音'"
        />
        <span class="dictionary-audio-track" aria-hidden="true">
          <span></span>
        </span>
      </label>

      <button class="practice-entry" @click="openPractice">
        开始练习
        <span aria-hidden="true">→</span>
      </button>
      <span class="word-total">{{ words.length.toLocaleString() }} words</span>
    </nav>

    <header
      v-if="viewMode === 'library'"
      :class="['library-header', { 'mobile-collapsed': !mobileLibraryHeaderExpanded }]"
    >
      <div id="mobile-library-header-content" class="library-header-content">
        <div class="library-heading">
          <p class="eyebrow">VOCABULARY LIBRARY</p>
          <h1>{{ activeCategory.label }}</h1>
          <p>{{ activeCategory.description }}，选择左侧词条查看释义、英式音标和美式音标。</p>
        </div>
        <div class="search-controls">
          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              v-model="query"
              type="search"
              placeholder="当前词库可搜释义；全库快速搜词条或来源"
              @keydown.enter.prevent="executeGlobalSearch"
            />
          </label>
          <button
            class="global-search-button"
            :disabled="!query.trim() || globalSearchLoading || loading"
            @click="executeGlobalSearch"
          >
            {{ globalSearchLoading ? '搜索中…' : '全库搜词' }}
          </button>
        </div>
      </div>
    </header>

    <section
      v-if="viewMode === 'library'"
      class="workspace"
      :aria-busy="loading || globalSearchLoading"
    >
      <aside class="word-panel desktop-word-panel">
        <div class="panel-heading">
          <span>{{ globalSearchMode ? `全局搜索：${globalSearchKeyword}` : '词条列表' }}</span>
          <span>{{ filteredWords.length }} 个结果</span>
        </div>

        <div v-if="loading || globalSearchLoading" class="panel-state">
          {{ globalSearchLoading ? '正在加载轻量搜索索引…' : '正在载入词库…' }}
        </div>
        <div v-else-if="globalSearchError" class="panel-state error">{{ globalSearchError }}</div>
        <div v-else-if="loadError" class="panel-state error">{{ loadError }}</div>
        <div v-else-if="!filteredWords.length" class="panel-state">没有找到匹配的词条</div>

        <VirtualWordList
          v-else
          ref="desktopWordList"
          :words="filteredWords"
          :selected-word="selectedWord"
          @select="selectWord"
        />
      </aside>

      <article
        v-if="selectedWord"
        ref="detailPanel"
        class="detail-panel desktop-detail-panel"
        @wheel.passive="handleDetailWheel"
        @touchstart.passive="handleDetailTouchStart"
        @touchend.passive="handleDetailTouchEnd"
      >
        <div class="detail-hero">
          <div>
            <p class="detail-kicker">
              WORD DETAIL
              <template v-if="selectedWord.__datasetLabel"> · {{ selectedWord.__datasetLabel }}</template>
            </p>
            <h2>{{ selectedWord.term }}</h2>
            <p v-if="selectedWord.britishPronunciation" class="phonetic">英 {{ selectedWord.britishPronunciation }}</p>
            <p v-if="selectedWord.americanPronunciation" class="phonetic">美 {{ selectedWord.americanPronunciation }}</p>
          </div>
          <div class="sound-actions" aria-label="词条发音">
            <button
              class="sound-button"
              aria-label="英式发音"
              title="英式发音"
              @click="speakWord('en-GB')"
            >
              <span aria-hidden="true">♪</span>
              <b>英式</b>
            </button>
            <button
              class="sound-button accent-us"
              aria-label="美式发音"
              title="美式发音"
              @click="speakWord('en-US')"
            >
              <span aria-hidden="true">♪</span>
              <b>美式</b>
            </button>
          </div>
        </div>

        <div class="meaning-card">
          <span>释义</span>
          <p>{{ selectedWordLoading ? '正在载入词条详情…' : (selectedWord.definition || '暂无释义') }}</p>
        </div>

        <div class="detail-grid">
          <section v-if="selectedWord.britishPronunciation">
            <span class="detail-label">英式音标</span>
            <p class="split-word">{{ selectedWord.britishPronunciation }}</p>
          </section>
          <section v-if="selectedWord.americanPronunciation">
            <span class="detail-label">美式音标</span>
            <p class="split-word">{{ selectedWord.americanPronunciation }}</p>
          </section>
          <section class="wide">
            <span class="detail-label">数据来源</span>
            <p>{{ selectedWord.__datasetLabel }} · {{ typeLabel(selectedWord) }}</p>
          </section>
        </div>

        <section v-if="selectedWord.exampleSentence" class="example-card word-example-card">
          <div class="example-card-heading">
            <span class="detail-label">EXAMPLE · 例句</span>
            <button
              type="button"
              aria-label="播放英文例句"
              title="播放英文例句"
              @click="speakExampleSentence(selectedWord.exampleSentence, 'en-GB')"
            >
              <span aria-hidden="true">♪</span>
              播放例句
            </button>
          </div>
          <blockquote>{{ selectedWord.exampleSentence }}</blockquote>
          <p>{{ selectedWord.exampleTranslation }}</p>
        </section>

        <div class="browse-word-navigation">
          <p :class="{ visible: browseNavigationHint }" aria-live="polite">
            {{ browseNavigationHint || '滚动到底部可快速切换词条' }}
          </p>
          <div>
            <button :disabled="!canBrowsePrevious" @click="browseAdjacentWord(-1)">
              <span aria-hidden="true">←</span>
              上一个词条
            </button>
            <span>{{ selectedBrowseIndex + 1 }} / {{ filteredWords.length }}</span>
            <button :disabled="!canBrowseNext" @click="browseAdjacentWord(1)">
              下一个词条
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </article>

      <article v-else class="detail-panel desktop-detail-panel empty-detail">
        <p>从左侧选择一个词条查看详情</p>
      </article>

      <div class="mobile-card-stage">
        <div v-if="loading || globalSearchLoading" class="mobile-card-state">
          {{ globalSearchLoading ? '正在加载轻量搜索索引…' : '正在载入词库…' }}
        </div>
        <div v-else-if="globalSearchError || loadError" class="mobile-card-state error">
          {{ globalSearchError || loadError }}
        </div>
        <div v-else-if="!selectedWord" class="mobile-card-state">没有找到匹配的词条</div>

        <template v-else>
          <div class="mobile-card-tools">
            <button @click="mobileWordListOpen = true">
              <span aria-hidden="true">☰</span>
              词表
            </button>
            <span>{{ selectedBrowseIndex + 1 }} / {{ filteredWords.length }}</span>
            <button
              type="button"
              :class="{ active: mobileLibraryHeaderExpanded }"
              :aria-expanded="mobileLibraryHeaderExpanded"
              aria-controls="mobile-library-header-content"
              @click="mobileLibraryHeaderExpanded = !mobileLibraryHeaderExpanded"
            >
              <span aria-hidden="true">⌕</span>
              {{ mobileLibraryHeaderExpanded ? '收起' : '搜索' }}
            </button>
            <button @click="mobileDetailOpen = true">
              详情
              <span aria-hidden="true">↑</span>
            </button>
          </div>

          <article
            :class="['mobile-word-card', mobileCardAnimationClass]"
            :style="mobileCardStyle"
            @pointerdown="handleMobileCardPointerDown"
            @pointermove="handleMobileCardPointerMove"
            @pointerup="handleMobileCardPointerUp"
            @pointercancel="resetMobileCardPosition"
          >
            <div class="mobile-card-meta">
              <span>{{ selectedWord.__datasetLabel || activeCategory.label }}</span>
              <span>WORD CARD</span>
            </div>

            <div class="mobile-card-word">
              <h2>{{ selectedWord.term }}</h2>
              <p v-if="selectedWord.britishPronunciation">英 {{ selectedWord.britishPronunciation }}</p>
              <p v-if="selectedWord.americanPronunciation">美 {{ selectedWord.americanPronunciation }}</p>
            </div>

            <div class="mobile-card-sounds" aria-label="词条发音">
              <button aria-label="播放英式发音" @click="speakWord('en-GB')">♪ 英式</button>
              <button aria-label="播放美式发音" @click="speakWord('en-US')">♪ 美式</button>
            </div>

            <section class="mobile-card-meaning">
              <span>释义</span>
              <p>{{ selectedWordLoading ? '正在载入词条详情…' : (selectedWord.definition || '暂无释义') }}</p>
            </section>
            <section v-if="selectedWord.exampleSentence" class="mobile-card-example">
              <div>
                <span>例句</span>
                <button
                  type="button"
                  aria-label="播放英文例句"
                  title="播放英文例句"
                  @click.stop="speakExampleSentence(selectedWord.exampleSentence, 'en-GB')"
                >
                  <span aria-hidden="true">♪</span>
                </button>
              </div>
              <blockquote>{{ selectedWord.exampleSentence }}</blockquote>
              <p>{{ selectedWord.exampleTranslation }}</p>
            </section>
          </article>

          <p class="mobile-swipe-hint" aria-live="polite">{{ mobileSwipeHint }}</p>

          <div class="mobile-card-navigation">
            <button
              :disabled="!canBrowsePrevious"
              @click="animateMobileWordChange(-1, 'right')"
            >
              ← 上一个词条
            </button>
            <button
              :disabled="!canBrowseNext"
              @click="animateMobileWordChange(1, 'left')"
            >
              下一个词条 →
            </button>
          </div>
        </template>
      </div>

      <div
        v-if="mobileWordListOpen"
        class="mobile-drawer-layer"
        role="presentation"
        @click.self="mobileWordListOpen = false"
      >
        <section class="mobile-drawer mobile-list-drawer" role="dialog" aria-modal="true" aria-label="词条列表">
          <div class="mobile-drawer-handle"></div>
          <header>
            <div>
              <strong>{{ globalSearchMode ? `全局搜索：${globalSearchKeyword}` : activeCategory.label }}</strong>
              <span>{{ filteredWords.length }} 个结果</span>
            </div>
            <button aria-label="关闭词条列表" @click="mobileWordListOpen = false">×</button>
          </header>
          <VirtualWordList
            ref="mobileWordList"
            class="mobile-word-list"
            :words="filteredWords"
            :selected-word="selectedWord"
            @select="selectMobileWord"
          />
        </section>
      </div>

      <div
        v-if="mobileDetailOpen && selectedWord"
        class="mobile-drawer-layer"
        role="presentation"
        @click.self="mobileDetailOpen = false"
      >
        <section class="mobile-drawer mobile-detail-drawer" role="dialog" aria-modal="true" aria-label="词条详情">
          <div class="mobile-drawer-handle"></div>
          <header>
            <div>
              <strong>{{ selectedWord.term }}</strong>
              <span>{{ selectedWord.__datasetLabel }}</span>
            </div>
            <button aria-label="关闭词条详情" @click="mobileDetailOpen = false">×</button>
          </header>
          <div class="mobile-detail-content">
            <section v-if="selectedWord.britishPronunciation">
              <span>英式音标</span>
              <p class="split-word">{{ selectedWord.britishPronunciation }}</p>
            </section>
            <section v-if="selectedWord.americanPronunciation">
              <span>美式音标</span>
              <p class="split-word">{{ selectedWord.americanPronunciation }}</p>
            </section>
            <section>
              <span>释义</span>
              <p>{{ selectedWordLoading ? '正在载入词条详情…' : (selectedWord.definition || '暂无释义') }}</p>
            </section>
            <section>
              <span>数据来源</span>
              <p>{{ selectedWord.__datasetLabel }} · {{ typeLabel(selectedWord) }}</p>
            </section>
            <section v-if="selectedWord.exampleSentence">
              <div class="mobile-detail-example-heading">
                <span>例句</span>
                <button
                  type="button"
                  aria-label="播放英文例句"
                  @click="speakExampleSentence(selectedWord.exampleSentence, 'en-GB')"
                >
                  ♪ 播放
                </button>
              </div>
              <blockquote>{{ selectedWord.exampleSentence }}</blockquote>
              <p>{{ selectedWord.exampleTranslation }}</p>
            </section>
          </div>
        </section>
      </div>
    </section>

    <section
      v-else
      :class="['practice-view', { 'practice-keyboard-open': practiceKeyboardOpen }]"
    >
      <ParticleBackground :enabled="particlesEnabled" />

      <header class="practice-toolbar">
        <button class="back-library" @click="viewMode = 'library'">
          <span aria-hidden="true">←</span>
          返回词库
        </button>

        <div class="accent-switch" aria-label="发音类型">
          <button :class="{ active: accent === 'en-US' }" @click="accent = 'en-US'">美式</button>
          <button :class="{ active: accent === 'en-GB' }" @click="accent = 'en-GB'">英式</button>
        </div>

        <button class="practice-reset" @click="resetPractice">重新练习</button>
        <strong class="practice-count">
          <template v-if="wrongPracticeCompleted">错题已清空</template>
          <template v-else>{{ currentPracticeIndex + 1 }} / {{ practiceTotal }}</template>
        </strong>

        <div class="practice-options">
          <label>
            <span>自动朗读</span>
            <input v-model="autoRead" type="checkbox" role="switch" />
          </label>
          <label>
            <span>记录进度</span>
            <input v-model="recordProgress" type="checkbox" role="switch" />
          </label>
          <label>
            <span>粒子背景</span>
            <input v-model="particlesEnabled" type="checkbox" role="switch" />
          </label>
          <label>
            <span>随机练习</span>
            <input v-model="randomPractice" type="checkbox" role="switch" />
          </label>
          <label>
            <span>错题统计</span>
            <input v-model="trackErrors" type="checkbox" role="switch" />
          </label>
        </div>
      </header>

      <div v-if="loading" class="panel-state">正在载入词库…</div>
      <div v-else-if="loadError" class="panel-state error">{{ loadError }}</div>
      <div v-else-if="wrongPracticeCompleted" class="wrong-practice-complete">
        <span aria-hidden="true">✓</span>
        <p>WRONG WORDS CLEARED</p>
        <h2>错题练习完成</h2>
        <p>当前词库的错题已经全部答对，并从本地错题记录中移除。</p>
        <button @click="returnToNormalPractice">继续普通练习</button>
      </div>

      <div v-else-if="practiceWord" class="practice-card">
        <div class="practice-compact-meta" aria-hidden="true">
          <span>{{ activeCategory.label }}</span>
          <span>{{ currentPracticeIndex + 1 }} / {{ practiceTotal }}</span>
        </div>
        <span v-if="wrongPracticeMode" class="wrong-practice-badge">
          错题练习 · 剩余 {{ wrongWords.length }} 词
        </span>
        <div class="practice-title">
          <h2 :class="{ concealed: hideWord }" :aria-label="practiceWord.term">
            <span
              v-for="character in practiceWordCharacters"
              :key="character.key"
              aria-hidden="true"
              :class="[
                'practice-word-letter',
                { correct: character.correct, separator: character.separator },
              ]"
            >{{ character.display }}</span>
          </h2>
          <span v-if="pronunciationFor(practiceWord, accent)">{{ pronunciationFor(practiceWord, accent) }}</span>
        </div>
        <p class="practice-meaning">{{ practiceWord.definition }}</p>

        <dl class="practice-details">
          <div v-if="practiceWord.britishPronunciation"><dt>英式音标</dt><dd>{{ practiceWord.britishPronunciation }}</dd></div>
          <div v-if="practiceWord.americanPronunciation"><dt>美式音标</dt><dd>{{ practiceWord.americanPronunciation }}</dd></div>
          <div><dt>来源</dt><dd>{{ practiceWord.__datasetLabel }} · {{ typeLabel(practiceWord) }}</dd></div>
          <div v-if="practiceWord.exampleSentence" class="practice-example-detail">
            <dt>例句</dt>
            <dd>
              <span class="practice-example-line">
                <span>{{ practiceWord.exampleSentence }}</span>
                <button
                  type="button"
                  aria-label="播放英文例句"
                  title="播放英文例句"
                  @click="speakExampleSentence(practiceWord.exampleSentence, accent)"
                >
                  ♪ 播放
                </button>
              </span>
              <small>{{ practiceWord.exampleTranslation }}</small>
            </dd>
          </div>
        </dl>

        <form class="answer-form" @submit.prevent="submitAnswer">
          <p class="letter-hint">逐字母输入，按 Enter 提交</p>
          <div
            class="letter-entry"
            role="group"
            aria-label="词条字母输入区"
            @click="focusAnswerInput"
          >
            <span
              v-for="(slot, index) in answerSlots"
              :key="`${currentPracticeIndex}-${index}-${letterShakeVersions[index] ?? 0}`"
              :class="[
                'letter-slot',
                {
                  filled: slot.value,
                  correct: slot.correct,
                  wrong: slot.wrong,
                  waiting: pendingLetterIndex === index,
                },
              ]"
            >
              {{ slot.value }}
            </span>
            <input
              ref="answerInput"
              class="letter-capture"
              :value="answer"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              enterkeyhint="done"
              spellcheck="false"
              :maxlength="practiceAnswerTarget.length"
              :readonly="submissionPending"
              aria-label="输入词条字母"
              @focus="handlePracticeInputFocus"
              @blur="handlePracticeInputBlur"
              @input="handleAnswerInput"
            />
          </div>
          <p v-if="feedback" :class="['practice-feedback', feedback.type]">{{ feedback.text }}</p>
        </form>

        <div class="practice-actions">
          <button class="action-coral" @click="speakPracticeWord">♪ 播放词条 <kbd>ESC</kbd></button>
          <button class="action-blue" @click="hideWord = !hideWord">
            {{ hideWord ? '显示词条' : '隐藏词条' }} <kbd>2</kbd>
          </button>
          <button class="action-green" :disabled="submissionPending" @click="submitAnswer">提交 <kbd>Enter</kbd></button>
          <button class="action-muted" @click="nextPracticeWord">随机/下一词</button>
          <button class="action-danger" @click="startWrongPractice">
            {{ wrongPracticeMode ? '退出错题练习' : '错题练习' }}
            <span v-if="wrongWords.length">{{ wrongWords.length }}</span>
          </button>
          <button
            v-if="!wrongPracticeMode && wrongWords.length"
            class="action-clear"
            @click="wrongWords = []"
          >
            清空错题
          </button>
          <label v-if="!wrongPracticeMode" class="jump-control">
            <input v-model.number="jumpNumber" type="number" min="1" :max="words.length" />
            <button @click="jumpToWord">跳转</button>
          </label>
        </div>
      </div>

      <footer class="practice-library-switcher" aria-label="切换练习词库">
        <div class="practice-library-current">
          <span>练习词库</span>
          <strong>{{ activeCategory.label }}</strong>
          <small>{{ words.length.toLocaleString() }} 条</small>
        </div>

        <div class="practice-library-controls">
          <button
            class="practice-library-arrow"
            type="button"
            aria-label="切换到上一个词库"
            title="上一个词库"
            :disabled="loading || !hasPreviousPracticeDataset"
            @click="switchPracticeDataset(-1)"
          >
            ←
          </button>

          <label>
            <span>分类</span>
            <select
              :value="activeNavigationGroup.id"
              :disabled="loading"
              aria-label="选择练习分类"
              @change="selectPracticeNavigationGroup($event.target.value)"
            >
              <option v-for="group in navigationGroups" :key="group.id" :value="group.id">
                {{ group.label }}
              </option>
            </select>
          </label>

          <label>
            <span>内容</span>
            <select
              :value="activeCategory.id"
              :disabled="loading"
              aria-label="选择练习词库"
              @change="selectPracticeDataset($event.target.value)"
            >
              <option
                v-for="option in activeNavigationGroup.options"
                :key="option.id"
                :value="option.id"
              >
                {{ option.label }} · {{ option.count.toLocaleString() }} 条
              </option>
            </select>
          </label>

          <button
            class="practice-library-arrow"
            type="button"
            aria-label="切换到下一个词库"
            title="下一个词库"
            :disabled="loading || !hasNextPracticeDataset"
            @click="switchPracticeDataset(1)"
          >
            →
          </button>
        </div>
      </footer>
    </section>
  </main>
</template>
