import { describe, it, expect } from 'vitest'
import type { BufferGeometry } from 'three'
import { buildSlab, nearestAngle, slabBounds } from '../src/sections/orange/sliceGeometry'

function xs(g: BufferGeometry): number[] {
  const p = g.getAttribute('position')
  return Array.from({ length: p.count }, (_, i) => p.getX(i))
}

describe('nearestAngle', () => {
  it('snaps a swipe to 0, 45, 90 or 135 degrees, ignoring direction', () => {
    expect(nearestAngle(1, 0)).toBe(0)
    expect(nearestAngle(-1, 0)).toBe(0)
    expect(nearestAngle(1, 1)).toBe(45)
    expect(nearestAngle(0, 1)).toBe(90)
    expect(nearestAngle(-1, 1)).toBe(135)
  })
})

describe('slabBounds', () => {
  it('splits [-r, r] into n equal, contiguous slabs', () => {
    const b = slabBounds(1, 4)
    expect(b).toHaveLength(4)
    expect(b[0]![0]).toBeCloseTo(-1)
    expect(b[3]![1]).toBeCloseTo(1)
    for (let i = 1; i < b.length; i++) expect(b[i]![0]).toBeCloseTo(b[i - 1]![1])
    for (const [x0, x1] of b) expect(x1 - x0).toBeCloseTo(0.5)
  })
})

describe('buildSlab', () => {
  it('builds the peel on the sphere and caps on both inner faces', () => {
    const { peel, caps } = buildSlab(1, -0.25, 0.25, 32)
    const p = peel.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      expect(Math.abs(x)).toBeLessThanOrEqual(0.25 + 1e-6)
      expect(p.getY(i) ** 2 + p.getZ(i) ** 2).toBeCloseTo(1 - x * x, 5)
    }
    const capX = new Set(xs(caps).map((x) => x.toFixed(6)))
    expect([...capX].sort()).toEqual(['-0.250000', '0.250000'])
  })

  it('gives an outer slab one cap, on its inner face', () => {
    const { caps } = buildSlab(1, -1, -0.5, 32)
    expect(new Set(xs(caps).map((x) => x.toFixed(6)))).toEqual(new Set(['-0.500000']))
  })
})
