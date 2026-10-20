import { describe, it, expect } from 'vitest'
import { createGrowth, STEP_MS } from '../src/sections/flower/growth'

describe('growth', () => {
  it('shows candidates at 40% of a step and nothing while released', () => {
    const g = createGrowth(3)
    expect(g.tick(100, true)).toEqual([])
    expect(g.tick(0.4 * STEP_MS - 100 + 1, true)).toEqual([{ type: 'candidates', step: 0 }])
    expect(g.tick(STEP_MS, false)).toEqual([])
  })

  it('commits each step while held, then is done once', () => {
    const g = createGrowth(3)
    const events = []
    for (let i = 0; i < 20; i++) events.push(...g.tick(STEP_MS / 2, true))
    expect(events.filter((e) => e.type === 'commit')).toEqual([0, 1, 2].map((step) => ({ type: 'commit', step })))
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
    expect(g.progress()).toBe(1)
    g.reset()
    expect(g.progress()).toBe(0)
  })
})
