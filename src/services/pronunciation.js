const PUBLIC_AUDIO_STREAM_BASE_URL = 'https://dict.youdao.com/dictvoice'
const PROJECT_AUDIO_ROOT_URL = `${import.meta.env.BASE_URL}data/audio/`
const AUDIO_LOOKUP_SHARD_COUNT = 64
const ONLINE_AUDIO_START_TIMEOUT_MS = 600
const ONLINE_AUDIO_FAILURE_THRESHOLD = 2
const ONLINE_AUDIO_COOLDOWN_MS = 5 * 60 * 1000
export const DEVICE_SPEECH_RATE = 0.72

export function createPronunciationService({ isOnlineEnabled }) {
  const projectAudioLookupPromises = new Map()
  let activeDictionaryAudio
  let pronunciationRequestId = 0
  let speechVoices = []
  let onlineFailureCount = 0
  let onlineUnavailableUntil = 0

  function refreshVoices() {
    if ('speechSynthesis' in window) speechVoices = window.speechSynthesis.getVoices()
  }

  function selectPreferredVoice(lang) {
    if (!('speechSynthesis' in window)) return undefined

    const voices = speechVoices.length ? speechVoices : window.speechSynthesis.getVoices()
    const targetLang = lang.toLowerCase()
    const preferredNames = targetLang === 'en-gb'
      ? ['sonia', 'libby', 'ryan', 'george', 'hazel', 'daniel']
      : ['aria', 'jenny', 'guy', 'samantha', 'alex', 'zira', 'david']

    return voices
      .map((voice) => {
        const voiceLang = voice.lang.toLowerCase()
        const voiceName = voice.name.toLowerCase()
        let score = 0
        if (voiceLang === targetLang) score += 100
        else if (voiceLang.startsWith(targetLang.split('-')[0])) score += 20
        if (preferredNames.some((name) => voiceName.includes(name))) score += 35
        if (voice.localService) score += 5
        return { voice, score }
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.voice
  }

  function stop() {
    // Invalidating the request token prevents a slow catalog/audio request from
    // starting after the user has already selected another word.
    pronunciationRequestId += 1
    if (!activeDictionaryAudio) return
    activeDictionaryAudio.pause()
    activeDictionaryAudio.currentTime = 0
    activeDictionaryAudio = undefined
  }

  function speakWithSystemVoice(text, lang, rate) {
    if (!text || !('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const preferredVoice = selectPreferredVoice(lang)

    utterance.lang = lang
    utterance.rate = rate
    utterance.pitch = 1
    if (preferredVoice) utterance.voice = preferredVoice
    window.speechSynthesis.speak(utterance)
  }

  function getPublicAudioStreamUrl(text, lang) {
    const normalizedText = String(text ?? '').trim().replace(/\s+/g, ' ')
    if (!/[a-z]/i.test(normalizedText) || normalizedText.length > 320) return ''

    const voiceType = lang.toLowerCase() === 'en-us' ? 2 : 1
    return `${PUBLIC_AUDIO_STREAM_BASE_URL}?audio=${encodeURIComponent(normalizedText)}&type=${voiceType}`
  }

  function audioTypeForLanguage(lang) {
    return String(lang ?? '').toLowerCase() === 'en-us' ? 2 : 1
  }

  function canTryOnlineAudio() {
    if (Date.now() < onlineUnavailableUntil) return false
    if (onlineUnavailableUntil) {
      onlineUnavailableUntil = 0
      onlineFailureCount = 0
    }
    return true
  }

  function recordOnlineSuccess() {
    onlineFailureCount = 0
    onlineUnavailableUntil = 0
  }

  function recordOnlineFailure() {
    onlineFailureCount += 1
    if (onlineFailureCount < ONLINE_AUDIO_FAILURE_THRESHOLD) return

    // Avoid making every pronunciation wait on an unhealthy third-party host.
    // The project audio remains available while this short circuit is open.
    onlineFailureCount = 0
    onlineUnavailableUntil = Date.now() + ONLINE_AUDIO_COOLDOWN_MS
  }

  function lookupShard(key) {
    let hash = 0x811c9dc5
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return ((hash >>> 0) % AUDIO_LOOKUP_SHARD_COUNT).toString(16).padStart(2, '0')
  }

  async function loadProjectAudioLookup(audioType, shard) {
    const cacheKey = `${audioType}:${shard}`
    if (!projectAudioLookupPromises.has(cacheKey)) {
      // The original catalog is about 2 MB per accent. Loading one of 64 lookup
      // shards keeps first pronunciation off the page's critical network path.
      const lookupUrl = `${PROJECT_AUDIO_ROOT_URL}type-${audioType}/lookup/${shard}.json`
      const lookupPromise = fetch(lookupUrl, {
        headers: { Accept: 'application/json' },
        cache: 'force-cache',
      }).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      }).catch((error) => {
        console.warn(`项目 type-${audioType}/${shard} 音频索引加载失败，将使用设备发音。`, error)
        return {}
      })
      projectAudioLookupPromises.set(cacheKey, lookupPromise)
    }
    return projectAudioLookupPromises.get(cacheKey)
  }

  async function getProjectAudioUrl(text, lang) {
    const key = String(text ?? '').trim().toLocaleLowerCase('en-US')
    if (!key || /\s/u.test(key)) return ''

    const audioType = audioTypeForLanguage(lang)
    const lookup = await loadProjectAudioLookup(audioType, lookupShard(key))
    const file = lookup[key]
    return file ? `${PROJECT_AUDIO_ROOT_URL}${file.replace(/^\/+/, '')}` : ''
  }

  function playAudioUrl(audioUrl, requestId, {
    onFailure,
    onStarted,
    startTimeoutMs = 0,
  }) {
    if (!audioUrl || requestId !== pronunciationRequestId) return

    let completed = false
    let startTimer
    const audio = new Audio(audioUrl)
    audio.preload = 'auto'
    activeDictionaryAudio = audio

    const clearStartTimer = () => window.clearTimeout(startTimer)
    const handleStarted = () => {
      if (completed || requestId !== pronunciationRequestId) return
      clearStartTimer()
      onStarted?.()
    }
    const handleFailure = () => {
      if (completed) return
      completed = true
      clearStartTimer()
      audio.pause()
      // Releasing src also aborts a request that stalled before playback.
      audio.removeAttribute('src')
      audio.load()
      if (activeDictionaryAudio === audio) activeDictionaryAudio = undefined
      if (requestId === pronunciationRequestId) onFailure?.()
    }

    audio.addEventListener('ended', () => {
      completed = true
      clearStartTimer()
      if (activeDictionaryAudio === audio) activeDictionaryAudio = undefined
    }, { once: true })
    audio.addEventListener('playing', handleStarted, { once: true })
    audio.addEventListener('error', handleFailure, { once: true })
    if (startTimeoutMs > 0) {
      startTimer = window.setTimeout(handleFailure, startTimeoutMs)
    }
    audio.play().catch(handleFailure)
  }

  function speak(text, lang) {
    if (!text) return

    stop()
    window.speechSynthesis?.cancel()

    const requestId = pronunciationRequestId
    let onlineAttemptStarted = false
    let projectAttemptStarted = false
    let deviceFallbackStarted = false
    const fallbackToDevice = () => {
      if (deviceFallbackStarted || requestId !== pronunciationRequestId) return
      deviceFallbackStarted = true
      speakWithSystemVoice(text, lang, DEVICE_SPEECH_RATE)
    }

    const tryOnlineAudio = (onFailure) => {
      if (onlineAttemptStarted || requestId !== pronunciationRequestId) return
      onlineAttemptStarted = true
      if (!canTryOnlineAudio()) {
        onFailure()
        return
      }

      const onlineAudioUrl = getPublicAudioStreamUrl(text, lang)
      if (!onlineAudioUrl) {
        onFailure()
        return
      }

      playAudioUrl(onlineAudioUrl, requestId, {
        startTimeoutMs: ONLINE_AUDIO_START_TIMEOUT_MS,
        onStarted: recordOnlineSuccess,
        onFailure: () => {
          recordOnlineFailure()
          onFailure()
        },
      })
    }

    const tryProjectAudio = (onFailure) => {
      if (projectAttemptStarted || requestId !== pronunciationRequestId) return
      projectAttemptStarted = true
      getProjectAudioUrl(text, lang).then((projectAudioUrl) => {
        if (requestId !== pronunciationRequestId) return
        if (projectAudioUrl) {
          playAudioUrl(projectAudioUrl, requestId, { onFailure })
        } else {
          onFailure()
        }
      }).catch(onFailure)
    }

    if (isOnlineEnabled()) {
      // When the switch is on, prefer the faster public stream and keep the
      // published project file plus the system voice as two independent fallbacks.
      tryOnlineAudio(() => tryProjectAudio(fallbackToDevice))
    } else {
      // Turning the switch off disables only the third-party request. Project
      // audio remains available and still falls back to the system voice.
      tryProjectAudio(fallbackToDevice)
    }
  }

  return { refreshVoices, speak, stop }
}
