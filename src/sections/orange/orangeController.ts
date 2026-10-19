import type { SceneHandle } from '../../engine/sceneHost'
import type { Deeper } from '../../ui/deeper'
import { MAX_TOKENS } from '../../config'
import { tokenize, type Token } from './tokenize'

// What the 3D orange does with the tokens and the cut; the controller works without one.
export interface OrangeScene extends SceneHandle {
  setTokens(tokens: Token[]): void
  slice(angleDeg: number): void
  reset(): void
}

const DEBOUNCE_MS = 150

export function createOrangeController(root: HTMLElement, deeper: Deeper) {
  const input = root.querySelector<HTMLInputElement>('[data-sentence-input]') as HTMLInputElement
  const chips = root.querySelector<HTMLElement>('[data-chips]') as HTMLElement
  const note = root.querySelector<HTMLElement>('[data-truncated]') as HTMLElement
  const hint = root.querySelector<HTMLElement>('[data-hint]') as HTMLElement
  const cutButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-cut]')]
  let scene: OrangeScene | null = null
  let tokens: Token[] = []
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
    hint.textContent = 'Type something to slice'
    hint.hidden = !empty
    note.hidden = !result.truncated
    note.textContent = result.truncated ? `Showing the first ${MAX_TOKENS} of ${result.total} tokens` : ''
    cutButtons.forEach((b) => { b.disabled = empty })
    deeper.setSlot('orange', 'count', String(result.total))
    if (empty) scene?.reset()
    scene?.setTokens(tokens)
  }

  function cut(angleDeg: number): void {
    if (tokens.length === 0) return
    scene?.slice(angleDeg)
  }

  function attach(s: OrangeScene): void {
    scene = s
    s.setTokens(tokens)
  }

  let timer = 0
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => void update(input.value), DEBOUNCE_MS)
  })
  cutButtons.forEach((b) => b.addEventListener('click', () => cut(Number(b.dataset.cut))))

  void update(input.value)

  return { update, cut, attach }
}
