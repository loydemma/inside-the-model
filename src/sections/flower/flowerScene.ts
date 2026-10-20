import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { FlowerScene } from './flowerController'
import clipUrl from './flower.mp4'
import budUrl from './flower-bud.jpg'
import bloomedUrl from './flower-bloomed.jpg'

const LAG_SEC = 0.35 // how far the clip trails the answer; sets the playback rate
const MAX_RATE = 4
const MIN_RATE = 0.25

// A video of a bud unfurling into a bloom. Its time follows the answer: word i of n is about i/n
// of the clip. It plays (rather than seeks, which stutters on H.264) at a rate that keeps up.
export async function createFlowerScene(stage: HTMLElement, q: Quality): Promise<FlowerScene> {
  const glow = document.createElement('div')
  glow.className = 'fv-glow'
  const card = document.createElement('div')
  card.className = 'fv-card'
  const tint = document.createElement('div')
  tint.className = 'fv-tint'

  let video: HTMLVideoElement | null = null
  if (q.reducedMotion) {
    const img = document.createElement('img')
    img.className = 'fv-media'
    img.src = bloomedUrl
    img.alt = ''
    card.append(img, tint)
  } else {
    video = document.createElement('video')
    video.className = 'fv-media'
    video.src = clipUrl
    video.poster = budUrl
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.disablePictureInPicture = true
    video.setAttribute('aria-hidden', 'true')
    card.append(video, tint)
  }
  stage.append(glow, card)

  const pointer = createPointer(window, { reducedMotion: q.reducedMotion })
  let count = 1
  let opened = 0
  let holdP = 0
  let target = 0 // share of the clip the answer has reached; only grows until a reset
  let tiltX = 0
  let tiltY = 0
  let held = 0
  let raf = 0
  let last = 0

  function rewind(): void {
    opened = 0
    target = 0
    if (!video) return
    video.pause()
    video.currentTime = 0
  }

  function follow(): void {
    if (!video || !video.duration) return
    const gap = target * video.duration - video.currentTime
    if (gap > 0.02 && !video.ended) {
      const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, gap / LAG_SEC))
      if (Math.abs(rate - video.playbackRate) > 0.08 * video.playbackRate) video.playbackRate = rate
      if (video.paused) void video.play().catch(() => {})
    } else if (!video.paused) video.pause()
  }

  function tick(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    target = Math.max(target, Math.min(1, (opened + holdP) / count))
    follow()
    const p = pointer.get()
    tiltY = smoothToward(tiltY, p.x * MAX_TILT_RAD, dt, 5)
    tiltX = smoothToward(tiltX, -p.y * MAX_TILT_RAD, dt, 5)
    held = smoothToward(held, holdP > 0 ? 0.65 + 0.35 * holdP : 0, dt, 4)
    card.style.transform = `perspective(1100px) rotateX(${tiltX}rad) rotateY(${tiltY}rad)`
    // The glow sits deeper, so it drifts the other way: a little parallax.
    glow.style.transform = `translate(${-tiltY * 90}px, ${tiltX * 90}px) scale(${1 + held * 0.12})`
    glow.style.setProperty('--held', held.toFixed(3))
    raf = requestAnimationFrame(tick)
  }

  return {
    setPetalCount(n: number) {
      count = Math.max(1, n)
      rewind()
    },
    openPetal(i: number) {
      opened = Math.max(opened, i + 1)
    },
    setHoldProgress(p: number) {
      holdP = p
    },
    // Grounded: a cool, calm blue. A blue-tinted clip could replace the tint layer later.
    setMood(m: 'guess' | 'grounded') {
      stage.dataset.flowerMood = m
    },
    reset: rewind,
    start() {
      if (raf) return
      last = performance.now()
      raf = requestAnimationFrame(tick)
    },
    stop() {
      cancelAnimationFrame(raf)
      raf = 0
      video?.pause()
    },
    resize() {},
    dispose() {
      cancelAnimationFrame(raf)
      raf = 0
      pointer.dispose()
      video?.pause()
      video?.removeAttribute('src')
      glow.remove()
      card.remove()
    },
  }
}
