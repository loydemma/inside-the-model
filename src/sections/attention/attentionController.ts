import type { AttentionData } from '../../data/types'
import type { SceneHandle } from '../../engine/sceneHost'
import type { Deeper } from '../../ui/deeper'

export type Link = { j: number; w: number }

// What the 3D scene does with the selection; the controller works without one.
export interface AttentionScene extends SceneHandle {
  setSentence(tokens: string[]): void
  showLinks(from: number, links: Link[]): void
  clearLinks(): void
}

const LINKS_SHOWN = 4
const HOLD_MS = 250

// The n other tokens that token i weighs most, strongest first.
export function topLinks(weights: number[][], i: number, n: number): Link[] {
  return (weights[i] ?? [])
    .map((w, j) => ({ j, w }))
    .filter((l) => l.j !== i && l.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
}

export function createAttentionController(root: HTMLElement, data: AttentionData, deeper: Deeper) {
  const pills = [...root.querySelectorAll<HTMLButtonElement>('[data-sentence]')]
  const row = root.querySelector<HTMLElement>('[data-tokens]') as HTMLElement
  let sentence = 0
  let focused: number | null = null
  let scene: AttentionScene | null = null

  deeper.setSlot('attention', 'source', data.source)

  const tokens = () => [...row.querySelectorAll<HTMLButtonElement>('button')]

  function focus(token: number | null): void {
    focused = token
    const links = token === null ? [] : topLinks(data.sentences[sentence]!.weights, token, LINKS_SHOWN)
    const strongest = links[0]?.w ?? 1
    tokens().forEach((b, i) => {
      b.toggleAttribute('data-active', i === token)
      const link = links.find((l) => l.j === i)
      b.toggleAttribute('data-linked', !!link)
      if (link) b.style.setProperty('--w', (link.w / strongest).toFixed(2))
      else b.style.removeProperty('--w')
    })
    if (token === null) scene?.clearLinks()
    else scene?.showLinks(token, links)
  }

  function select(index: number): void {
    sentence = index
    pills.forEach((p, i) => p.setAttribute('aria-pressed', String(i === index)))
    const words = data.sentences[index]!.tokens
    row.replaceChildren(
      ...words.map((text, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'token'
        b.textContent = text
        b.dataset.token = String(i)
        return b
      }),
    )
    scene?.setSentence(words)
    focus(null)
  }

  function attach(s: AttentionScene): void {
    scene = s
    s.setSentence(data.sentences[sentence]!.tokens)
    focus(focused)
  }

  pills.forEach((p) => p.addEventListener('click', () => select(Number(p.dataset.sentence))))

  // Mouse: hover a token. Keyboard: focus it. Touch: press and hold it.
  const indexOf = (e: Event): number | null => {
    const b = (e.target as Element).closest<HTMLElement>('[data-token]')
    return b ? Number(b.dataset.token) : null
  }
  let hold = 0
  row.addEventListener('pointerover', (e) => {
    const i = indexOf(e)
    if (e.pointerType === 'mouse' && i !== null) focus(i)
  })
  row.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') focus(null) })
  row.addEventListener('pointerdown', (e) => {
    const i = indexOf(e)
    if (e.pointerType === 'mouse' || i === null) return
    clearTimeout(hold)
    hold = window.setTimeout(() => focus(i), HOLD_MS)
  })
  const cancelHold = () => clearTimeout(hold)
  row.addEventListener('pointerup', cancelHold)
  row.addEventListener('pointercancel', cancelHold)
  row.addEventListener('focusin', (e) => { const i = indexOf(e); if (i !== null) focus(i) })
  row.addEventListener('focusout', (e) => { if (!row.contains(e.relatedTarget as Node | null)) focus(null) })
  // A long press would otherwise open the text menu on phones.
  row.addEventListener('contextmenu', (e) => e.preventDefault())

  select(0)

  return { select, focus, attach }
}
