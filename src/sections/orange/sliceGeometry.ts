import { BufferGeometry, Float32BufferAttribute } from 'three'

// nearestAngle lives on its own so the controller can use it without pulling three.js into the entry chunk.
export { nearestAngle } from './nearestAngle'

// n equal, touching slabs across the orange, from -r to r along its axis.
export function slabBounds(radius: number, n: number): [number, number][] {
  const w = (2 * radius) / n
  return Array.from({ length: n }, (_, i): [number, number] => [-radius + i * w, i === n - 1 ? radius : -radius + (i + 1) * w])
}

function geometry(pos: number[], nor: number[], uv: number[], idx: number[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

// One slab of a sphere along the x axis: the peel between x0 and x1, plus flat flesh caps on
// the faces that were cut (a slab that reaches a pole has no cap there).
export function buildSlab(
  radius: number,
  x0: number,
  x1: number,
  segments: number,
): { peel: BufferGeometry; caps: BufferGeometry } {
  const eps = 1e-9
  const clampX = (x: number) => Math.max(-1, Math.min(1, x / radius))
  // Rings are spaced by latitude, so the peel stays smooth near the poles.
  const lat0 = Math.acos(-clampX(x0))
  const lat1 = Math.acos(-clampX(x1))
  const rings = Math.max(1, Math.ceil(((lat1 - lat0) / Math.PI) * (segments / 2)))
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= rings; j++) {
    const lat = lat0 + ((lat1 - lat0) * j) / rings
    const x = j === 0 ? x0 : j === rings ? x1 : -radius * Math.cos(lat)
    const rho = Math.sqrt(Math.max(0, radius * radius - x * x))
    for (let k = 0; k <= segments; k++) {
      const phi = (k / segments) * Math.PI * 2
      const y = rho * Math.cos(phi)
      const z = rho * Math.sin(phi)
      pos.push(x, y, z)
      nor.push(x / radius, y / radius, z / radius)
      uv.push(k / segments, lat / Math.PI)
    }
  }
  const row = segments + 1
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < segments; k++) {
      const a = j * row + k
      const b = a + 1
      const c = a + row
      const d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  const peel = geometry(pos, nor, uv, idx)

  const cp: number[] = []
  const cn: number[] = []
  const cu: number[] = []
  const ci: number[] = []
  const cap = (x: number, facing: 1 | -1) => {
    const rho = Math.sqrt(Math.max(0, radius * radius - x * x))
    const base = cp.length / 3
    cp.push(x, 0, 0)
    cn.push(facing, 0, 0)
    cu.push(0.5, 0.5)
    for (let k = 0; k <= segments; k++) {
      const phi = (k / segments) * Math.PI * 2
      cp.push(x, rho * Math.cos(phi), rho * Math.sin(phi))
      cn.push(facing, 0, 0)
      cu.push(0.5 + 0.5 * Math.cos(phi), 0.5 + 0.5 * Math.sin(phi))
    }
    for (let k = 0; k < segments; k++) {
      const p = base + 1 + k
      if (facing === 1) ci.push(base, p, p + 1)
      else ci.push(base, p + 1, p)
    }
  }
  if (x0 > -radius + eps) cap(x0, -1)
  if (x1 < radius - eps) cap(x1, 1)
  return { peel, caps: geometry(cp, cn, cu, ci) }
}
