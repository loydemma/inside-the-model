import { describe, it, expect, vi } from 'vitest'
import { createRocketController, type RocketScene } from '../src/sections/rocket/rocketController'
import type { Deeper } from '../src/ui/deeper'

const SECTION = `<section id="rocket">
  <p data-caption></p><p data-hint></p>
  <output data-steps-value></output><input type="range" min="1" max="20" value="10" data-steps-slider />
  <output data-reliability-value></output><input type="range" min="80" max="99" value="95" data-reliability-slider />
  <p data-odds></p><span data-odds-label></span>
  <button data-launch>Launch</button><p data-result></p>
  <div class="why"></div></section>`

function setup(rand?: () => number) {
  document.body.innerHTML = SECTION
  const root = document.getElementById('rocket') as HTMLElement
  const deeper = { open: vi.fn(), close: vi.fn(), setSlot: vi.fn() } as unknown as Deeper
  const scene = {
    build: vi.fn(), launch: vi.fn(async () => {}), reset: vi.fn(),
    start: vi.fn(), stop: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
  } satisfies RocketScene
  const ctl = createRocketController(root, deeper, rand)
  ctl.attach(scene)
  return { root, ctl, scene }
}
const text = (root: HTMLElement, sel: string) => root.querySelector(sel)!.textContent

describe('rocket controller', () => {
  it('shows 60% for ten 95% steps, and 95% for one', () => {
    const { root, ctl } = setup()
    expect(text(root, '[data-odds]')).toBe('60%')
    ctl.setSteps(1)
    expect(text(root, '[data-odds]')).toBe('95%')
  })

  it('launches, and names the stage that failed', async () => {
    const rolls = [0.1, 0.1, 0.97]
    const { root, ctl, scene } = setup(() => rolls.shift() ?? 0.1)
    await ctl.launch()
    expect(scene.launch).toHaveBeenCalledWith(2)
    expect(text(root, '[data-result]')).toBe('Stage 3 failed.')
  })
})
