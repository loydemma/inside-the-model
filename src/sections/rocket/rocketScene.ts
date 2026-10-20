import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { RocketScene } from './rocketController'
import noseUrl from './rocket-nose.jpg'
import stageUrl from './rocket-stage.jpg'
import engineUrl from './rocket-engine.jpg'
import explosionUrl from './explosion.jpg'
import ignitionUrl from './ignition.mp4'

// Each part is a slice of a 1008×1792 still on black, in source pixels: x0..x1 is the crop (centered
// on the part's body), `body` is the white body's width, and the y slices stack top to bottom at
// natural scale. A stage keeps only its top and bottom ends (the middle of a cylinder is all the
// same), and the nose keeps its cone and base but little of its long cylinder, so twenty stages
// still fit. Each part starts just
// under the band of the part above, so every seam lands on one silver band.
type Part = { url: string; x0: number; x1: number; body: number; slices: [number, number][] }
const SRC = 1008
const NOSE: Part = { url: noseUrl, x0: 310, x1: 722, body: 397, slices: [[300, 1040], [1300, 1434]] }
const STAGE_BOTTOM = 1396 // just under the stage's bottom band
const STAGE_BAND = 26 // the bottom band's height, in the stage still
const ENGINE: Part = { url: engineUrl, x0: 262, x1: 747, body: 265, slices: [[496, 560], [700, 1338]] }
const NOZZLE = 1306 // the middle of the nozzle's opening, in the engine still

// Heights in body widths ("units"), so the whole rocket scales from one number.
const units = (p: Part) => p.slices.reduce((h, [a, b]) => h + (b - a), 0) / p.body
const NOSE_U = units(NOSE)
// A stage is between STAGE_U.min and .max body widths tall: its top below the band above, and its
// own bottom band, with most of the cylinder's middle left out.
const STAGE_U = { min: 0.36, max: 0.5 }

function stagePart(u: number): Part {
  const h = u * 469
  const bottom = Math.min(124, h * 0.55)
  return { url: stageUrl, x0: 266, x1: 751, body: 469, slices: [[416, 416 + h - bottom], [STAGE_BOTTOM - bottom, STAGE_BOTTOM]] }
}
const ENGINE_U = units(ENGINE)

// Layout, as shares of the stage: where the engine sits, the room above, the widest body.
const PAD = { bottom: 0.8, top: 0.04, maxWidth: 84, maxShare: 0.2 }
// Below this many px a stage can't carry a 12px stamp on its body, so only stages 1, 5, 10, 15 and 20 get one.
const STAMP_ROOM = { height: 17, width: 30 }
// Flight, in seconds: ignition, then one stage passes every `step` while it climbs slowly; if they
// all work it speeds off the top.
const FLIGHT = { liftoff: 0.9, firstStep: 1.2, stepSpan: 2.8, minStep: 0.16, maxStep: 0.45, climb: 0.03, boost: 1.6, handoff: 4.4 }

