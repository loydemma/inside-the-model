import type { SceneHandle } from '../../engine/sceneHost'
import type { Deeper } from '../../ui/deeper'
import { rollLaunch, successOdds } from './odds'

// What the rocket does; the controller works without one. Stage 0 is the bottom stage, the first
// to fire. `launch` resolves once the outcome shows (it made it, or a stage blew).
export interface RocketScene extends SceneHandle {
  build(steps: number, reliability: number): void
  launch(failedAt: number | null): Promise<void>
  reset(): void
}

// Intro beats, in ms: wait for the rocket (briefly), stack the stages one by one, then the lesson.
const INTRO = { sceneWait: 2500, hold: 400, perStage: 200, caption: 500, hint: 900, why: 600 }
const DEFAULT = { steps: 10, reliability: 0.95 }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function createRocketController(root: HTMLElement, _deeper: Deeper, rand: () => number = Math.random) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel) as T
  const stepsSlider = $<HTMLInputElement>('[data-steps-slider]')
  const reliabilitySlider = $<HTMLInputElement>('[data-reliability-slider]')
  const stepsValue = $('[data-steps-value]')
  const reliabilityValue = $('[data-reliability-value]')
  const odds = $('[data-odds]')
  const oddsLabel = root.querySelector<HTMLElement>('[data-odds-label]')
  const result = $('[data-result]')
  const launchBtn = $<HTMLButtonElement>('[data-launch]')

  let scene: RocketScene | null = null
  let steps = DEFAULT.steps
  let reliability = DEFAULT.reliability
  let sceneReady: () => void = () => {}
  const sceneArrived = new Promise<void>((resolve) => { sceneReady = resolve })

  function reveal(...selectors: string[]): void {
    for (const sel of selectors) root.querySelectorAll(sel).forEach((el) => el.classList.add('is-shown'))
  }

  // No changes mid-flight or mid-intro.
  function lock(on: boolean): void {
    for (const el of [stepsSlider, reliabilitySlider, launchBtn]) el.disabled = on
  }

  // Readouts and the rocket for `n` stages at reliability `r`.
  function show(n: number, r: number): void {
    const pct = Math.round(r * 100)
    stepsSlider.value = String(Math.max(1, n))
    reliabilitySlider.value = String(pct)
    stepsValue.textContent = String(n)
    reliabilityValue.textContent = `${pct}%`
    // How far along each track the accent fill reaches.
    stepsSlider.style.setProperty('--fill', `${((Math.max(1, n) - 1) / 19) * 100}%`)
    reliabilitySlider.style.setProperty('--fill', `${((pct - 80) / 19) * 100}%`)
    odds.textContent = `${Math.round(successOdds(r, n) * 100)}%`
    if (oddsLabel) oddsLabel.textContent = n === 1 ? 'chance the one step works' : `chance all ${n} steps work`
    scene?.build(n, r)
  }

  function setSteps(n: number): void {
    steps = clamp(Math.round(n), 1, 20)
    result.textContent = ''
    show(steps, reliability)
  }

  function setReliability(r: number): void {
    reliability = clamp(Math.round(r * 100), 80, 99) / 100
    result.textContent = ''
    show(steps, reliability)
  }

  async function launch(): Promise<void> {
    if (launchBtn.disabled) return
    root.classList.add('has-launched')
    lock(true)
    result.textContent = ''
    const { failedAt } = rollLaunch(reliability, steps, rand)
    try {
      await scene?.launch(failedAt)
    } finally {
      result.textContent = failedAt === null ? 'Made it!' : `Stage ${failedAt + 1} failed.`
      lock(false)
    }
  }

  function attach(s: RocketScene): void {
    scene = s
    s.build(steps, reliability)
    sceneReady()
  }

  // The one-time Show beat: stack ten 95% stages one by one while the odds count down to 60%.
  async function playIntro(): Promise<void> {
    lock(true)
    steps = DEFAULT.steps
    reliability = DEFAULT.reliability
    await Promise.race([sceneArrived, wait(INTRO.sceneWait)])
    for (let n = 0; n <= steps; n++) {
      show(n, reliability)
      await wait(n === 0 ? INTRO.hold : INTRO.perStage)
    }
    lock(false)
    root.classList.add('is-your-turn')
    await wait(INTRO.caption)
    reveal('[data-caption]')
    await wait(INTRO.hint)
    reveal('[data-hint]')
    await wait(INTRO.why)
    reveal('.why')
  }

  // Reduced motion: the ten-stage rocket at 60%, and everything revealed.
  function showAnswered(): void {
    steps = DEFAULT.steps
    reliability = DEFAULT.reliability
    show(steps, reliability)
    root.classList.add('is-your-turn')
    reveal('[data-caption]', '[data-hint]', '.why')
  }

  stepsSlider.addEventListener('input', () => setSteps(Number(stepsSlider.value)))
  reliabilitySlider.addEventListener('input', () => setReliability(Number(reliabilitySlider.value) / 100))
  launchBtn.addEventListener('click', () => void launch())

  show(steps, reliability)
  return { setSteps, setReliability, launch, playIntro, showAnswered, attach }
}
