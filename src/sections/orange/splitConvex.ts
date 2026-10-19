import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3, type BufferAttribute, type Plane } from 'three'

const EPS = 1e-7

type V = { p: Vector3; n: Vector3; uv: Vector2 }
type Out = { pos: number[]; nor: number[]; uv: number[] }

const out = (): Out => ({ pos: [], nor: [], uv: [] })
function push(o: Out, v: V): void {
  o.pos.push(v.p.x, v.p.y, v.p.z)
  o.nor.push(v.n.x, v.n.y, v.n.z)
  o.uv.push(v.uv.x, v.uv.y)
}
function lerp(a: V, b: V, t: number): V {
  return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: a.uv.clone().lerp(b.uv, t) }
}
function geometry(o: Out): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(o.pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(o.nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(o.uv, 2))
  return g
}
// Fan-triangulate a convex polygon into `o`.
function fan(o: Out, poly: V[]): void {
  for (let i = 1; i < poly.length - 1; i++) { push(o, poly[0]!); push(o, poly[i]!); push(o, poly[i + 1]!) }
}

// Splits a convex triangle mesh by a plane. Triangles that straddle the plane are clipped, and the
// cut is closed on both sides by a fan-triangulated cap. Cap UVs map the cut circle of the mesh's
// bounding sphere (centered on the origin) onto [0, 1]², for a radial flesh texture. Returns null
// when the plane misses the mesh.
export function splitConvex(
  source: BufferGeometry,
  plane: Plane,
): { front: BufferGeometry; back: BufferGeometry; capFront: BufferGeometry; capBack: BufferGeometry } | null {
  const g = source.index ? source.toNonIndexed() : source
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv') as BufferAttribute | undefined
  const vert = (i: number): V => ({
    p: new Vector3().fromBufferAttribute(pos, i),
    n: nor ? new Vector3().fromBufferAttribute(nor, i) : new Vector3(),
    uv: uv ? new Vector2().fromBufferAttribute(uv, i) : new Vector2(),
  })

  let above = false
  let below = false
  let radius = 0
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos, i)
    const d = plane.distanceToPoint(v)
    if (d > EPS) above = true
    if (d < -EPS) below = true
    radius = Math.max(radius, v.length())
  }
  if (!above || !below) {
    if (g !== source) g.dispose()
    return null
  }

  const front = out()
  const back = out()
  const ring: Vector3[] = [] // points on the cut, for the caps
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const tri = [vert(t), vert(t + 1), vert(t + 2)]
    const d = tri.map((v) => plane.distanceToPoint(v.p))
    const f: V[] = []
    const b: V[] = []
    for (let i = 0; i < 3; i++) {
      const a = tri[i]!
      const c = tri[(i + 1) % 3]!
      const da = d[i]!
      const dc = d[(i + 1) % 3]!
      if (da >= -EPS) f.push(a)
      if (da <= EPS) b.push(a)
      if (Math.abs(da) <= EPS) ring.push(a.p)
      if ((da > EPS && dc < -EPS) || (da < -EPS && dc > EPS)) {
        const x = lerp(a, c, da / (da - dc))
        f.push(x)
        b.push(x)
        ring.push(x.p)
      }
    }
    if (f.length >= 3) fan(front, f)
    if (b.length >= 3) fan(back, b)
  }
  if (g !== source) g.dispose()

  // The cut of a convex mesh is a convex polygon: sort its points by angle around their centroid.
  const n = plane.normal.clone().normalize()
  const u = new Vector3().crossVectors(n, Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).normalize()
  const w = new Vector3().crossVectors(n, u)
  const center = ring.reduce((s, p) => s.add(p), new Vector3()).divideScalar(Math.max(1, ring.length))
  const angle = (p: Vector3) => Math.atan2(p.clone().sub(center).dot(w), p.clone().sub(center).dot(u))
  const sorted = ring.map((p) => ({ p, a: angle(p) })).sort((x, y) => x.a - y.a)
  const poly: Vector3[] = []
  for (const { p } of sorted) if (!poly.some((q) => q.distanceToSquared(p) < 1e-12)) poly.push(p)

  // The flesh texture is centered on the cut circle of the bounding sphere.
  const origin = plane.projectPoint(new Vector3(), new Vector3())
  const circle = Math.sqrt(Math.max(radius * radius - origin.lengthSq(), 1e-9))
  const capVert = (p: Vector3, normal: Vector3): V => {
    const r = p.clone().sub(origin)
    return { p, n: normal, uv: new Vector2(0.5 + (0.5 * r.dot(u)) / circle, 0.5 + (0.5 * r.dot(w)) / circle) }
  }
  const capFront = out()
  const capBack = out()
  if (poly.length >= 3) {
    // Sorted counterclockwise around n, so (center, p[i], p[i+1]) faces +n: the back piece's cap.
    // The front piece's cap runs the other way and faces -n.
    const back = n.clone()
    const toFront = n.clone().negate()
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      push(capBack, capVert(center, back)); push(capBack, capVert(a, back)); push(capBack, capVert(b, back))
      push(capFront, capVert(center, toFront)); push(capFront, capVert(b, toFront)); push(capFront, capVert(a, toFront))
    }
  }
  return { front: geometry(front), back: geometry(back), capFront: geometry(capFront), capBack: geometry(capBack) }
}
