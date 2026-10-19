import { describe, it, expect, vi } from 'vitest'
import { onFirstArrival } from '../src/engine/arrival'

type Entry = { target: Element; isIntersecting: boolean; intersectionRatio: number }
let fire: (entries: Entry[]) => void
let disconnected = false

class FakeIO {
  constructor(cb: (entries: Entry[]) => void) { fire = cb; disconnected = false }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { disconnected = true }
}
const io = FakeIO as unknown as typeof IntersectionObserver
const el = document.createElement('section')
const entry = (ratio: number): Entry => ({ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio })

describe('onFirstArrival', () => {
  it('runs once, only after the element is at least half visible', () => {
    const run = vi.fn()
    onFirstArrival(el, run, { io })
    fire([entry(0.3)])
    expect(run).not.toHaveBeenCalled()
    fire([entry(0.6)])
    fire([entry(0.9)])
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('does not run after the disposer is called', () => {
    const run = vi.fn()
    const dispose = onFirstArrival(el, run, { io })
    dispose()
    expect(disconnected).toBe(true)
    fire([entry(1)])
    expect(run).not.toHaveBeenCalled()
  })
  it('runs immediately when there is no IntersectionObserver', () => {
    const run = vi.fn()
    onFirstArrival(el, run, { io: undefined })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
