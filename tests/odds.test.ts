import { describe, it, expect } from 'vitest'
import { rollLaunch, successOdds } from '../src/sections/rocket/odds'

const seq = (...xs: number[]) => () => xs.shift()!

describe('rocket odds', () => {
  it('multiplies the per-step reliability', () => {
    expect(successOdds(0.95, 10)).toBeCloseTo(0.5987, 4)
    expect(successOdds(0.9, 1)).toBe(0.9)
  })

  it('makes it when every roll lands under the reliability', () => {
    expect(rollLaunch(0.95, 3, () => 0.5)).toEqual({ failedAt: null })
  })

  it('fails at the first roll that misses', () => {
    expect(rollLaunch(0.95, 3, seq(0.1, 0.97, 0.1))).toEqual({ failedAt: 1 })
  })
})
