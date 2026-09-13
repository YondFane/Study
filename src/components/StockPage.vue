<script setup>
defineEmits(['back'])
</script>

<template>
  <section class="stock-page">
    <header class="stock-header">
      <button type="button" class="stock-back" aria-label="返回 Study" @click="$emit('back')">
        <span aria-hidden="true">←</span>
        Study
      </button>
      <div class="stock-brand">
        <span>S</span>
        <strong>MARKET</strong>
      </div>
      <span class="stock-status"><i></i> Workspace ready</span>
    </header>

    <main class="stock-content">
      <div class="stock-intro">
        <p>STOCK WORKSPACE</p>
        <h1>股票页面</h1>
        <span>行情、自选与分析功能将在这里逐步接入。</span>
      </div>

      <div class="stock-placeholder-grid">
        <section>
          <span>01</span>
          <h2>市场概览</h2>
          <p>MARKET OVERVIEW</p>
        </section>
        <section>
          <span>02</span>
          <h2>自选股票</h2>
          <p>WATCHLIST</p>
        </section>
        <section>
          <span>03</span>
          <h2>分析工具</h2>
          <p>ANALYSIS</p>
        </section>
      </div>
    </main>
  </section>
</template>

<style scoped>
.stock-page {
  min-height: 100vh;
  color: #e7efe9;
  background:
    radial-gradient(circle at 82% 12%, rgba(47, 191, 113, .14), transparent 28%),
    linear-gradient(145deg, #07110e, #10221c 58%, #0a1713);
}

.stock-header {
  min-height: 76px;
  padding: 0 max(24px, calc((100% - 1180px) / 2));
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1px solid rgba(206, 229, 216, .12);
}

.stock-back {
  width: fit-content;
  padding: 10px 14px;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(206, 229, 216, .18);
  border-radius: 9px;
  color: #c9d8cf;
  background: rgba(255, 255, 255, .04);
}

.stock-back:hover { color: #fff; border-color: rgba(206, 229, 216, .36); }
.stock-back:focus-visible { outline: 2px solid #44d58a; outline-offset: 3px; }

.stock-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  letter-spacing: .2em;
}

.stock-brand span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #07110e;
  background: #44d58a;
  font-family: Georgia, serif;
  font-size: 18px;
}

.stock-brand strong { font-size: 12px; }
.stock-status { justify-self: end; color: #82958a; font-size: 11px; letter-spacing: .08em; }
.stock-status i {
  width: 7px;
  height: 7px;
  margin-right: 7px;
  display: inline-block;
  border-radius: 50%;
  background: #44d58a;
  box-shadow: 0 0 10px rgba(68, 213, 138, .65);
}

.stock-content {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: clamp(72px, 11vh, 128px) 0 64px;
}

.stock-intro { max-width: 650px; }
.stock-intro > p { margin: 0 0 16px; color: #44d58a; font-size: 11px; letter-spacing: .24em; }
.stock-intro h1 { margin: 0; color: #f3f7f4; font: 600 clamp(42px, 7vw, 78px)/1.08 Georgia, serif; }
.stock-intro > span { margin-top: 22px; display: block; color: #8fa198; font-size: 15px; line-height: 1.8; }

.stock-placeholder-grid {
  margin-top: clamp(64px, 12vh, 116px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.stock-placeholder-grid section {
  min-height: 190px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  border: 1px solid rgba(206, 229, 216, .12);
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(255, 255, 255, .055), rgba(255, 255, 255, .018));
}

.stock-placeholder-grid section > span { margin-bottom: auto; color: #44d58a; font: 13px/1 Georgia, serif; }
.stock-placeholder-grid h2 { margin: 0 0 8px; color: #e9f0eb; font: 500 22px/1.2 Georgia, serif; }
.stock-placeholder-grid p { margin: 0; color: #60736a; font-size: 9px; letter-spacing: .2em; }

@media (max-width: 700px) {
  .stock-header { padding-inline: 16px; grid-template-columns: 1fr auto; }
  .stock-brand { justify-self: end; }
  .stock-status { display: none; }
  .stock-content { width: calc(100% - 32px); padding-top: 64px; }
  .stock-placeholder-grid { margin-top: 54px; grid-template-columns: 1fr; }
  .stock-placeholder-grid section { min-height: 132px; }
}
</style>
