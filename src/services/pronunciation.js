const PUBLIC_AUDIO_STREAM_BASE_URL = 'https://dict.youdao.com/dictvoice'
const PROJECT_AUDIO_ROOT_URL = `${import.meta.env.BASE_URL}data/audio/`
const AUDIO_LOOKUP_SHARD_COUNT = 64
export const DEVICE_SPEECH_RATE = 0.72

export function createPronunciationService({ isDictionaryEnabled }) {
  const projectAudioLookupPromises = new Map()
  let activeDictionaryAudio
  let pronunciationRequestId = 0
  let speechVoices = []

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
        console.warn(`项目 type-${audioType}/${shard} 音频索引加载失败，将使用在线接口。`, error)
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

  function playAudioUrl(audioUrl, requestId, onFailure) {
    if (!audioUrl || requestId !== pronunciationRequestId) return

    let completed = false
    const audio = new Audio(audioUrl)
    audio.preload = 'auto'
    activeDictionaryAudio = audio

    const handleFailure = () => {
      if (completed) return
      completed = true
      if (activeDictionaryAudio === audio) activeDictionaryAudio = undefined
      if (requestId === pronunciationRequestId) onFailure()
    }

    audio.addEventListener('ended', () => {
      completed = true
      if (activeDictionaryAudio === audio) activeDictionaryAudio = undefined
    }, { once: true })
    audio.addEventListener('error', handleFailure, { once: true })
    audio.play().catch(handleFailure)
  }

  function speak(text, lang) {
    if (!text) return

    stop()
    window.speechSynthesis?.cancel()

    if (!isDictionaryEnabled()) {
      speakWithSystemVoice(text, lang, DEVICE_SPEECH_RATE)
      return
    }

    // Keep the existing three-level fallback: bundled audio, public audio,
    // and finally an operating-system voice when network playback fails.
    const requestId = pronunciationRequestId
    let onlineFallbackStarted = false
    let deviceFallbackStarted = false
    const fallbackToDevice = () => {
      if (deviceFallbackStarted || requestId !== pronunciationRequestId) return
      deviceFallbackStarted = true
      speakWithSystemVoice(text, lang, DEVICE_SPEECH_RATE)
    }
    const fallbackToOnlineAudio = () => {
      if (onlineFallbackStarted || requestId !== pronunciationRequestId) return
      onlineFallbackStarted = true
      const onlineAudioUrl = getPublicAudioStreamUrl(text, lang)
      if (onlineAudioUrl) playAudioUrl(onlineAudioUrl, requestId, fallbackToDevice)
      else fallbackToDevice()
    }

    getProjectAudioUrl(text, lang).then((projectAudioUrl) => {
      if (requestId !== pronunciationRequestId) return
      if (projectAudioUrl) playAudioUrl(projectAudioUrl, requestId, fallbackToOnlineAudio)
      else fallbackToOnlineAudio()
    }).catch(fallbackToOnlineAudio)
  }

  return { refreshVoices, speak, stop }
}
