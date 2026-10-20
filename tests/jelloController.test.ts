import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createJelloController, type JelloScene } from '../src/sections/jello/jelloController'
import { wobbleParams } from '../src/sections/jello/wobble'
import { parseTemperature } from '../src/data/types'
import type { Deeper } from '../src/ui/deeper'

const data = parseTemperature(JSON.parse(readFileSync('public/data/temperature.json', 'utf8')))
const SECTION = `<section id="jello">
  <div data-jello-stage></div>
  <p data-caption></p><p data-hint></p>
  <output data-temperature-value></output>
  <input type="range" min="0" max="4" step="1" value="0" data-temperature-slider />
  <span data-prompt></span><p data-answer></p>
  <div class="why"></div></section>`

function setup() {
  document.body.innerHTML = SECTION
  const root = document.getElementById('jello') as HTMLElement
  const deeper = { open: vi.fn(), close: vi.fn(), setSlot: vi.fn() } as unknown as Deeper
  const scene = { setParams: vi.fn(), poke: vi.fn(), start: vi.fn(), stop: vi.fn(), resize: vi.fn(), dispose: vi.fn() } satisfies JelloScene
  const ctl = createJelloController(root, data, deeper)
  ctl.attach(scene)
  scene.setParams.mockClear()
  return { root, ctl, scene }
}
const answer = (root: HTMLElement) => root.querySelector('[data-answer]')!.textContent

afterEach(() => { vi.useRealTimers() })

describe('jello controller', () => {
  it('shows the hottest answer and wobble at stop 4', () => {
    const { root, ctl, scene } = setup()
    ctl.setStop(4)
    expect(answer(root)).toBe(data.samples[4]!.text)
    expect(scene.setParams).toHaveBeenLastCalledWith(wobbleParams(2), 4)
  })

  it('follows the slider', () => {
    const { root } = setup()
    const slider = root.querySelector<HTMLInputElement>('[data-temperature-slider]')!
    slider.value = '2'
    slider.dispatchEvent(new Event('input'))
    expect(answer(root)).toBe(data.samples[2]!.text)
  })

  it('pokes it stiff, then wild, then reveals the lesson', async () => {
    vi.useFakeTimers()
    const { root, ctl, scene } = setup()
    const intro = ctl.playIntro()
    await vi.advanceTimersByTimeAsync(10_000)
    await intro
    expect(scene.setParams.mock.calls.map((c) => c[1])).toEqual([0, 4])
    expect(scene.setParams.mock.calls[0]![0]).toEqual(wobbleParams(0))
    expect(scene.setParams.mock.calls[1]![0]).toEqual(wobbleParams(2))
    expect(scene.poke).toHaveBeenCalledTimes(2)
    for (const sel of ['[data-caption]', '[data-hint]', '.why']) expect(root.querySelector(sel)!.classList.contains('is-shown')).toBe(true)
  })
})
