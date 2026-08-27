import { onBeforeUnmount, ref, watch } from 'vue'

export function useDebouncedRef(source, delay = 120) {
  const debounced = ref(source.value)
  let timer

  watch(source, (value) => {
    window.clearTimeout(timer)
    if (!value) {
      debounced.value = value
      return
    }
    timer = window.setTimeout(() => {
      debounced.value = value
    }, delay)
  })

  onBeforeUnmount(() => window.clearTimeout(timer))
  return debounced
}
