import { describe, it, expect, vi } from 'vitest'
import { createOrangeController, type OrangeScene } from '../src/sections/orange/orangeController'
import { tokenize } from '../src/sections/orange/tokenize'
import type { Deeper } from '../src/ui/deeper'

const SECTION = `<section id="orange">
    <p data-counter>You see <span data-letters></span> <span data-letters-unit></span>. AI sees <span data-chunks></span> <span data-chunks-unit></span>.</p>
    <p data-done hidden></p>
    <p data-caption></p><p data-hint></p><div class="why"></div>
    <input data-sentence-input />
    <div data-chips></div><p data-truncated hidden></p><p data-empty-note hidden></p></section>`

function setup() {
  document.body.innerHTML = SECTION
  const deeper = { open: vi.fn(), close: vi.fn(), setSlot: vi.fn() } as unknown as Deeper
  const scene = {
    setText: vi.fn(), slice: vi.fn(() => true), autoSlice: vi.fn(() => Promise.resolve()), reset: vi.fn(),
    start: vi.fn(), stop: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
  } as unknown as OrangeScene
  const root = document.getElementById('orange') as HTMLElement
  const ctl = createOrangeController(root, deeper)
  ctl.attach(scene)
  return { root, deeper, scene, ctl }
}

const text = (root: HTMLElement, sel: string) => root.querySelector(sel)!.textContent

describe('orange controller', () => {
  it('cuts off the next token with each slice, then says that is all', async () => {
    const { root, ctl } = setup()
    await ctl.update('strawberry')
    expect(ctl.sliceNext()?.text).toBe('st')
    expect(ctl.sliceNext()?.text).toBe('raw')
    expect(ctl.sliceNext()?.text).toBe('berry')
    expect(ctl.sliceNext()).toBeNull()
    expect(text(root, '[data-letters]')).toBe('10')
    expect(text(root, '[data-chunks]')).toBe('3')
    const done = root.querySelector<HTMLElement>('[data-done]')!
    expect(done.hidden).toBe(false)
    expect(done.textContent).toBe('That’s all: 3 chunks')
  })

  it('says a one-token word has nothing to cut', async () => {
    const { root, ctl } = setup()
    await ctl.update('orange')
    expect(ctl.sliceNext()?.text).toBe('orange')
    expect(ctl.sliceNext()).toBeNull()
    const done = root.querySelector<HTMLElement>('[data-done]')!
    expect(done.hidden).toBe(false)
    expect(done.textContent).toMatch(/^That’s a single chunk, so there’s nothing to cut\./)
  })

  it('shows the empty note and slices nothing for blank input', async () => {
    const { root, ctl } = setup()
    await ctl.update('   ')
    expect(root.querySelector<HTMLElement>('[data-empty-note]')!.hidden).toBe(false)
    expect(text(root, '[data-empty-note]')).toBe('Type something to slice')
    expect(ctl.sliceNext()).toBeNull()
  })

  it('shows the truncation note and the total count for long input', async () => {
    const { root, deeper, scene, ctl } = setup()
    await ctl.update(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '))
    const note = root.querySelector<HTMLElement>('[data-truncated]')!
    expect(note.hidden).toBe(false)
    expect(note.textContent).toMatch(/first 16 of \d+ tokens/)
    const total = Number(note.textContent!.match(/of (\d+)/)![1])
    expect(deeper.setSlot).toHaveBeenLastCalledWith('orange', 'count', String(total))
    expect(scene.setText).toHaveBeenLastCalledWith(expect.any(String), 16)
  })

  it('waits for the orange to be near the screen before loading the tokenizer', async () => {
    let fire: (entries: unknown[]) => void = () => {}
    const FakeIO = vi.fn(function (this: unknown, cb: (e: unknown[]) => void) {
      fire = cb
      return { observe: vi.fn(), disconnect: vi.fn() }
    }) as unknown as typeof IntersectionObserver
    document.body.innerHTML = SECTION
    const root = document.getElementById('orange') as HTMLElement
    root.querySelector<HTMLInputElement>('[data-sentence-input]')!.value = 'hello world'
    createOrangeController(root, { setSlot: vi.fn() } as unknown as Deeper, FakeIO)
    expect(root.querySelector('[data-chips]')!.children).toHaveLength(0)
    fire([{ isIntersecting: true }])
    await vi.waitFor(() => expect(root.querySelector('[data-chips]')!.children).toHaveLength(2))
  })

  it('plays the intro: slashes oranges by itself, then reveals caption, hint and why', async () => {
    await tokenize('warm up') // the tokenizer loads before the clock is faked
    const { root, scene, ctl } = setup()
    vi.useFakeTimers()
    try {
      const done = ctl.playIntro()
      await vi.runAllTimersAsync()
      await done
    } finally {
      vi.useRealTimers()
    }
    expect(scene.setText).toHaveBeenLastCalledWith('oranges', 2)
    const calls = vi.mocked(scene.autoSlice).mock.calls.map(([t, rest]) => [t.text, rest?.text])
    expect(calls).toEqual([['or', 'anges']])
    expect(text(root, '[data-chunks]')).toBe('2')
    for (const sel of ['[data-counter]', '[data-caption]', '[data-hint]', '.why']) {
      expect(root.querySelector(sel)!.classList.contains('is-shown')).toBe(true)
    }
  })

  it('shows the answered state straight away on reduced motion', async () => {
    const { root, scene, ctl } = setup()
    ctl.showAnswered()
    for (const sel of ['[data-caption]', '[data-hint]', '.why']) {
      expect(root.querySelector(sel)!.classList.contains('is-shown')).toBe(true)
    }
    await vi.waitFor(() => expect(scene.autoSlice).toHaveBeenCalledTimes(1))
    expect(text(root, '[data-chunks]')).toBe('2')
  })
})
