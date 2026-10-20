import { describe, it, expect } from 'vitest'
import { displacement, settleTime, wobbleParams } from '../src/sections/jello/wobble'
import { TEMPERATURE_STOPS } from '../src/config'

describe('wobble', () => {
  it('gets slower, looser and bigger across the five stops', () => {
    const ps = TEMPERATURE_STOPS.map(wobbleParams)
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.frequency).toBeLessThan(ps[i - 1]!.frequency)
      expect(ps[i]!.damping).toBeLessThan(ps[i - 1]!.damping)
      expect(ps[i]!.amplitude).toBeGreaterThan(ps[i - 1]!.amplitude)
    }
  })

  it('starts at rest', () => {
    expect(displacement(0, 0, wobbleParams(1), 1)).toBe(0)
  })

  it('settles fast when cold and slowly when hot', () => {
    expect(settleTime(wobbleParams(0))).toBeLessThan(0.6)
    expect(settleTime(wobbleParams(2))).toBeGreaterThan(2)
  })
})
