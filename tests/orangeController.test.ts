import { describe, it, expect, vi } from 'vitest'
import { createOrangeController, type OrangeScene } from '../src/sections/orange/orangeController'
import type { Deeper } from '../src/ui/deeper'

function setup() {
  document.body.innerHTML = `<section id="orange">
    <input data-sentence-input />
    <div data-chips></div><p data-truncated hidden></p><p data-hint hidden></p>
    <div data-cuts><button data-cut="0"></button><button data-cut="45"></button></div></section>`
  const deeper = { open: vi.fn(), close: vi.fn(), setSlot: vi.fn() } as unknown as Deeper
  const scene = { setTokens: vi.fn(), slice: vi.fn(), reset: vi.fn(), dispose: vi.fn() } as unknown as OrangeScene
  const root = document.getElementById('orange') as HTMLElement
  const ctl = createOrangeController(root, deeper)
  ctl.attach(scene)
  return { root, deeper, scene, ctl }
}

describe('orange controller', () => {
  it('shows the hint and disables cutting for blank input', async () => {
    const { root, scene, ctl } = setup()
    await ctl.update('   ')
    expect(root.querySelector<HTMLElement>('[data-hint]')!.hidden).toBe(false)
    expect(root.querySelector('[data-hint]')!.textContent).toBe('Type something to slice')
    ctl.cut(0)
    expect(scene.slice).not.toHaveBeenCalled()
  })

  it('shows the truncation note and the total count for long input', async () => {
    const { root, deeper, scene, ctl } = setup()
    await ctl.update(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '))
    const note = root.querySelector<HTMLElement>('[data-truncated]')!
    expect(note.hidden).toBe(false)
    expect(note.textContent).toMatch(/first 16 of \d+ tokens/)
    const total = Number(note.textContent!.match(/of (\d+)/)![1])
    expect(deeper.setSlot).toHaveBeenLastCalledWith('orange', 'count', String(total))
    expect(scene.setTokens).toHaveBeenCalled()
    ctl.cut(45)
    expect(scene.slice).toHaveBeenCalledWith(45)
  })
})
