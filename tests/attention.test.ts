import { describe, it, expect, vi } from 'vitest'
import { topLinks, createAttentionController, type AttentionScene } from '../src/sections/attention/attentionController'
import type { AttentionData } from '../src/data/types'
import type { Deeper } from '../src/ui/deeper'

const data: AttentionData = {
  source: 'Illustrative example.',
  sentences: [
    { text: 'a b', tokens: ['a', 'b'], weights: [[1, 0], [0.5, 0.5]] },
    {
      text: 'the cat sat',
      tokens: ['the', 'cat', 'sat'],
      weights: [[1, 0, 0], [0.2, 0.8, 0], [0.1, 0.6, 0.3]],
    },
  ],
}

function setup() {
  document.body.innerHTML = `<section id="attention">
    <button data-sentence="0"></button><button data-sentence="1"></button>
    <div data-tokens></div></section>`
  const deeper = { open: vi.fn(), close: vi.fn(), setSlot: vi.fn() } as unknown as Deeper
  const root = document.getElementById('attention') as HTMLElement
  return { root, deeper, ctl: createAttentionController(root, data, deeper) }
}

const tokenEls = () => [...document.querySelectorAll<HTMLButtonElement>('[data-tokens] button')]

describe('topLinks', () => {
  it('returns the top n other tokens by weight, descending', () => {
    expect(topLinks([[1, 0, 0], [0.2, 0.8, 0], [0.1, 0.6, 0.3]], 2, 2)).toEqual([{ j: 1, w: 0.6 }, { j: 0, w: 0.1 }])
  })

  it('returns nothing for the first token', () => {
    expect(topLinks([[1, 0, 0], [0.2, 0.8, 0], [0.1, 0.6, 0.3]], 0, 4)).toEqual([])
  })
})

describe('createAttentionController', () => {
  it('renders the selected sentence as token buttons', () => {
    const { ctl } = setup()
    ctl.select(1)
    expect(tokenEls().map((b) => b.textContent)).toEqual(['the', 'cat', 'sat'])
  })

  it('marks the focused token active and its top links linked', () => {
    const { ctl } = setup()
    ctl.select(1)
    ctl.focus(2)
    expect(tokenEls().map((b) => b.hasAttribute('data-active'))).toEqual([false, false, true])
    expect(tokenEls().map((b) => b.hasAttribute('data-linked'))).toEqual([true, true, false])
  })

  it('draws links in an attached scene', () => {
    const { ctl } = setup()
    const scene = { setSentence: vi.fn(), showLinks: vi.fn(), clearLinks: vi.fn() } as unknown as AttentionScene
    ctl.select(1)
    ctl.attach(scene)
    ctl.focus(2)
    expect(scene.showLinks).toHaveBeenCalledWith(2, [{ j: 1, w: 0.6 }, { j: 0, w: 0.1 }])
  })

  it('fills the Go deeper source slot from the data', () => {
    const { deeper } = setup()
    expect(deeper.setSlot).toHaveBeenCalledWith('attention', 'source', data.source)
  })
})
