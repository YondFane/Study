<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  enabled: {
    type: Boolean,
    default: true,
  },
})

const canvas = ref(null)
let context
let frame
let points = []
let width = 0
let height = 0
let pixelRatio = 1

function createPoints() {
  // Cap the population on 4K displays: the connection pass is O(n²), so an
  // uncapped point count can consume a full CPU core without improving clarity.
  const count = Math.min(110, Math.max(36, Math.floor((width * height) / 26000)))
  points = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.22,
    vy: (Math.random() - 0.5) * 0.22,
  }))
}

function resize() {
  if (!canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  width = rect.width
  height = rect.height
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.value.width = width * pixelRatio
  canvas.value.height = height * pixelRatio
  context = canvas.value.getContext('2d')
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  createPoints()
}

function draw() {
  if (!context || !props.enabled || document.hidden) {
    frame = undefined
    return
  }
  context.clearRect(0, 0, width, height)

  points.forEach((point, index) => {
    point.x += point.vx
    point.y += point.vy
    if (point.x < 0 || point.x > width) point.vx *= -1
    if (point.y < 0 || point.y > height) point.vy *= -1

    context.beginPath()
    context.arc(point.x, point.y, 2.3, 0, Math.PI * 2)
    context.fillStyle = 'rgba(236, 110, 76, .42)'
    context.fill()

    for (let targetIndex = index + 1; targetIndex < points.length; targetIndex += 1) {
      const target = points[targetIndex]
      const deltaX = point.x - target.x
      const deltaY = point.y - target.y
      const distanceSquared = deltaX * deltaX + deltaY * deltaY
      if (distanceSquared > 135 * 135) continue
      const distance = Math.sqrt(distanceSquared)

      context.beginPath()
      context.moveTo(point.x, point.y)
      context.lineTo(target.x, target.y)
      context.strokeStyle = `rgba(24, 50, 45, ${0.11 * (1 - distance / 135)})`
      context.lineWidth = 1
      context.stroke()
    }
  })

  frame = window.requestAnimationFrame(draw)
}

function stopDrawing() {
  if (frame) window.cancelAnimationFrame(frame)
  frame = undefined
  if (context) context.clearRect(0, 0, width, height)
}

function startDrawing() {
  if (!frame && props.enabled && !document.hidden) draw()
}

function handleVisibilityChange() {
  if (document.hidden) stopDrawing()
  else startDrawing()
}

watch(() => props.enabled, (enabled) => {
  if (enabled) startDrawing()
  else stopDrawing()
})

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  startDrawing()
})

onBeforeUnmount(() => {
  stopDrawing()
  window.removeEventListener('resize', resize)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <canvas ref="canvas" class="particle-canvas" aria-hidden="true"></canvas>
</template>

<style scoped>
.particle-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
