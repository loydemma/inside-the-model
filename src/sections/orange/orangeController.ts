import type { SceneHandle } from '../../engine/sceneHost'
import type { Deeper } from '../../ui/deeper'
import { MAX_TOKENS } from '../../config'
import { tokenize, type Token } from './tokenize'

type Vec2 = { x: number; y: number }

// What the 3D orange does; the controller works without one. `slice` takes a drag in normalized
// device coords of the section canvas and cuts off `label`; `rest`, when given, labels the piece
// that is left (the last token). Both return false/do nothing when the line misses the orange.
export interface OrangeScene extends SceneHandle {
  setText(text: string, tokenCount: number): void
  slice(start: Vec2, end: Vec2, label: Token, rest?: Token): boolean
  autoSlice(label: Token, rest?: Token): Promise<void>
  reset(): void
}

const DEBOUNCE_MS = 150
const DEFAULT_WORD = 'oranges'
const DRAG_PX = 30
// Arrival beats, in ms: the whole orange holds under the question, then the hint and the input come in.
const INTRO = { sceneWait: 2500, hold: 300 }
const AUTO_MS = 550 // a slash's length when there is no scene to wait for

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`)

export function createOrangeController(
  root: HTMLElement,
  deeper: Deeper,
  io: typeof IntersectionObserver | undefined = globalThis.IntersectionObserver,
) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel) as T
  const input = $<HTMLInputElement>('[data-sentence-input]')
  const chips = $('[data-chips]')
  const note = $('[data-truncated]')
  const emptyNote = $('[data-empty-note]')
  const letters = $('[data-letters]')
  const lettersUnit = root.querySelector<HTMLElement>('[data-letters-unit]')
  const chunks = $('[data-chunks]')
  const chunksUnit = root.querySelector<HTMLElement>('[data-chunks-unit]')
  const done = $('[data-done]')
  const stage = root.querySelector<HTMLElement>('[data-orange-stage]')
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')
  let scene: OrangeScene | null = null
  let text = ''
  let tokens: Token[] = []
  let cut = 0 // tokens cut off so far
  let demo = false // the orange on screen is the intro's, finished; a drag starts a fresh one
  let log: [Token, Token | undefined][] = [] // auto slices, replayed for a scene that attaches late
  let latest = 0
  let sceneReady: () => void = () => {}
  const sceneArrived = new Promise<void>((resolve) => { sceneReady = resolve })

  function render(): void {
    const n = [...text].filter((c) => !/\s/.test(c)).length
    letters.textContent = String(n)
    if (lettersUnit) lettersUnit.textContent = plural(n, 'letter')
    chunks.textContent = String(cut)
    if (chunksUnit) chunksUnit.textContent = plural(cut, 'chunk')
    const all = tokens.length > 0 && cut === tokens.length
    done.hidden = !all || demo
    // One token: the knife has nothing to cut, so say why rather than leave the orange whole silently.
    const one =
      'That’s a single chunk, so there’s nothing to cut. Words that were common in the text the tokenizer ' +
      'was built from get a chunk of their own; rarer words are pieced together from smaller chunks. ' +
      'Try a longer word or a sentence.'
    done.textContent = all ? (cut === 1 ? one : `That’s all: ${cut} ${plural(cut, 'chunk')}`) : ''
  }

  async function update(next: string): Promise<void> {
    const run = ++latest
    const result = await tokenize(next.trim() ? next : '')
    if (run !== latest) return // a newer keystroke already took over
    text = next
    tokens = result.tokens
    cut = 0
    demo = false
    log = []
    const empty = tokens.length === 0
    chips.replaceChildren(
      ...tokens.map((t) => {
        const chip = document.createElement('span')
        chip.className = 'chip'
        chip.textContent = t.text
        return chip
      }),
    )
    emptyNote.textContent = 'Type something to slice'
    emptyNote.hidden = !empty
    note.hidden = !result.truncated
    note.textContent = result.truncated ? `Showing the first ${MAX_TOKENS} of ${result.total} tokens` : ''
    deeper.setSlot('orange', 'count', String(result.total))
    render()
    scene?.setText(text, tokens.length)
    // With no 3D there is nothing to slice, so show the answer straight away.
    if (document.documentElement.classList.contains('no-3d')) while (sliceNext());
  }

  // The next token comes off. Returns null once every token is off.
  function sliceNext(): Token | null {
    const t = tokens[cut]
    if (!t) return null
    cut++
    render()
    root.classList.add('has-cut')
    root.querySelector('[data-counter]')?.classList.add('is-shown')
    if (cut === tokens.length) reveal('[data-caption]', '.why')
    return t
  }

  // The token to cut off next, and the last one when only it will be left.
  function next(): [Token, Token | undefined] | null {
    const t = tokens[cut]
    if (!t) return null
    return [t, cut === tokens.length - 2 ? tokens[cut + 1] : undefined]
  }

  async function autoCut(): Promise<void> {
    const n = next()
    if (!n) return
    sliceNext()
    if (n[1]) sliceNext()
    log.push(n)
    if (scene) await scene.autoSlice(...n)
    else await wait(AUTO_MS)
  }

  function attach(s: OrangeScene): void {
    scene = s
    s.setText(text, tokens.length)
    for (const n of log) void s.autoSlice(...n)
    sceneReady()
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

  // On arrival: the whole orange, the knife and the instruction. Nothing is cut until the visitor
  // slices (Emma); the counter lands on the first cut, the caption and why once the word is all cut.
  async function playIntro(): Promise<void> {
    try {
      await loadDefault()
      if (!document.documentElement.classList.contains('no-3d')) {
        await Promise.race([sceneArrived, wait(INTRO.sceneWait)])
      }
    } catch {
      started = false // the tokenizer failed to download; the text still teaches the lesson
      reveal('[data-caption]', '.why')
    }
    await wait(INTRO.hold)
    reveal('[data-hint]', '.orange-controls')
    root.classList.add('is-your-turn')
  }

  // Reduced motion: the answered state straight away (the scene snaps its slices).
  function showAnswered(): void {
    // The orange arrives already cut, so the hint offers a fresh one rather than the first cut.
    const hint = root.querySelector('[data-hint]')
    if (hint) hint.textContent = 'Your turn: drag your knife across the orange to slice a fresh one yourself.'
    reveal('[data-counter]', '[data-caption]', '[data-hint]', '.orange-controls', '.why')
    loadDefault().then(
      async () => {
        demo = true
        while (next() && demo) await autoCut()
        render()
      },
      () => { started = false },
    )
  }

  // A drag on the orange: you choose where to cut, the tokenizer decides what comes off.
  function dragCut(start: Vec2, end: Vec2): void {
    const n = next()
    if (!scene || !n) return
    if (scene.slice(start, end, ...n)) {
      sliceNext()
      if (n[1]) sliceNext()
    }
  }

  // The intro's orange is all cut; your first drag starts a fresh one to slice yourself.
  function freshAfterDemo(): void {
    if (!demo) return
    demo = false
    cut = 0
    log = []
    render()
    scene?.setText(text, tokens.length)
  }

  let timer = 0
  input.addEventListener('input', () => {
    if (!started) return start()
    clearTimeout(timer)
    timer = window.setTimeout(() => void update(input.value).catch(() => {}), DEBOUNCE_MS)
  })
  input.addEventListener('focus', start)
  // Keyboard: Enter slices the next token off along a preset line.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    freshAfterDemo()
    void autoCut()
  })

  const observer = io
    ? new io((entries) => { if (entries.some((e) => e.isIntersecting)) start() }, { rootMargin: '100% 0px' })
    : null
  observer?.observe(root)

  // Only the stage captures touch (touch-action: none there), so the page still scrolls elsewhere.
  const ndc = (e: PointerEvent): Vec2 => {
    const r = (canvas ?? stage!).getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 }
  }
  let down: { x: number; y: number; id: number; at: Vec2 } | null = null
  stage?.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, at: ndc(e) }
    freshAfterDemo()
    try {
      stage.setPointerCapture(e.pointerId) // so a drag that ends off the stage still counts
    } catch {
      // the pointer is already gone; the drag simply won't be captured
    }
  })
  stage?.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return
    const from = down
    down = null
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > DRAG_PX) dragCut(from.at, ndc(e))
  })
  stage?.addEventListener('pointercancel', () => { down = null })

  return { update, sliceNext, attach, playIntro, showAnswered }
}
