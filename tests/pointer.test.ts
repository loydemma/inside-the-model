import { describe, it, expect } from 'vitest'
import { smoothToward, normalizePointer, createPointer, MAX_TILT_RAD } from '../src/engine/pointer'

describe('smoothToward', () => {
  it('does not move with zero dt', () => {
    expect(smoothToward(0, 1, 0, 5)).toBe(0)
  })
  it('reaches the target with a huge dt', () => {
    expect(smoothToward(0, 1, 1e6, 5)).toBeCloseTo(1, 9)
  })
  it('is frame-rate independent', () => {
    const full = smoothToward(0, 1, 0.2, 5)
    const half = smoothToward(smoothToward(0, 1, 0.1, 5), 1, 0.1, 5)
    expect(Math.abs(full - half)).toBeLessThan(1e-9)
  })
})

describe('normalizePointer', () => {
  it('maps corners and center with y up', () => {
    expect(normalizePointer(0, 0, 100, 100)).toEqual({ x: -1, y: 1 })
    const c = normalizePointer(50, 50, 100, 100)
    expect(c.x).toBeCloseTo(0)
    expect(c.y).toBeCloseTo(0)
  })
  it('clamps out-of-range input', () => {
    expect(normalizePointer(150, -20, 100, 100)).toEqual({ x: 1, y: 1 })
  })
})

describe('createPointer', () => {
  it('tracks pointermove', () => {
    const t = new EventTarget()
    const p = createPointer(t, { reducedMotion: false })
    const ev = new Event('pointermove')
    Object.assign(ev, { clientX: 0, clientY: 0 })
    t.dispatchEvent(ev)
    expect(p.get().x).toBe(-1)
    p.dispose()
  })
  it('stays at zero under reduced motion', () => {
    const t = new EventTarget()
    const p = createPointer(t, { reducedMotion: true })
    const ev = new Event('pointermove')
    Object.assign(ev, { clientX: 0, clientY: 0 })
    t.dispatchEvent(ev)
    expect(p.get()).toEqual({ x: 0, y: 0 })
  })
  it('exports the tilt limit', () => {
    expect(MAX_TILT_RAD).toBe(0.14)
  })
})
