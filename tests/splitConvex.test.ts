import { describe, it, expect } from 'vitest'
import { Plane, SphereGeometry, Vector3, type BufferGeometry } from 'three'
import { splitConvex } from '../src/sections/orange/splitConvex'

function xs(g: BufferGeometry): number[] {
  const p = g.getAttribute('position')
  return Array.from({ length: p.count }, (_, i) => p.getX(i))
}

describe('splitConvex', () => {
  it('splits a sphere at x = 0 into two halves with caps on the cut', () => {
    const parts = splitConvex(new SphereGeometry(1, 32, 16), new Plane(new Vector3(1, 0, 0), 0))
    expect(parts).not.toBeNull()
    const { front, back, capFront, capBack } = parts!
    expect(xs(front).length).toBeGreaterThan(0)
    expect(xs(back).length).toBeGreaterThan(0)
    for (const x of xs(front)) expect(x).toBeGreaterThanOrEqual(-1e-6)
    for (const x of xs(back)) expect(x).toBeLessThanOrEqual(1e-6)
    for (const cap of [capFront, capBack]) {
      expect(xs(cap).length).toBeGreaterThan(0)
      for (const x of xs(cap)) expect(Math.abs(x)).toBeLessThan(1e-6)
    }
  })

  it('returns null when the plane misses the mesh', () => {
    expect(splitConvex(new SphereGeometry(1, 32, 16), new Plane(new Vector3(1, 0, 0), -2))).toBeNull()
  })
})
