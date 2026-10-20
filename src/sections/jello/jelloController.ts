import type { SceneHandle } from '../../engine/sceneHost'
import type { TemperatureData } from '../../data/types'
import type { Deeper } from '../../ui/deeper'
import { wobbleParams, type WobbleParams } from './wobble'

// What the jello does; the controller works without one. Poke points are 0..1 across the stage.
export interface JelloScene extends SceneHandle {
  setParams(p: WobbleParams, stop: number): void
  poke(x: number, y: number): void
}

// Intro beats, in ms: wait for the jello (briefly), poke it stiff, then poke it wild.
const INTRO = { sceneWait: 2500, hold: 300, stiff: 1500, wild: 1300, hint: 900, why: 600 }
const CENTER = { x: 0.56, y: 0.42 }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createJelloController(root: HTMLElement, data: TemperatureData, _deeper: Deeper) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel) as T
  const slider = $<HTMLInputElement>('[data-temperature-slider]')
  const value = $('[data-temperature-value]')
  const answer = $('[data-answer]')
  const stage = root.querySelector<HTMLElement>('[data-jello-stage]')
  root.querySelector('[data-prompt]')?.replaceChildren(data.prompt)

  let scene: JelloScene | null = null
  let stop = 0
  let sceneReady: () => void = () => {}
  const sceneArrived = new Promise<void>((resolve) => { sceneReady = resolve })

  function reveal(...selectors: string[]): void {
    for (const sel of selectors) root.querySelectorAll(sel).forEach((el) => el.classList.add('is-shown'))
  }

  function setStop(i: number): void {
    stop = Math.max(0, Math.min(data.samples.length - 1, Math.round(i)))
    const s = data.samples[stop]!
    slider.value = String(stop)
    value.textContent = s.temperature.toFixed(1)
    if (answer.textContent !== s.text) {
      answer.textContent = s.text
      answer.animate?.([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'none' }], { duration: 320, easing: 'ease-out' })
    }
    scene?.setParams(wobbleParams(s.temperature), stop)
  }

  function poke(x = CENTER.x, y = CENTER.y): void {
    scene?.poke(x, y)
  }

  function attach(s: JelloScene): void {
    scene = s
    s.setParams(wobbleParams(data.samples[stop]!.temperature), stop)
    sceneReady()
  }

  // The one-time Show beat: a stiff poke with a plain answer, then a wild one with a wild answer.
  async function playIntro(): Promise<void> {
    await Promise.race([sceneArrived, wait(INTRO.sceneWait)])
    await wait(INTRO.hold)
    setStop(0)
    poke()
    await wait(INTRO.stiff)
    setStop(data.samples.length - 1)
    poke()
    await wait(INTRO.wild)
    reveal('[data-caption]')
    await wait(INTRO.hint)
    reveal('[data-hint]')
    root.classList.add('is-your-turn')
    await wait(INTRO.why)
    reveal('.why')
  }

  // Reduced motion: the plain answer and everything revealed.
  function showAnswered(): void {
    setStop(0)
    reveal('[data-caption]', '[data-hint]', '.why')
    root.classList.add('is-your-turn')
  }

  slider.addEventListener('input', () => setStop(Number(slider.value)))

  if (stage) {
    stage.addEventListener('pointerdown', (e) => {
      root.classList.add('has-poked') // the "poke the jello" prompt has done its job
      const r = stage.getBoundingClientRect()
      poke((e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1))
    })
    stage.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      e.preventDefault()
      if (e.repeat) return
      root.classList.add('has-poked')
      poke()
    })
  }

  setStop(0)
  return { setStop, poke, playIntro, showAnswered, attach }
}
