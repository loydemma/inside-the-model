import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { JelloScene } from './jelloController'
import { displacement, settleTime, wobbleParams, type WobbleParams } from './wobble'
import calmUrl from './jello-calm.mp4'
import mediumUrl from './jello-medium.mp4'
import wildUrl from './jello-wild.mp4'
import restUrl from './jello-rest.jpg'

// Which clip each slider stop plays; the CSS wobble on top grows with temperature in between.
const CLIP_FOR_STOP = [0, 0, 1, 2, 2]
const BODY = { x: 0.5, y: 0.48 } // the jello's middle, as a share of the clip frame
const REACH = 0.45 // pokes farther than this from the middle wobble it less
const SKEW_DEG = 26

// Rainbow jello on a glass plate, from three clips that all start and end in the same rest pose.
// A poke replays the clip for the current stop; a squash/stretch/skew layer on top, centered on
// the poke, makes the five stops read as one smooth progression.
export async function createJelloScene(stage: HTMLElement, q: Quality): Promise<JelloScene> {
  const glow = document.createElement('div')
  glow.className = 'jv-glow'
  // The card blends and feathers into the stage; it is never 3D-transformed (iOS draws a
  // blended, masked video in a 3D context as a black box). The tilt lives one level in.
  const card = document.createElement('div')
  card.className = 'jv-card'
  const tilt = document.createElement('div')
  tilt.className = 'jv-tilt'
  const wobble = document.createElement('div')
  wobble.className = 'jv-wobble'
  const rest = document.createElement('img')
  rest.className = 'jv-media'
  rest.src = restUrl
  rest.alt = ''
  wobble.append(rest)
  tilt.append(wobble)
  card.append(tilt)
  stage.append(glow, card)

  const videos: HTMLVideoElement[] = q.reducedMotion ? [] : [calmUrl, mediumUrl, wildUrl].map((src) => {
    const v = document.createElement('video')
    v.className = 'jv-media jv-clip'
    v.src = src
    v.muted = true
    v.playsInline = true
    v.preload = 'auto' // mounted just before it's seen; a poke must answer at once
    v.disablePictureInPicture = true
    v.setAttribute('aria-hidden', 'true')
    wobble.append(v)
    return v
  })

  const pointer = createPointer(window, { reducedMotion: q.reducedMotion })
  let params: WobbleParams = wobbleParams(0)
  let stop = 0
  let active: HTMLVideoElement | null = null
  let playFailed = false // autoplay refused (e.g. iOS Low Power Mode): the poster wobbles instead
  let pokedAt = -1e9
  let dist = 0
  let side = 0
  let tiltX = 0
  let tiltY = 0
  let raf = 0
  let last = 0

  // Crossfade to `v`; the outgoing clip stops once it's hidden. The rest poster sits underneath.
  function show(v: HTMLVideoElement | null): void {
    for (const o of videos) {
      if (o === v) continue
      o.classList.remove('is-on')
      setTimeout(() => { if (o !== active) o.pause() }, 250)
    }
    v?.classList.add('is-on')
    active = v
  }

  function playClip(v: HTMLVideoElement): void {
    v.currentTime = 0
    v.play().then(
      () => show(v),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          playFailed = true
          show(null)
        }
      },
    )
  }

  function squish(): void {
    wobble.classList.remove('is-squished')
    void wobble.offsetWidth // restart the animation
    wobble.classList.add('is-squished')
  }

  function tick(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    const p = pointer.get()
    tiltY = smoothToward(tiltY, p.x * MAX_TILT_RAD, dt, 5)
    tiltX = smoothToward(tiltX, -p.y * MAX_TILT_RAD, dt, 5)
    tilt.style.transform = `perspective(1100px) rotateX(${tiltX}rad) rotateY(${tiltY}rad)`

    const t = (now - pokedAt) / 1000
    const live = t < settleTime(params) + 0.3
    // Squash and stretch on the beat; the sideways lean trails it by a quarter wobble.
    const d = live ? displacement(dist, t, params, REACH) : 0
    const lag = 0.25 / params.frequency
    const s = live && t > lag ? displacement(dist, t - lag, params, REACH) : 0
    wobble.style.transform = live ? `skewX(${side * s * SKEW_DEG}deg) scale(${1 - 0.55 * d}, ${1 + d})` : ''
    const energy = live ? params.amplitude * Math.exp(-params.damping * t) : 0
    glow.style.transform = `translate(${-tiltY * 90}px, ${tiltX * 90}px)`
    glow.style.setProperty('--energy', Math.min(1, energy * 6).toFixed(3))
    raf = requestAnimationFrame(tick)
  }

  return {
    setParams(p: WobbleParams, i: number) {
      params = p
      stop = i
    },
    poke(x: number, y: number) {
      // Stage point to a point on the clip's frame.
      const s = stage.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      const u = Math.max(0, Math.min(1, (s.left + x * s.width - c.left) / (c.width || 1)))
      const v = Math.max(0, Math.min(1, (s.top + y * s.height - c.top) / (c.height || 1)))
      wobble.style.transformOrigin = `${(u * 100).toFixed(1)}% ${(v * 100).toFixed(1)}%`
      if (q.reducedMotion) { squish(); return }
      dist = Math.hypot(u - BODY.x, (v - BODY.y) * 0.6)
      side = Math.max(-1, Math.min(1, (u - BODY.x) / 0.22))
      pokedAt = performance.now()
      const clip = videos[CLIP_FOR_STOP[stop] ?? 0]
      if (clip && !playFailed) playClip(clip)
    },
    start() {
      if (raf || q.reducedMotion) return
      last = performance.now()
      raf = requestAnimationFrame(tick)
    },
    stop() {
      cancelAnimationFrame(raf)
      raf = 0
      active?.pause()
    },
    resize() {},
    dispose() {
      cancelAnimationFrame(raf)
      raf = 0
      pointer.dispose()
      for (const v of videos) { v.pause(); v.removeAttribute('src') }
      glow.remove()
      card.remove()
    },
  }
}
