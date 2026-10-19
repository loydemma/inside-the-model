import { describe, it, expect, beforeEach } from 'vitest'
import { initReveals } from '../src/engine/reveal'

type Cb = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void
let fire: Cb

class FakeIO {
  constructor(cb: Cb) { fire = cb }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  document.body.innerHTML = '<p data-reveal id="a"></p><p data-reveal id="b"></p><p data-reveal id="c"></p>'
})

describe('initReveals', () => {
  it('marks all in view immediately under reduced motion', () => {
    initReveals(document, { reducedMotion: true })
    expect(document.querySelectorAll('.in-view').length).toBe(3)
  })
  it('marks only intersecting elements', () => {
    initReveals(document, { reducedMotion: false, io: FakeIO as unknown as typeof IntersectionObserver })
    fire([{ target: document.getElementById('b')!, isIntersecting: true }])
    expect(document.querySelectorAll('.in-view').length).toBe(1)
    expect(document.getElementById('b')!.classList.contains('in-view')).toBe(true)
  })
})
