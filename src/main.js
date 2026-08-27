import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // Service Worker setup is not needed for first paint. Schedule it during an
    // idle period so cache initialization does not compete with the first dataset.
    const registerServiceWorker = () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      }).catch((error) => {
        console.warn('离线缓存初始化失败。', error)
      })
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(registerServiceWorker, { timeout: 3000 })
    } else {
      window.setTimeout(registerServiceWorker, 0)
    }
  })
}
