import type { SceneHandle } from '../../engine/sceneHost'
import type { HallucinationData, GenerationStep } from '../../data/types'
import type { Deeper } from '../../ui/deeper'
import { createGrowth, STEP_MS, type GrowthEvent } from './growth'

const CALM_PACE = STEP_MS / 850 // ~850ms a word

// What the 3D flower does; the controller works without one. One petal per word of the answer;
// `front` is the petal to turn toward the viewer (the invented word's).
export interface FlowerScene extends SceneHandle {
  setPetalCount(n: number, front?: number): void
  openPetal(i: number, invented?: boolean): void
  setHoldProgress(p: number): void
  setMood(m: 'guess' | 'grounded'): void
}

type Run = 'ungrounded' | 'grounded'

const FRAME_MS = 16
// Arrival beats, in ms: a breath before the hint; after the answer, the source button, then why.
const INTRO = { hold: 300, hint: 350, why: 350 }
// A finished answer stays put for a quick tap; only a real hold asks again.
const RESTART_MS = 250

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
  const hint = root.querySelector<HTMLElement>('[data-hint]')
  const announce = root.querySelector<HTMLElement>('[data-announce]')
  const stage = root.querySelector<HTMLElement>('[data-flower-stage]')
  const question = root.querySelector<HTMLElement>('[data-question]')
  if (question) question.textContent = data.question
  root.querySelector('[data-source-title]')?.replaceChildren(data.grounded.sourceCard.title)
  root.querySelector('[data-source-text]')?.replaceChildren(data.grounded.sourceCard.text)
  // The hint follows the answer: how to grow it, then the source button, then how to ask again.
  const HINTS = {
    start: hint?.textContent ?? '',
    source: 'Now choose “Give it a source” and watch the answer change.',
    again: 'Hold the flower to ask again, without a source.',
  }

  let scene: FlowerScene | null = null
  let failed = false // the 3D flower couldn't start
  let run: Run = 'ungrounded'
  let steps: GenerationStep[] = data.ungrounded.steps
  let growth = createGrowth(steps.length)
  let committed = 0
  let finished = false
  let holding = false
  let yourTurn = false
  let auto = false // the grounded answer (or a screen reader's activation) grows by itself
  let demo = false // the answer on screen is the reduced-motion one; a hold grows a fresh one
  let looping = false
  let restart = 0
  let waiters: { test: () => boolean; resolve: () => void }[] = []

  const noFlower = () => failed || document.documentElement.classList.contains('no-3d')

  function reveal(...selectors: string[]): void {
    for (const sel of selectors) root.querySelectorAll(sel).forEach((el) => el.classList.add('is-shown'))
  }

  function until(test: () => boolean): Promise<void> {
    if (test()) return Promise.resolve()
    return new Promise((resolve) => waiters.push({ test, resolve }))
  }

  function setHint(text: string): void {
    if (!hint) return
    hint.textContent = text
    hint.hidden = text === ''
  }

  // Five fixed slots, updated in place, so the guesses read as one steady panel rather than chips
  // that flash and jump every word.
  function showCandidates(step: number): void {
    const s = steps[step]!
    while (candidates.children.length < s.candidates.length) {
      const row = document.createElement('span')
      row.className = 'cand'
      const word = document.createElement('span')
      word.className = 'cand-word'
      const odds = document.createElement('span')
      odds.className = 'cand-p'
      row.append(word, odds)
      candidates.append(row)
    }
    const rows = [...candidates.children] as HTMLElement[]
    rows.forEach((row, i) => {
      const c = s.candidates[i]
      row.hidden = !c
      row.removeAttribute('data-chosen')
      if (!c) return
      row.style.setProperty('--p', String(c.p))
      row.querySelector('.cand-word')!.textContent = c.token
      row.querySelector('.cand-p')!.textContent = pct(c.p)
    })
    root.classList.add('has-guesses')
  }

  function choose(step: number): void {
    const s = steps[step]!
    candidates.querySelectorAll<HTMLElement>('.cand')[s.candidates.findIndex((c) => c.token === s.chosen)]?.setAttribute('data-chosen', '')
  }

  function commit(step: number): void {
    const s = steps[step]!
    choose(step)
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
      showCandidates(e.step)
    } else if (e.type === 'commit') commit(e.step)
    else {
      finished = true
      setAuto(false)
      root.classList.remove('is-growing')
      root.classList.add('is-answered')
      if (run === 'ungrounded') sourceBtn.hidden = false
      setHint(run === 'ungrounded' ? HINTS.source : noFlower() ? '' : HINTS.again)
      // One announcement for the whole answer, not one per word.
      if (announce) announce.textContent = response.textContent ?? ''
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

  // A light clock of its own, so the answer grows with or without the 3D flower.
  async function loop(): Promise<void> {
    if (looping) return
    looping = true
    let last = Date.now()
    while ((auto || holding) && !finished) {
      await wait(FRAME_MS)
      // Real elapsed time, so a busy or throttled page doesn't slow the answer down.
      const now = Date.now()
      frame(Math.min(now - last, 100) * CALM_PACE)
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
    root.classList.remove('has-guesses', 'is-answered')
    sourceCard.hidden = next !== 'grounded'
    sourceBtn.hidden = true
    root.dataset.mood = next === 'grounded' ? 'grounded' : 'guess'
    root.classList.add('is-growing')
    setHint(next === 'grounded' ? '' : HINTS.start)
    if (announce) announce.textContent = ''
    syncScene()
  }

  function syncScene(): void {
    if (!scene) return
    scene.setMood(run === 'grounded' ? 'grounded' : 'guess')
    const invented = run === 'ungrounded' ? steps.findIndex((s) => s.invented) : -1
    scene.setPetalCount(steps.length, invented >= 0 ? invented : undefined)
    for (let i = 0; i < committed; i++) scene.openPetal(i, steps[i]!.invented === true && run === 'ungrounded')
  }

  // While the flower grows by itself, the "press and hold" pill steps aside.
  function setAuto(on: boolean): void {
    auto = on
    root.classList.toggle('is-auto', on)
  }

  function attach(s: FlowerScene): void {
    scene = s
    root.classList.add('has-flower') // the pill waits for the flower it points at
    syncScene()
  }

  // The 3D flower couldn't start: unless the visitor is already growing an answer, show the
  // answered state, so the lesson still reads in text.
  function fail(): void {
    failed = true
    root.classList.add('no-flower')
    if (yourTurn && committed === 0 && !holding && !auto) showAnswered()
  }

  // Press and hold grows the answer; releasing pauses it. After a finished answer, a real hold (not
  // a quick tap) grows a fresh, unsourced one.
  function hold(on: boolean): void {
    if (!on) {
      clearTimeout(restart)
      holding = false
      root.classList.remove('is-holding')
      return
    }
    if (!yourTurn || auto || holding) return
    holding = true
    root.classList.add('is-holding')
    if (finished || demo) {
      restart = window.setTimeout(() => {
        if (!holding) return
        begin('ungrounded')
        void loop()
      }, RESTART_MS)
      return
    }
    void loop()
  }

  // A screen reader or switch activates the flower with a bare click: the answer grows by itself.
  function activate(): void {
    if (!yourTurn || auto || holding) return
    if (finished || demo) begin('ungrounded')
    setAuto(true)
    void loop()
  }

  // "Give it a source": the flower regrows, cooler, with the source card beside it, by itself.
  function groundIt(): void {
    clearTimeout(restart)
    holding = false
    root.classList.remove('is-holding')
    begin('grounded')
    setAuto(true)
    void loop()
  }

  // On arrival: the question, a closed bud and "press and hold". The visitor's own hold grows the
  // answer about a book that doesn't exist; the caption lands right after the invented author, then
  // the source button and why once it's done. With no 3D flower, the answered state instead.
  async function playIntro(): Promise<void> {
    if (noFlower()) return showAnswered()
    await wait(INTRO.hold)
    if (noFlower()) return showAnswered() // it failed to start meanwhile
    begin('ungrounded')
    reveal('[data-hint]')
    yourTurn = true
    root.classList.add('is-your-turn')
    const invented = steps.findIndex((s) => s.invented)
    await until(() => committed > invented || run !== 'ungrounded')
    reveal('[data-caption]')
    await until(() => finished || run !== 'ungrounded')
    await wait(INTRO.hint)
    reveal('.flower-controls')
    await wait(INTRO.why)
    reveal('.why')
  }

  // Reduced motion (or no 3D flower): the full, invented answer straight away.
  function showAnswered(): void {
    clearTimeout(restart)
    holding = false
    begin('ungrounded')
    setAuto(true)
    while (!finished) frame(STEP_MS)
    const invented = steps.findIndex((s) => s.invented)
    showCandidates(invented)
    choose(invented)
    demo = true
    reveal('[data-caption]', '[data-hint]', '.flower-controls', '.why')
    yourTurn = true
    root.classList.add('is-your-turn')
  }

  sourceBtn.addEventListener('click', groundIt)

  // A hold only counts while the flower is on screen and the page has focus.
  const release = () => hold(false)
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio < 0.25)) release()
    }, { threshold: [0, 0.25] }).observe(root)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) release() })
  window.addEventListener('blur', release)

  // The stage lets a vertical swipe scroll the page (touch-action: pan-y); the browser then cancels
  // the pointer, which lets go of the hold.
  if (stage) {
    let pointer: number | null = null
    let captured = false
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointer !== null) return // the primary button, one pointer at a time
      pointer = e.pointerId
      try { stage.setPointerCapture(e.pointerId); captured = true } catch { captured = false }
      hold(true)
    })
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      hold(false)
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) stage.addEventListener(type, up)
    stage.addEventListener('pointerleave', (e) => { if (!captured) up(e) })
    stage.addEventListener('click', (e) => { if (e.detail === 0) activate() })
    stage.addEventListener('contextmenu', (e) => e.preventDefault())
    stage.addEventListener('selectstart', (e) => e.preventDefault())
    const key = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'
    stage.addEventListener('keydown', (e) => {
      if (!key(e)) return
      e.preventDefault()
      if (!e.repeat) hold(true)
    })
    stage.addEventListener('keyup', (e) => { if (key(e)) hold(false) })
    stage.addEventListener('blur', release)
  }

  return { hold, frame, groundIt, playIntro, showAnswered, attach, fail }
}
