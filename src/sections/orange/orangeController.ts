import type { SceneHandle } from '../../engine/sceneHost'
import type { Deeper } from '../../ui/deeper'
import { MAX_TOKENS } from '../../config'
import { tokenize, type Token } from './tokenize'
import { nearestAngle } from './nearestAngle'

// What the 3D orange does with the tokens and the cut; the controller works without one.
export interface OrangeScene extends SceneHandle {
  setTokens(tokens: Token[]): void
  slice(angleDeg: number): void
  reset(): void
}

const DEBOUNCE_MS = 150
const DEFAULT_WORD = 'strawberry'
const SWIPE_PX = 40
// Intro beats, in ms: the whole orange holds under the question, slices (~900ms), then the
// caption, the hint and the why lines come in one after another.
const INTRO = { hold: 400, caption: 900, hint: 450, why: 450 }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createOrangeController(
  root: HTMLElement,
  deeper: Deeper,
  io: typeof IntersectionObserver | undefined = globalThis.IntersectionObserver,
) {
  const input = root.querySelector<HTMLInputElement>('[data-sentence-input]') as HTMLInputElement
  const chips = root.querySelector<HTMLElement>('[data-chips]') as HTMLElement
  const note = root.querySelector<HTMLElement>('[data-truncated]') as HTMLElement
  const emptyNote = root.querySelector<HTMLElement>('[data-empty-note]') as HTMLElement
  const cutButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-cut]')]
  const stage = root.querySelector<HTMLElement>('[data-orange-stage]')
  let scene: OrangeScene | null = null
  let tokens: Token[] = []
  let cutAngle: number | null = null // the current cut, so a scene that attaches late can catch up
  let latest = 0

  async function update(text: string): Promise<void> {
    const run = ++latest
    const result = await tokenize(text.trim() ? text : '')
    if (run !== latest) return // a newer keystroke already took over
    tokens = result.tokens
    const empty = tokens.length === 0
    chips.replaceChildren(
      ...tokens.map((t) => {
        const chip = document.createElement('span')
        chip.className = 'chip'
        chip.append(t.text)
        const id = document.createElement('small')
        id.textContent = String(t.id)
        chip.append(id)
        return chip
      }),
    )
    emptyNote.textContent = 'Type something to slice'
    emptyNote.hidden = !empty
    note.hidden = !result.truncated
    note.textContent = result.truncated ? `Showing the first ${MAX_TOKENS} of ${result.total} tokens` : ''
    cutButtons.forEach((b) => { b.disabled = empty })
    deeper.setSlot('orange', 'count', String(result.total))
    cutAngle = null
    if (empty) scene?.reset()
    scene?.setTokens(tokens)
  }

  function cut(angleDeg: number): void {
    if (tokens.length === 0) return
    cutAngle = angleDeg
    scene?.slice(angleDeg)
  }

  function attach(s: OrangeScene): void {
    scene = s
    s.setTokens(tokens)
    if (cutAngle !== null) s.slice(cutAngle)
  }

  // The tokenizer is a big download, so it waits until the orange is near the screen
  // or the user touches the input, whichever comes first.
  let started = false
  function start(): void {
    if (started) return
    started = true
    observer?.disconnect()
    update(input.value).catch(() => { started = false }) // retry on the next focus or keystroke
  }

  function reveal(...selectors: string[]): void {
    for (const sel of selectors) root.querySelectorAll(sel).forEach((el) => el.classList.add('is-shown'))
  }

  // Tokenize the default word ourselves, so a near-screen start doesn't run a second, racing update.
  function loadDefault(): Promise<void> {
    started = true
    observer?.disconnect()
    input.value = DEFAULT_WORD
    return update(DEFAULT_WORD)
  }

  // The one-time Show beat on first arrival: the orange slices strawberry by itself, then the
  // caption, the hint (with the input) and the why lines appear.
  async function playIntro(): Promise<void> {
    try {
      await loadDefault()
      await wait(INTRO.hold)
      cut(0)
    } catch {
      started = false // the tokenizer failed to download; the text still teaches the lesson
    }
    await wait(INTRO.caption)
    reveal('[data-caption]')
    await wait(INTRO.hint)
    reveal('[data-hint]', '.orange-controls')
    await wait(INTRO.why)
    reveal('.why')
  }

  // Reduced motion: the answered state straight away.
  function showAnswered(): void {
    reveal('[data-caption]', '[data-hint]', '.orange-controls', '.why')
    loadDefault().then(() => cut(0), () => { started = false })
  }

  let timer = 0
  input.addEventListener('input', () => {
    if (!started) return start()
    clearTimeout(timer)
    timer = window.setTimeout(() => void update(input.value), DEBOUNCE_MS)
  })
  input.addEventListener('focus', start)
  cutButtons.forEach((b) => {
    b.disabled = true
    b.addEventListener('click', () => cut(Number(b.dataset.cut)))
  })

  const observer = io
    ? new io((entries) => { if (entries.some((e) => e.isIntersecting)) start() }, { rootMargin: '100% 0px' })
    : null
  observer?.observe(root)

  // A swipe across the orange cuts it along the nearest allowed angle. Only the stage captures
  // touch (touch-action: none there), so the page still scrolls everywhere else.
  let down: { x: number; y: number; id: number } | null = null
  stage?.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId }
    stage.setPointerCapture(e.pointerId) // so a swipe that ends off the stage still counts
  })
  stage?.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    down = null
    if (Math.hypot(dx, dy) > SWIPE_PX) cut(nearestAngle(dx, dy))
  })
  stage?.addEventListener('pointercancel', () => { down = null })

  return { update, cut, attach, playIntro, showAnswered }
}
