import type { SceneHandle } from '../../engine/sceneHost'
import type { HallucinationData, GenerationStep } from '../../data/types'
import type { Deeper } from '../../ui/deeper'
import { createGrowth, STEP_MS, type GrowthEvent } from './growth'

const INTRO_PACE = STEP_MS / 290 // ~290ms a word
const CALM_PACE = STEP_MS / 850 // ~850ms a word

// What the flower does; the controller works without one. One petal per word of the answer.
export interface FlowerScene extends SceneHandle {
  setPetalCount(n: number): void
  openPetal(i: number, invented?: boolean): void
  setHoldProgress(p: number): void
  setMood(m: 'guess' | 'grounded'): void
  reset(): void
}

type Run = 'ungrounded' | 'grounded'

const FRAME_MS = 16
// Intro beats, in ms: wait for the flower (briefly), a breath, then it grows by itself.
const INTRO = { sceneWait: 2500, hold: 300, hint: 350, why: 350 }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const pct = (p: number) => (p >= 0.01 ? `${Math.round(p * 100)}%` : '<1%')
// Punctuation sticks to the word before it.
const glued = (word: string) => /^[.,!?;:]/.test(word)

export function createFlowerController(root: HTMLElement, data: HallucinationData, _deeper: Deeper) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel) as T
  const response = $('[data-response]')
  const candidates = $('[data-candidates]')
  const sourceCard = $('[data-source-card]')
  const sourceBtn = $<HTMLButtonElement>('[data-source-btn]')
  const stage = root.querySelector<HTMLElement>('[data-flower-stage]')
  const question = root.querySelector<HTMLElement>('[data-question]')
  if (question) question.textContent = data.question
  root.querySelector('[data-source-title]')?.replaceChildren(data.grounded.sourceCard.title)
  root.querySelector('[data-source-text]')?.replaceChildren(data.grounded.sourceCard.text)

  let scene: FlowerScene | null = null
  let run: Run = 'ungrounded'
  let steps: GenerationStep[] = data.ungrounded.steps
  let growth = createGrowth(steps.length)
  let committed = 0
  let finished = false
  let holding = false
  let auto = false // the intro and the grounded answer grow by themselves
  let demo = false // the answer on screen is the intro's; a hold grows a fresh one
  let looping = false
  let waiters: { test: () => boolean; resolve: () => void }[] = []
  let sceneReady: () => void = () => {}
  const sceneArrived = new Promise<void>((resolve) => { sceneReady = resolve })

  function reveal(...selectors: string[]): void {
    for (const sel of selectors) root.querySelectorAll(sel).forEach((el) => el.classList.add('is-shown'))
  }

  function until(test: () => boolean): Promise<void> {
    if (test()) return Promise.resolve()
    return new Promise((resolve) => waiters.push({ test, resolve }))
  }

  function showCandidates(step: number): void {
    const s = steps[step]!
    candidates.replaceChildren(
      ...s.candidates.map((c) => {
        const row = document.createElement('span')
        row.className = 'cand'
        row.style.setProperty('--p', String(c.p))
        const word = document.createElement('span')
        word.className = 'cand-word'
        word.textContent = c.token
        const odds = document.createElement('span')
        odds.className = 'cand-p'
        odds.textContent = pct(c.p)
        row.append(word, odds)
        return row
      }),
    )
    candidates.classList.add('is-live')
  }

  function commit(step: number): void {
    const s = steps[step]!
    const chosen = candidates.querySelectorAll<HTMLElement>('.cand')[s.candidates.findIndex((c) => c.token === s.chosen)]
    chosen?.setAttribute('data-chosen', '')
    candidates.classList.add('has-choice')
    if (step > 0 && !glued(s.chosen)) response.append(' ')
    const word = document.createElement('span')
    word.className = 'word'
    word.textContent = s.chosen
    if (s.invented && run === 'ungrounded') word.setAttribute('data-invented', '')
    response.append(word)
    committed = step + 1
    scene?.openPetal(step, s.invented === true && run === 'ungrounded')
  }

  function handle(e: GrowthEvent): void {
    if (e.type === 'candidates') {
      candidates.classList.remove('has-choice')
      showCandidates(e.step)
    } else if (e.type === 'commit') commit(e.step)
    else {
      finished = true
      auto = false
      root.classList.remove('is-growing')
      if (run === 'ungrounded') sourceBtn.hidden = false
    }
  }

  function frame(dtMs: number): void {
    const go = auto || holding
    for (const e of growth.tick(dtMs, go)) handle(e)
    const p = growth.progress() * steps.length - committed
    scene?.setHoldProgress(go && !finished ? Math.max(0, Math.min(1, p)) : 0)
    const ready = waiters.filter((w) => w.test())
    waiters = waiters.filter((w) => !ready.includes(w))
    for (const w of ready) w.resolve()
  }

  // A light clock of its own, so the answer grows with or without the flower.
  async function loop(): Promise<void> {
    if (looping) return
    looping = true
    let last = Date.now()
    while ((auto || holding) && !finished) {
      await wait(FRAME_MS)
      // Real elapsed time, so a busy or throttled page doesn't slow the answer down.
      const now = Date.now()
      // The intro hurries so the invented author lands within ~3s; your own answers grow at a readable pace.
      const pace = auto && run === 'ungrounded' ? INTRO_PACE : CALM_PACE
      frame(Math.min(now - last, 100) * pace)
      last = now
    }
    looping = false
  }

  function begin(next: Run): void {
    run = next
    steps = next === 'grounded' ? data.grounded.steps : data.ungrounded.steps
    growth = createGrowth(steps.length)
    committed = 0
    finished = false
    demo = false
    response.replaceChildren()
    candidates.replaceChildren()
    candidates.classList.remove('is-live', 'has-choice')
    sourceCard.hidden = next !== 'grounded'
    sourceBtn.hidden = true
    root.dataset.mood = next === 'grounded' ? 'grounded' : 'guess'
    root.classList.add('is-growing')
    syncScene()
  }

  function syncScene(): void {
    if (!scene) return
    scene.setMood(run === 'grounded' ? 'grounded' : 'guess')
    scene.setPetalCount(steps.length)
    for (let i = 0; i < committed; i++) scene.openPetal(i, steps[i]!.invented === true && run === 'ungrounded')
  }

  function attach(s: FlowerScene): void {
    scene = s
    syncScene()
    sceneReady()
  }

  // Press and hold grows the answer; releasing pauses it. After a finished answer (or the intro's),
  // a new hold grows a fresh, unsourced one.
  function hold(on: boolean): void {
    if (on && (auto || holding)) return
    if (!on) { holding = false; return }
    if (finished || demo) begin('ungrounded')
    holding = true
    void loop()
  }

  // "Give it a source": the flower regrows, cooler, with the source card beside it, by itself.
  function groundIt(): void {
    holding = false
    begin('grounded')
    auto = true
    void loop()
  }

  function reset(): void {
    holding = false
    auto = false
    begin('ungrounded')
    root.classList.remove('is-growing')
  }

  // The one-time Show beat: the flower answers a question about a book that doesn't exist, by
  // itself. The caption lands right after the invented author; hint and why once it's done.
  async function playIntro(): Promise<void> {
    await Promise.race([sceneArrived, wait(INTRO.sceneWait)])
    await wait(INTRO.hold)
    begin('ungrounded')
    auto = true
    void loop()
    const invented = steps.findIndex((s) => s.invented)
    await until(() => committed > invented || run !== 'ungrounded')
    reveal('[data-caption]')
    await until(() => finished || run !== 'ungrounded')
    demo = run === 'ungrounded'
    await wait(INTRO.hint)
    reveal('[data-hint]', '.flower-controls')
    await wait(INTRO.why)
    reveal('.why')
  }

  // Reduced motion: the full, invented answer straight away.
  function showAnswered(): void {
    begin('ungrounded')
    auto = true
    while (!finished) frame(STEP_MS)
    const invented = steps.findIndex((s) => s.invented)
    showCandidates(invented)
    candidates.querySelectorAll('.cand')[steps[invented]!.candidates.findIndex((c) => c.token === steps[invented]!.chosen)]?.setAttribute('data-chosen', '')
    candidates.classList.add('has-choice')
    demo = true
    reveal('[data-caption]', '[data-hint]', '.flower-controls', '.why')
  }

  sourceBtn.addEventListener('click', groundIt)

  // Only the stage captures touch (touch-action: none there), so the page still scrolls elsewhere.
  if (stage) {
    stage.addEventListener('pointerdown', (e) => {
      try { stage.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      hold(true)
    })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) stage.addEventListener(type, () => hold(false))
    stage.addEventListener('contextmenu', (e) => e.preventDefault())
    const key = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'
    stage.addEventListener('keydown', (e) => {
      if (!key(e)) return
      e.preventDefault()
      if (!e.repeat) hold(true)
    })
    stage.addEventListener('keyup', (e) => { if (key(e)) hold(false) })
    stage.addEventListener('blur', () => hold(false))
  }

  return { hold, frame, groundIt, reset, playIntro, showAnswered, attach }
}