// Rocket on the pad: nose, N stages stamped with the reliability, engine. Launch plays the ignition
// clip once at the nozzle, fading out as it climbs; a failed stage bursts and the stack above
// it tumbles away.
export async function createRocketScene(stage: HTMLElement, q: Quality): Promise<RocketScene> {
  // The card screens onto the stage, so the stills' black falls away. It is never 3D-transformed
  // (iOS draws blended video in a 3D context as a black box); the tilt is a 2D lean.
  const card = document.createElement('div')
  card.className = 'rk-card'
  const tilt = document.createElement('div')
  tilt.className = 'rk-tilt'
  const rocket = document.createElement('div')
  rocket.className = 'rk-rocket'
  tilt.append(rocket)
  card.append(tilt)
  stage.append(card)

  const boom = document.createElement('div')
  boom.className = 'rk-boom'
  boom.style.backgroundImage = `url(${explosionUrl})`
  const video = q.reducedMotion ? null : document.createElement('video')
  if (video) {
    video.className = 'rk-ignition'
    video.src = ignitionUrl
    video.muted = true
    video.playsInline = true
    video.preload = 'auto' // mounted just before it's seen; Launch must answer at once
    video.disablePictureInPicture = true
    video.setAttribute('aria-hidden', 'true')
    video.load() // iOS ignores preload; start buffering now
  }

  const pointer = createPointer(window, { reducedMotion: q.reducedMotion })
  let steps = 0
  let reliability = 0.95
  let parts: HTMLElement[] = [] // nose, stages from the top down, engine
  let stageEls: HTMLElement[] = [] // stage 0 is the bottom stage
  let w = 0 // body width in px
  let stageU: number = STAGE_U.max
  let nozzleY = 0 // in rocket coords
  let lean = 0
  let raf = 0
  let last = 0
  let flight: {
    t0: number; failedAt: number | null; y: number; v: number; passed: number; boost: boolean
    resolve: (landed: boolean) => void; done: boolean; dir: number
  } | null = null
  let resetTimer = 0
  let anims: Animation[] = []

  function place(el: HTMLElement, left: number, top: number, width: number, height: number): void {
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
  }

  function slice(p: Part, s: number, [a, b]: [number, number], top: number): HTMLElement {
    const el = document.createElement('div')
    el.className = 'rk-slice'
    el.style.cssText = `top:${top}px;height:${Math.ceil((b - a) * s) + 1}px;` +
      `background-image:url(${p.url});background-size:${SRC * s}px auto;background-position:${-p.x0 * s}px ${-a * s}px`
    return el
  }

  // One part at body width `w`, centered on x = 0, with its top at `top`.
  function part(p: Part, top: number): HTMLElement {
    const s = w / p.body
    const el = document.createElement('div')
    el.className = 'rk-part'
    const width = (p.x1 - p.x0) * s
    el.style.cssText = `left:${-width / 2}px;top:${top}px;width:${width}px;height:${units(p) * w}px`
    let y = 0
    for (const sl of p.slices) {
      el.append(slice(p, s, sl, Math.round(y)))
      y += (sl[1] - sl[0]) * s
    }
    return el
  }

  // Lay the rocket out for the stage's current size; later parts paint over earlier ones.
  function layout(grow = false): void {
    const sw = stage.clientWidth
    const sh = stage.clientHeight
    // The widest rocket that fits; past that, stages get shorter before the rocket gets thinner.
    const room = sh * (PAD.bottom - PAD.top)
    const widest = Math.min(PAD.maxWidth, sw * PAD.maxShare)
    const fit = steps ? (room / widest - NOSE_U - ENGINE_U) / steps : STAGE_U.max
    stageU = Math.max(STAGE_U.min, Math.min(STAGE_U.max, fit))
    const total = NOSE_U + steps * stageU + ENGINE_U
    w = Math.min(widest, room / total)
    const STAGE = stagePart(stageU)
    const sparse = stageU * w < STAMP_ROOM.height || w < STAMP_ROOM.width
    // The stamp sits in the middle of the stage's white body, above its band (not on the seam).
    const bodyMid = `${(50 * (1 - STAGE_BAND / (stageU * STAGE.body))).toFixed(1)}%`
    const height = total * w
    rocket.style.left = `${sw / 2}px`
    rocket.style.top = `${sh * PAD.bottom - height}px`
    rocket.replaceChildren()
    parts = []
    stageEls = []
    parts.push(part(NOSE, 0))
    let y = NOSE_U * w
    for (let i = steps - 1; i >= 0; i--) {
      const el = part(STAGE, Math.round(y))
      el.classList.add('rk-stage')
      if (!sparse || i === 0 || (i + 1) % 5 === 0) {
        const stamp = document.createElement('span')
        stamp.className = 'rk-stamp'
        if (w < STAMP_ROOM.width) stamp.classList.add('is-beside') // too narrow to sit on the body
        stamp.textContent = `${Math.round(reliability * 100)}%`
        stamp.style.fontSize = `${Math.max(12, Math.min(16, w * 0.3, stageU * w * 0.62))}px`
        if (w >= STAMP_ROOM.width) stamp.style.top = bodyMid
        el.append(stamp)
      }
      if (grow && i === steps - 1) el.classList.add('is-new')
      parts.push(el)
      stageEls[i] = el
      y += stageU * w
    }
    const engine = part(ENGINE, Math.round(y))
    parts.push(engine)
    nozzleY = y + ((NOZZLE - ENGINE.slices[1]![0] + ENGINE.slices[0]![1] - ENGINE.slices[0]![0]) * w) / ENGINE.body
    // Exhaust hangs from the nozzle and rides with the rocket.
    const ex = 4.4 * w
    if (video) place(video, -ex / 2, nozzleY - 0.12 * w, ex, ex)
    rocket.append(...parts)
    if (video) rocket.append(video)
    rocket.style.height = `${height}px`
  }

  function clearLaunch(): void {
    for (const a of anims) a.cancel()
    anims = []
    clearTimeout(resetTimer)
    if (flight && !flight.done) { flight.done = true; flight.resolve(false) } // cut short
    flight = null
    video?.pause()
    video?.classList.remove('is-on')
    boom.remove()
    rocket.style.transform = ''
  }

  function pass(i: number): void {
    stageEls[i]?.classList.add('is-passed')
  }

  // Stage `i` comes apart: a burst there, the stack above tumbles off, the rest drops and fades.
  function explode(i: number, dir: number): void {
    const el = stageEls[i]!
    const cy = el.offsetTop + (stageU * w) / 2
    const size = 6 * w
    place(boom, -size / 2, cy - size / 2, size, size)
    boom.style.backgroundSize = `${size}px auto`
    boom.style.backgroundPosition = `0 ${(-360 / SRC) * size}px` // the burst's square, y 360..1368
    rocket.append(boom)
    el.style.opacity = '0'
    anims.push(boom.animate(
      [{ transform: 'scale(0.25) rotate(0deg)', opacity: 1 }, { transform: 'scale(1) rotate(10deg)', opacity: 1, offset: 0.3 }, { transform: 'scale(1.5) rotate(22deg)', opacity: 0 }],
      { duration: 1300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    ))
    const above = parts.slice(0, parts.indexOf(el))
    const below = parts.slice(parts.indexOf(el) + 1)
    for (const p of above) {
      // One rigid tumble: every piece turns about the burst point.
      p.style.transformOrigin = `${p.offsetWidth / 2}px ${cy - p.offsetTop}px`
      anims.push(p.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${dir * 2.6 * w}px, ${3 * w}px) rotate(${dir * 75}deg)`, opacity: 0 }],
        { duration: 1700, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' },
      ))
    }
    for (const p of below) {
      p.style.transformOrigin = `${p.offsetWidth / 2}px ${cy - p.offsetTop}px`
      anims.push(p.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${-dir * 0.6 * w}px, ${2.5 * w}px) rotate(${-dir * 14}deg)`, opacity: 0 }],
        { duration: 1500, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' },
      ))
    }
    video?.classList.remove('is-on')
  }

  // Back on the pad, faded in.
  function rebuild(): void {
    clearLaunch()
    layout()
    anims.push(rocket.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out' }))
  }

  function stepTime(i: number): number {
    const span = Math.max(FLIGHT.minStep, Math.min(FLIGHT.maxStep, FLIGHT.stepSpan / Math.max(1, steps)))
    return FLIGHT.firstStep + (i + 1) * span
  }

  function fly(dt: number, now: number): void {
    const f = flight
    if (!f || f.done) return
    const t = (now - f.t0) / 1000
    const sh = stage.clientHeight
    // Stages pass one by one; the failing one bursts on its turn.
    while (f.passed < steps && t >= stepTime(f.passed)) {
      if (f.passed === f.failedAt) {
        explode(f.passed, f.dir)
        f.done = true
        resetTimer = window.setTimeout(rebuild, 2600)
        setTimeout(() => f.resolve(true), 600)
        return
      }
      pass(f.passed++)
    }
    if (f.passed >= steps) f.boost = true
    if (t > FLIGHT.liftoff) {
      f.v += (f.boost ? FLIGHT.boost : FLIGHT.climb) * sh * dt
      f.y += f.v * dt
    }
    rocket.style.transform = `translateY(${-f.y}px)`
    // The clip ignites, then fades out before its fireball reaches the crop.
    if (video?.classList.contains('is-on') && t > 0.3 && (t > FLIGHT.handoff || video.ended || video.paused)) {
      video.classList.remove('is-on')
    }
    if (f.y > sh * PAD.bottom + 40) {
      f.done = true
      f.resolve(true)
      resetTimer = window.setTimeout(rebuild, 900)
    }
  }

  function tick(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    const p = pointer.get()
    lean = smoothToward(lean, p.x * MAX_TILT_RAD, dt, 4)
    tilt.style.transform = `translateX(${lean * 60}px) rotate(${lean * 0.25}rad)`
    fly(dt, now)
    raf = requestAnimationFrame(tick)
  }

  const resize = new ResizeObserver(() => { if (!flight) layout() })
  resize.observe(stage)

  return {
    build(n: number, r: number) {
      const grow = n === steps + 1 && r === reliability
      steps = n
      reliability = r
      clearLaunch()
      layout(grow)
    },
    launch(failedAt: number | null, rand: () => number) {
      clearLaunch()
      layout()
      // Reduced motion (or not running): no flight, just the result on the pad.
      if (q.reducedMotion || !raf) {
        const upTo = failedAt ?? steps
        for (let i = 0; i < upTo; i++) pass(i)
        if (failedAt !== null) for (const p of parts.slice(0, parts.indexOf(stageEls[failedAt]!) + 1)) p.classList.add('is-failed')
        return Promise.resolve(true)
      }
      return new Promise<boolean>((resolve) => {
        const dir = rand() < 0.5 ? -1 : 1 // which way a failed stack tumbles
        flight = { t0: performance.now(), failedAt, y: 0, v: 0, passed: 0, boost: false, resolve, done: false, dir }
        if (video) {
          video.currentTime = 0
          // Autoplay refused (e.g. iOS Low Power Mode): the rocket climbs without the clip.
          video.play().then(() => video.classList.add('is-on'), () => {})
        }
      })
    },
    reset() {
      clearLaunch()
      layout()
    },
    start() {
      if (raf) return
      last = performance.now()
      raf = requestAnimationFrame(tick)
    },
    stop() {
      cancelAnimationFrame(raf)
      raf = 0
      // Back on the pad, so scrolling away mid-flight doesn't leave a frozen rocket.
      if (flight) { clearLaunch(); layout() }
    },
    resize() {},
    dispose() {
      cancelAnimationFrame(raf)
      raf = 0
      clearLaunch()
      resize.disconnect()
      pointer.dispose()
      video?.removeAttribute('src')
      card.remove()
    },
  }
}
