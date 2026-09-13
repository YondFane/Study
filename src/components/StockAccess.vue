<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { verifyStockAccess } from '../services/stockAccess.js'

const emit = defineEmits(['back', 'unlock'])
const password = ref('')
const input = ref(null)
const busy = ref(false)
const message = ref('')

function handleInput(event) {
  password.value = event.target.value.replace(/\D/g, '').slice(0, 6)
  event.target.value = password.value
  message.value = ''
}

async function submit() {
  if (busy.value || password.value.length !== 6) return
  busy.value = true
  message.value = ''
  try {
    if (await verifyStockAccess(password.value)) {
      password.value = ''
      emit('unlock')
      return
    }
    password.value = ''
    message.value = '密码错误，请重新输入'
    await nextTick()
    input.value?.focus()
  } catch {
    message.value = '当前浏览器无法完成安全验证'
  } finally {
    busy.value = false
  }
}

onMounted(() => input.value?.focus())
</script>

<template>
  <section class="stock-access-page">
    <button type="button" class="stock-access-back" aria-label="返回 Study" @click="$emit('back')">
      <span aria-hidden="true">←</span>
      Study
    </button>

    <form class="stock-access-card" @submit.prevent="submit">
      <div class="stock-access-icon" aria-hidden="true">S</div>
      <p>PRIVATE WORKSPACE</p>
      <h1>访问验证</h1>
      <span>请输入访问密码以继续</span>
      <label>
        <span>访问密码</span>
        <input
          ref="input"
          :value="password"
          type="password"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          autocomplete="off"
          aria-describedby="stock-access-message"
          @input="handleInput"
        />
      </label>
      <p id="stock-access-message" class="stock-access-message" aria-live="polite">{{ message }}</p>
      <button type="submit" :disabled="busy || password.length !== 6">
        {{ busy ? '验证中…' : '进入页面' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.stock-access-page {
  min-height: 100vh;
  padding: 28px;
  display: grid;
  place-items: center;
  color: #e7efe9;
  background:
    radial-gradient(circle at 50% 38%, rgba(68, 213, 138, .12), transparent 28%),
    linear-gradient(145deg, #07110e, #10221c 58%, #0a1713);
}

.stock-access-back {
  position: absolute;
  top: 26px;
  left: max(24px, calc((100% - 1180px) / 2));
  padding: 10px 14px;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(206, 229, 216, .18);
  border-radius: 9px;
  color: #c9d8cf;
  background: rgba(255, 255, 255, .04);
}

.stock-access-back:hover { color: #fff; border-color: rgba(206, 229, 216, .36); }
.stock-access-back:focus-visible,
.stock-access-card input:focus-visible,
.stock-access-card > button:focus-visible { outline: 2px solid #44d58a; outline-offset: 3px; }

.stock-access-card {
  width: min(410px, 100%);
  padding: 42px;
  border: 1px solid rgba(206, 229, 216, .14);
  border-radius: 22px;
  background: rgba(8, 22, 17, .76);
  box-shadow: 0 28px 80px rgba(0, 0, 0, .3);
  backdrop-filter: blur(16px);
}

.stock-access-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #07110e;
  background: #44d58a;
  font: 24px/1 Georgia, serif;
}

.stock-access-card > p:first-of-type { margin: 0 0 12px; color: #44d58a; font-size: 9px; letter-spacing: .24em; }
.stock-access-card h1 { margin: 0; color: #f4f8f5; font: 500 38px/1.2 Georgia, serif; }
.stock-access-card > span { margin-top: 10px; display: block; color: #82958a; font-size: 13px; }
.stock-access-card label { margin-top: 36px; display: block; }
.stock-access-card label span { margin-bottom: 9px; display: block; color: #9bad9f; font-size: 11px; }
.stock-access-card input {
  width: 100%;
  height: 52px;
  padding: 0 15px;
  border: 1px solid rgba(206, 229, 216, .2);
  border-radius: 10px;
  outline: 0;
  color: #f5f8f6;
  background: rgba(255, 255, 255, .055);
  font-size: 22px;
  letter-spacing: .26em;
}

.stock-access-message { min-height: 18px; margin: 9px 0 5px; color: #ef846d; font-size: 11px; }
.stock-access-card > button {
  width: 100%;
  height: 50px;
  border: 0;
  border-radius: 10px;
  color: #07110e;
  background: #44d58a;
  font-weight: 700;
}

.stock-access-card > button:disabled { opacity: .38; cursor: not-allowed; }

@media (max-width: 520px) {
  .stock-access-page { padding: 20px; }
  .stock-access-back { top: 18px; left: 18px; }
  .stock-access-card { padding: 32px 24px; }
}
</style>
