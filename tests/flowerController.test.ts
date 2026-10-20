import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createFlowerController } from '../src/sections/flower/flowerController'
import { STEP_MS } from '../src/sections/flower/growth'
import { parseHallucination } from '../src/data/types'
import type { Deeper } from '../src/ui/deeper'

const data = parseHallucination(JSON.parse(readFileSync('public/data/generation.json', 'utf8')))
const SECTION = `<section id="flower">
  <div data-flower-stage></div>
  <p data-question></p><div data-source-card hidden><p data-source-title></p><p data-source-text></p></div>
  <p data-response></p><div data-candidates></div>
  <p data-caption></p><p data-hint></p><div class="why"></div>
  <button data-source-btn hidden>Give it a source</button></section>`

function setup() {
  document.body.innerHTML = SECTION
  const root = document.getElementById('flower') as HTMLElement
  const deeper = { open: vi.fn(), close: vi.fn(), setSlot: vi.fn() } as unknown as Deeper
  return { root, ctl: createFlowerController(root, data, deeper) }
}

afterEach(() => { vi.useRealTimers() })

describe('flower controller', () => {
  it('waits for a hold, grows an invented answer, then offers a source', async () => {
    vi.useFakeTimers()
    const { root, ctl } = setup()
    const intro = ctl.playIntro()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(root.querySelector('[data-response]')!.textContent).toBe('') // nothing grows on arrival
    ctl.hold(true)
    await vi.advanceTimersByTimeAsync(60_000)
    await intro
    const invented = data.ungrounded.steps.find((s) => s.invented)!.chosen
    expect(root.querySelector('[data-response] [data-invented]')?.textContent).toBe(invented)
    expect(root.querySelector<HTMLButtonElement>('[data-source-btn]')!.hidden).toBe(false)
  })

  it('answers from the source once grounded', () => {
    const { root, ctl } = setup()
    ctl.groundIt()
    expect(root.querySelector<HTMLElement>('[data-source-card]')!.hidden).toBe(false)
    for (let i = 0; i < data.grounded.steps.length + 2; i++) ctl.frame(STEP_MS)
    expect(root.querySelector('[data-response]')!.textContent).toBe("I can't find any record of that book.")
  })
})
