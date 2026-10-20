import {
  BackSide, Box3, CanvasTexture, CapsuleGeometry, Color, DirectionalLight, DynamicDrawUsage, Group, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, NeutralToneMapping, PerspectiveCamera, Plane, PlaneGeometry,
  PMREMGenerator, Quaternion, RenderPipeline, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, TextureLoader, Vector3,
  type BufferGeometry, type Texture,
} from 'three/webgpu'
import { color, mix, pass, screenUV, smoothstep, uniform, vec2 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createRenderer } from '../../engine/renderer'
import { setStatus } from '../../engine/status'
import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { OrangeScene } from './orangeController'
import type { Token } from './tokenize'
import { splitConvex } from './splitConvex'
import fleshUrl from './orange-flesh.jpg'

const STAGE = '#05060a' // matches --stage, so the canvas edge disappears into the page
const GLOW = '#121a44'
const CAM_Z = 10
const FOV = 30
const LABEL_H = 0.3 // label pill height, in orange radii (larger on a narrow stage)
const LABEL_GAP = 0.14 // between a piece and its label
const WHOLE_FILL = 0.62 // the whole orange's share of the stage's short side
const DRIFT = 0.42 // how far a cut-off piece moves away from the rest
const SHOW_FACE = 0.62 // how far (rad) a cut-off piece turns its flesh toward the camera
const MAIN_TURN = 0.22 // and the piece that is left, a little
const TRAIL_MS = 240 // a slash trail fades over this long
const SWIPE_MS = 260 // the intro blade's slash
const SETTLE_MS = 320 // after a slash, before the next one
const DROPS = 72
const FLESH_GLOW = 0.4
const GLINT = 1 // a fresh cut face's glow, settling to FLESH_GLOW

// Damped spring; a ratio below 1 gives a small settle.
class Spring {
  v = 0
  constructor(public x: number, public target = x, public k = 70, public ratio = 0.8) {}
  step(dt: number): number {
    const c = 2 * Math.sqrt(this.k) * this.ratio
    this.v += (this.k * (this.target - this.x) - c * this.v) * dt
    this.x += this.v * dt
    return this.x
  }
  snap(): void { this.x = this.target; this.v = 0 }
}

function rand(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function soft(size: number, inner: string, outer: string): HTMLCanvasElement {
  const [c, g] = canvas2d(size, size)
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, inner)
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

// Peel color and bump maps. uv.x runs around the axis, uv.y from the navel (bottom row) to the
// stem (top row). Pores are spread evenly over the sphere, and widened near the poles where a
// texel covers less of the surface. The color map is drawn on `base`, so text can go on top.
function peelTextures(W: number): { base: HTMLCanvasElement; map: CanvasTexture; bump: CanvasTexture } {
  const H = W / 2
  const rng = rand(7)
  const [cc, cg] = canvas2d(W, H)
  const [bc, bg] = canvas2d(W, H)
  const grad = cg.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#f7a02c')
  grad.addColorStop(0.18, '#ff951f')
  grad.addColorStop(0.7, '#fc8a18')
  grad.addColorStop(1, '#ffa030')
  cg.fillStyle = grad
  cg.fillRect(0, 0, W, H)
  // Large soft mottling.
  for (let i = 0; i < 90; i++) {
    const r = (0.04 + rng() * 0.12) * W
    const blob = soft(64, ['rgba(250,170,60,0.16)', 'rgba(210,92,8,0.14)', 'rgba(255,190,90,0.1)'][i % 3]!, 'rgba(0,0,0,0)')
    const x = rng() * W
    const y = rng() * H
    for (const dx of [-W, 0, W]) cg.drawImage(blob, x + dx - r, y - r / 2, r * 2, r)
  }
  bg.fillStyle = '#808080'
  bg.fillRect(0, 0, W, H)
  const dimple = soft(32, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')
  const pore = soft(16, 'rgba(150,62,6,0.42)', 'rgba(150,62,6,0)')
  const shine = soft(16, 'rgba(255,214,150,0.22)', 'rgba(255,214,150,0)')
  const count = Math.round((W * H) / 34)
  const base = W / 420
  for (let n = 0; n < count; ) {
    const y = rng() * H
    const sinLat = Math.sin(Math.PI * (y / H))
    if (rng() > sinLat) continue
    n++
    const x = rng() * W
    const r = base * (0.7 + rng() * 0.9)
    const rw = Math.min(r / Math.max(sinLat, 0.04), W * 0.05)
    for (const dx of x < rw ? [0, W] : x > W - rw ? [0, -W] : [0]) {
      bg.drawImage(dimple, x + dx - rw, y - r, rw * 2, r * 2)
      cg.drawImage(n % 5 === 0 ? shine : pore, x + dx - rw * 0.6, y - r * 0.6, rw * 1.2, r * 1.2)
    }
  }
  // The stem end: an olive, five-lobed calyx with a dark scar. The navel end: a small pale spot.
  const lobe = (x: number) => H * (0.016 + 0.011 * Math.max(0, Math.cos((x / W) * Math.PI * 2 * 5)))
  cg.beginPath()
  cg.moveTo(0, 0)
  for (let x = 0; x <= W; x += 4) cg.lineTo(x, lobe(x))
  cg.lineTo(W, 0)
  cg.closePath()
  const calyx = cg.createLinearGradient(0, 0, 0, H * 0.03)
  calyx.addColorStop(0, '#3d3a1a')
  calyx.addColorStop(0.3, '#6f6a2c')
  calyx.addColorStop(1, '#a3862e')
  cg.fillStyle = calyx
  cg.fill()
  bg.fillStyle = 'rgba(0,0,0,0.35)'
  bg.fillRect(0, 0, W, H * 0.008)
  const navel = cg.createLinearGradient(0, H, 0, H * 0.985)
  navel.addColorStop(0, 'rgba(214,150,70,0.9)')
  navel.addColorStop(1, 'rgba(214,150,70,0)')
  cg.fillStyle = navel
  cg.fillRect(0, H * 0.985, W, H * 0.015)

  const [mc] = canvas2d(W, H)
  mc.getContext('2d')!.drawImage(cc, 0, 0)
  const map = new CanvasTexture(mc)
  map.colorSpace = SRGBColorSpace
  const bump = new CanvasTexture(bc)
  for (const t of [map, bump]) { t.wrapS = RepeatWrapping; t.anisotropy = 8 }
  return { base: cc, map, bump }
}

// The word, inked on the side of the orange that faces the camera (u = 0.25 on a SphereGeometry).
// When it fits on one line as typed, returns the u of the gap after each character, so the intro's
// blade can cut exactly between tokens.
function inkText(map: CanvasTexture, base: HTMLCanvasElement, text: string): number[] | null {
  const c = map.image as HTMLCanvasElement
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  g.drawImage(base, 0, 0)
  const shown = text.trim().replace(/\s+/g, ' ')
  const word = shown.length > 64 ? `${shown.slice(0, 63)}…` : shown
  if (word) {
    const maxW = W * 0.24
    const font = (px: number) => `700 ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif`
    let size = H * 0.115
    g.font = font(size)
    let lines = [word]
    if (g.measureText(word).width > maxW) {
      size = Math.max(H * 0.06, (size * maxW) / g.measureText(word).width)
      g.font = font(size)
      if (g.measureText(word).width > maxW) {
        // Too long for one line: wrap at spaces.
        lines = []
        for (const w of word.split(' ')) {
          const line = lines.at(-1)
          if (line !== undefined && g.measureText(`${line} ${w}`).width <= maxW) lines[lines.length - 1] = `${line} ${w}`
          else lines.push(w)
        }
        const widest = Math.max(...lines.map((l) => g.measureText(l).width))
        if (widest > maxW) { size *= maxW / widest; g.font = font(size) }
      }
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = 'rgba(48, 18, 4, 0.86)'
    const lh = size * 1.08
    lines.forEach((l, i) => g.fillText(l, W * 0.25, H / 2 + (i - (lines.length - 1) / 2) * lh))
    if (lines.length === 1 && word === text) {
      const x0 = W * 0.25 - g.measureText(word).width / 2
      map.needsUpdate = true
      return Array.from({ length: word.length + 1 }, (_, k) => (x0 + g.measureText(word.slice(0, k)).width) / W)
    }
  }
  map.needsUpdate = true
  return null
}

// The cut face: a photo of an orange cross-section, cropped so its rind fills the square (Grok Imagine).
function fleshTexture(): Texture {
  const map = new TextureLoader().load(fleshUrl)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  return map
}

// Token text, white on transparent. Spaces show as a dim ␣ so they don't vanish.
function labelTexture(token: Token): { map: CanvasTexture; aspect: number } {
  const H = 128
  const text = token.text.replace(/ /g, '␣').replace(/\n/g, '↵').replace(/\t/g, '⇥')
  const font = '600 68px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif'
  const [, m] = canvas2d(1, 1)
  m.font = font
  const w = Math.ceil(m.measureText(text).width) + 8
  const [c, g] = canvas2d(w, H)
  g.textBaseline = 'middle'
  g.font = font
  let x = 4
  for (const ch of text) {
    g.fillStyle = '␣↵⇥'.includes(ch) ? 'rgba(245,245,247,0.38)' : '#f5f5f7'
    g.fillText(ch, x, H / 2 + 3)
    x += m.measureText(ch).width
  }
  const map = new CanvasTexture(c)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  return { map, aspect: w / H }
}

// Neutral tone mapping darkens near-black; this picks the color that comes out as `hex`.
function untoned(hex: string): Color {
  const t = new Color(hex)
  const m = Math.min(t.r, t.g, t.b)
  const d = Math.sqrt(m / 6.25) - m
  return new Color(t.r + d, t.g + d, t.b + d)
}

// Volume of a closed mesh (sum of signed tetrahedra to the origin).
function volume(geos: BufferGeometry[]): number {
  let v = 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (const g of geos) {
    const p = g.getAttribute('position')
    for (let i = 0; i + 2 < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2)
      v += a.dot(b.cross(c)) / 6
    }
  }
  return v
}

type Label = { group: Group; text: Mesh; pill: Mesh; w: number; appear: Spring }
// A piece's geometry stays in the whole orange's frame; `c` is its centroid there. `pos`/`q` place
// that centroid in the fit group, eased toward `toPos`/`toQ`.
type Piece = {
  group: Group; peel: Mesh; caps: Mesh[]; c: Vector3; box: Box3
  pos: Vector3; q: Quaternion; toPos: Vector3; toQ: Quaternion; label: Label | null
}
type Point = { x: number; y: number; t: number }

export async function createOrangeScene(canvas: HTMLCanvasElement, q: Quality): Promise<OrangeScene> {
  const still = q.reducedMotion
  const high = q.tier === 'high'
  const stage = (canvas.closest('section')?.querySelector('[data-orange-stage]') ?? canvas) as HTMLElement
  const { renderer, backend } = await createRenderer(canvas, q)
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1

  const scene = new Scene()
  const glowCenter = uniform(vec2(0.5, 0.5))
  const glowAspect = uniform(1)
  const falloff = smoothstep(0.7, 0.0, screenUV.sub(glowCenter).mul(vec2(1.0, glowAspect)).length())
  scene.backgroundNode = mix(color(untoned(STAGE)), color(untoned(GLOW)), falloff.mul(falloff))
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60)
  camera.position.set(0, 0, CAM_Z)

  // A dark studio with soft boxes, for product-shot reflections on the peel and the pills.
  const studio = new Scene()
  studio.add(new Mesh(new SphereGeometry(20, 16, 8), new MeshBasicMaterial({ color: '#010103', side: BackSide })))
  const softbox = (w: number, h: number, c: string, k: number, pos: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c).multiplyScalar(k), side: BackSide }))
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    studio.add(m)
  }
  softbox(12, 5, '#fff6ec', 5, [-4, 9, 6])
  softbox(1.6, 10, '#8f9cff', 3.5, [-9, 1, -3])
  softbox(1.8, 9, '#ffc690', 4, [9, 0, -2])
  softbox(10, 1.2, '#ffffff', 0.8, [0, -8, 6])
  const pmrem = new PMREMGenerator(renderer)
  const envMap = pmrem.fromScene(studio, 0.03)
  scene.environment = envMap.texture
  pmrem.dispose()
  studio.traverse((o) => {
    if (o instanceof Mesh) { o.geometry.dispose(); (o.material as MeshBasicMaterial).dispose() }
  })

  const key = new DirectionalLight('#fff3e4', 3)
  key.position.set(-4, 6, 7)
  const fill = new DirectionalLight('#ffe0c0', 1.1)
  fill.position.set(2, -1, 8)
  const rimWarm = new DirectionalLight('#ffb062', 5)
  rimWarm.position.set(6, 3, -6)
  const rimCool = new DirectionalLight('#7d8cff', 1.2)
  rimCool.position.set(-7, 2, -5)
  scene.add(key, fill, rimWarm, rimCool)

  const peelTex = peelTextures(high ? 2048 : 1024)
  const fleshMap = fleshTexture()
  const peelMat = new MeshPhysicalMaterial({
    map: peelTex.map, bumpMap: peelTex.bump, bumpScale: 0.9, roughness: 0.42,
    clearcoat: 0.55, clearcoatRoughness: 0.32, sheen: 0.3, sheenColor: new Color('#ffb066'), sheenRoughness: 0.6,
  })
  const fleshMat = new MeshPhysicalMaterial({
    map: fleshMap, color: new Color(0.82, 0.82, 0.82), roughness: 0.45, clearcoat: 0.45, clearcoatRoughness: 0.22,
    emissive: new Color('#ff8a24'), emissiveMap: fleshMap, emissiveIntensity: FLESH_GLOW,
  })
  const pillMat = new MeshPhysicalMaterial({
    color: '#161925', metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.09, iridescence: 0.15,
  })
  const juiceMat = new MeshPhysicalMaterial({
    color: '#ffa43a', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color('#ff7a10'), emissiveIntensity: 0.35,
  })
  const segments = high ? 96 : 64

  // hero (pointer tilt, entrance) > fit (scale and centering) > pieces and labels.
  const hero = new Group()
  const fit = new Group()
  scene.add(hero)
  hero.add(fit)

  // Juice drops spray from each cut.
  const drops = new InstancedMesh(new SphereGeometry(1, 10, 8), juiceMat, DROPS)
  drops.instanceMatrix.setUsage(DynamicDrawUsage)
  drops.count = 0
  drops.frustumCulled = false
  fit.add(drops)
  const drop = Array.from({ length: DROPS }, () => ({ p: new Vector3(), v: new Vector3(), life: 0, max: 1, r: 0.02 }))
  let nextDrop = 0

  let pieces: Piece[] = []
  let main: Piece | null = null
  let text = ''
  let tokenCount = 0
  let cutChars = 0 // characters already cut off, to place the intro's slices
  let inkU: number[] | null = null
  const glints: { mat: MeshPhysicalMaterial; at: number }[] = []

  const scale = new Spring(1, 1, 50, 0.9)
  const offX = new Spring(0, 0, 50, 0.9)
  const offY = new Spring(0, 0, 50, 0.9)
  const entrance = new Spring(still ? 1 : 0.82, 1, 40, 0.7)

  // Stage rect inside the canvas, and world units per pixel at the orange's depth.
  let stageW = 300
  let stageH = 300
  let canvasW = 300
  let canvasH = 300
  let labelH = LABEL_H
  let px = 0.01

  function disposeLabel(l: Label): void {
    const m = l.text.material as MeshBasicMaterial
    m.map?.dispose()
    m.dispose()
    l.text.geometry.dispose()
    l.pill.geometry.dispose()
    fit.remove(l.group)
  }

  function disposePiece(p: Piece, keepLabel = false): void {
    p.peel.geometry.dispose()
    for (const c of p.caps) {
      c.geometry.dispose()
      if (c.material !== fleshMat) (c.material as MeshPhysicalMaterial).dispose()
    }
    if (p.label && !keepLabel) disposeLabel(p.label)
    fit.remove(p.group)
  }

  function makePiece(peel: BufferGeometry, caps: Mesh[], from: Piece | null): Piece {
    peel.computeBoundingBox()
    const box = peel.boundingBox!.clone()
    const c = box.getCenter(new Vector3())
    const group = new Group()
    const peelMesh = new Mesh(peel, peelMat)
    group.add(peelMesh, ...caps)
    fit.add(group)
    const pos = new Vector3()
    const qq = new Quaternion()
    if (from) {
      // Start exactly where this part of the old piece was.
      qq.copy(from.q)
      pos.copy(c).sub(from.c).applyQuaternion(from.q).add(from.pos)
    } else {
      pos.copy(c)
    }
    const p: Piece = { group, peel: peelMesh, caps, c, box, pos, q: qq, toPos: pos.clone(), toQ: qq.clone(), label: null }
    place(p)
    return p
  }

  function place(p: Piece): void {
    p.group.quaternion.copy(p.q)
    p.group.position.copy(p.c).negate().applyQuaternion(p.q).add(p.pos)
  }

  function makeLabel(t: Token): Label {
    const { map, aspect } = labelTexture(t)
    const w = Math.max(1.5, aspect + 0.85)
    const pill = new Mesh(new CapsuleGeometry(0.5, w - 1, high ? 8 : 5, high ? 28 : 18), pillMat)
    pill.geometry.rotateZ(Math.PI / 2)
    pill.scale.z = 0.55
    const textMesh = new Mesh(new PlaneGeometry(aspect, 1), new MeshBasicMaterial({ map, color: new Color(0.92, 0.92, 0.92), transparent: true, depthWrite: false, toneMapped: false }))
    textMesh.position.z = 0.29
    textMesh.renderOrder = 2
    const group = new Group()
    group.add(pill, textMesh)
    group.visible = false
    fit.add(group)
    const l: Label = { group, text: textMesh, pill, w, appear: new Spring(0, 1, 90, 0.62) }
    if (still) l.appear.snap()
    return l
  }

  function setText(next: string, count: number): void {
    for (const p of pieces) disposePiece(p) // disposes the glinting cap materials too
    glints.length = 0
    drops.count = 0
    text = next
    tokenCount = count
    cutChars = 0
    inkU = inkText(peelTex.map, peelTex.base, next)
    const sphere = new SphereGeometry(1, segments, segments / 2)
    main = makePiece(sphere.toNonIndexed(), [], null)
    sphere.dispose()
    pieces = [main]
    plan()
    if (!still && started) entrance.x = 0.86
    else { scale.snap(); offX.snap(); offY.snap() }
  }

  // ---------- Layout: where each label goes, and the fit of everything ----------
  const corner = new Vector3()
  // A piece's extent in the fit group, at its current or target place.
  function extent(p: Piece, target: boolean): { x0: number; x1: number; y0: number; y1: number; cx: number } {
    const pos = target ? p.toPos : p.pos
    const qq = target ? p.toQ : p.q
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? p.box.max.x : p.box.min.x, i & 2 ? p.box.max.y : p.box.min.y, i & 4 ? p.box.max.z : p.box.min.z)
      corner.sub(p.c).applyQuaternion(qq).add(pos)
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y)
    }
    // The box of a rotated box overstates a round piece; pull it in a little.
    const sx = (x1 - x0) * 0.06
    const sy = (y1 - y0) * 0.06
    return { x0: x0 + sx, x1: x1 - sx, y0: y0 + sy, y1: y1 - sy, cx: pos.x }
  }

  type Box = { x0: number; x1: number; y0: number; y1: number }
  // Labels sit in a row under the pieces, each as close under its own piece as the others allow.
  // A wide row splits into two, alternating, so neighbours never collide.
  function layout(target: boolean): { labels: Map<Label, { x: number; y: number }>; box: Box } {
    const box: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    const grow = (b: Box) => {
      box.x0 = Math.min(box.x0, b.x0); box.x1 = Math.max(box.x1, b.x1); box.y0 = Math.min(box.y0, b.y0); box.y1 = Math.max(box.y1, b.y1)
    }
    const exts = pieces.map((p) => extent(p, target))
    exts.forEach(grow)
    const floor = Math.min(...exts.map((e) => e.y0))
    const items = pieces
      .map((p, i) => ({ l: p.label, want: exts[i]!.cx }))
      .filter((it): it is { l: Label; want: number } => it.l !== null)
      .sort((a, b) => a.want - b.want)
    const pad = 0.08
    const width = items.reduce((sum, it) => sum + it.l.w * labelH + pad, 0)
    const rows = width > 3 ? 2 : 1
    const labels = new Map<Label, { x: number; y: number }>()
    for (let r = 0; r < rows; r++) {
      const row = items.filter((_, i) => i % rows === r)
      const xs = row.map((it) => it.want)
      for (let i = 1; i < row.length; i++) {
        const min = xs[i - 1]! + ((row[i - 1]!.l.w + row[i]!.l.w) * labelH) / 2 + pad
        xs[i] = Math.max(xs[i]!, min)
      }
      const shift = row.reduce((sum, it, i) => sum + it.want - xs[i]!, 0) / Math.max(1, row.length)
      const y = floor - LABEL_GAP - labelH / 2 - r * labelH * 1.2
      row.forEach((it, i) => {
        const x = xs[i]! + shift
        const hw = (it.l.w * labelH) / 2
        grow({ x0: x - hw, x1: x + hw, y0: y - labelH / 2, y1: y + labelH / 2 })
        labels.set(it.l, { x, y })
      })
    }
    return { labels, box }
  }

  function plan(): void {
    const { box } = layout(true)
    const fitScale = Math.min((stageW * px * 0.92) / (box.x1 - box.x0), (stageH * px * 0.9) / (box.y1 - box.y0))
    const wholeScale = (Math.min(stageW, stageH) * px * WHOLE_FILL) / 2
    scale.target = Math.min(fitScale, wholeScale)
    offX.target = -((box.x0 + box.x1) / 2) * scale.target
    offY.target = -((box.y0 + box.y1) / 2) * scale.target
    if (still) { scale.snap(); offX.snap(); offY.snap() }
  }

  // ---------- Slicing ----------
  const inv = new Matrix4()
  const toNdc = (v: Vector3) => v.clone().project(camera)

  // Where the main piece is on screen, in canvas pixels: its center and radius.
  function mainOnScreen(): { x: number; y: number; r: number } | null {
    if (!main) return null
    scene.updateMatrixWorld()
    main.peel.geometry.computeBoundingSphere()
    const s = main.peel.geometry.boundingSphere!
    const c = s.center.clone().applyMatrix4(main.peel.matrixWorld)
    const k = fit.scale.x * hero.scale.x
    const a = toNdc(c)
    const b = toNdc(c.clone().add(new Vector3(0, s.radius * k, 0)))
    return { x: (a.x * canvasW) / 2, y: (a.y * canvasH) / 2, r: (Math.abs(b.y - a.y) * canvasH) / 2 }
  }

  // `leftOff`: the intro cuts off the part on the left (the one inked with the token), not the smaller.
  function slice(start: { x: number; y: number }, end: { x: number; y: number }, label: Token, rest?: Token, leftOff = false): boolean {
    const m = mainOnScreen()
    if (!main || !m) return false
    // The drag has to cross the orange, not just point at it.
    const ax = (start.x * canvasW) / 2
    const ay = (start.y * canvasH) / 2
    const bx = (end.x * canvasW) / 2
    const by = (end.y * canvasH) / 2
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((m.x - ax) * dx + (m.y - ay) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(ax + dx * t - m.x, ay + dy * t - m.y) > m.r * 0.96) return false

    // Only one token: there is nothing to cut off. The whole orange is that one chunk, and the
    // blade glances off it.
    if (tokenCount <= 1 || pieces.length >= tokenCount) {
      if (main.label || pieces.length > 1) return false
      if (!still) entrance.x = 0.9
      main.label = makeLabel(label)
      plan()
      return true
    }

    // The cutting plane goes through the camera and the drawn line.
    const C = camera.position.clone()
    const A = new Vector3(start.x, start.y, 0.5).unproject(camera).sub(C)
    const B = new Vector3(end.x, end.y, 0.5).unproject(camera).sub(C)
    const n = new Vector3().crossVectors(A, B).normalize()
    const world = new Plane().setFromNormalAndCoplanarPoint(n, C)
    const local = world.clone().applyMatrix4(inv.copy(main.peel.matrixWorld).invert())
    const split = splitConvex(main.peel.geometry, local)
    if (!split) return false

    // Old cut faces are split too (or go whole to one side).
    const frontCaps: BufferGeometry[] = []
    const backCaps: BufferGeometry[] = []
    for (const cap of main.caps) {
      const s = splitConvex(cap.geometry, local)
      if (s) {
        frontCaps.push(s.front)
        backCaps.push(s.back)
        s.capFront.dispose()
        s.capBack.dispose()
      } else {
        const p = new Vector3().fromBufferAttribute(cap.geometry.getAttribute('position'), 0)
        ;(local.distanceToPoint(p) >= 0 ? frontCaps : backCaps).push(cap.geometry.clone())
      }
    }
    const vf = Math.abs(volume([split.front, split.capFront, ...frontCaps]))
    const vb = Math.abs(volume([split.back, split.capBack, ...backCaps]))
    let offFront = vf <= vb
    if (leftOff) {
      // The front side is where the plane's normal points; on screen, that is left if the normal points left.
      const toLeft = new Vector3(-1, 0, 0).applyQuaternion(camera.quaternion)
      offFront = n.dot(toLeft) > 0
    }
    if (Math.min(vf, vb) < 0.004 * (vf + vb)) {
      // A sliver: not worth a token.
      for (const g of [split.front, split.back, split.capFront, split.capBack, ...frontCaps, ...backCaps]) g.dispose()
      return false
    }

    const now = performance.now()
    const capMesh = (g: BufferGeometry, fresh: boolean): Mesh => {
      if (!fresh) return new Mesh(g, fleshMat)
      const mat = fleshMat.clone()
      mat.emissiveIntensity = still ? fleshMat.emissiveIntensity : GLINT
      glints.push({ mat, at: now })
      return new Mesh(g, mat)
    }
    const old = main
    const front = makePiece(split.front, [...frontCaps.map((g) => capMesh(g, false)), capMesh(split.capFront, true)], old)
    const back = makePiece(split.back, [...backCaps.map((g) => capMesh(g, false)), capMesh(split.capBack, true)], old)
    const off = offFront ? front : back
    const kept = offFront ? back : front
    kept.label = old.label
    disposePiece(old, true)
    pieces = pieces.filter((p) => p !== old)
    pieces.push(off, kept)
    main = kept

    // Away from the rest, in the fit group's frame (only the hero above it rotates).
    const heroInv = hero.quaternion.clone().invert()
    const away = (offFront ? n.clone() : n.clone().negate()).applyQuaternion(heroInv)
    away.z = 0
    away.normalize()
    // Earlier slices on that side are pushed along, like slices off a loaf.
    const side = offFront ? 1 : -1
    for (const p of pieces) {
      if (p === kept) continue
      const w = p.pos.clone().applyMatrix4(fit.matrixWorld)
      if (p === off || side * world.distanceToPoint(w) > 0) p.toPos.addScaledVector(away, DRIFT)
    }
    kept.toPos.addScaledVector(away, -0.06)
    // Each new face turns toward the camera so the flesh shows.
    const toCam = new Vector3(0, 0, 1).applyQuaternion(heroInv)
    const turn = (p: Piece, face: Vector3, angle: number) => {
      const axis = new Vector3().crossVectors(face, toCam)
      if (axis.lengthSq() < 1e-6) return
      p.toQ.premultiply(new Quaternion().setFromAxisAngle(axis.normalize(), angle))
    }
    turn(off, away.clone().negate(), SHOW_FACE)
    turn(kept, away, MAIN_TURN)
    off.toPos.y -= 0.05

    off.label = makeLabel(label)
    if (rest) kept.label = makeLabel(rest)
    cutChars += label.text.length

    // Juice sprays from the cut.
    if (!still) {
      const ring = split.capBack.getAttribute('position')
      for (let i = 0; i < 26 && ring.count > 0; i++) {
        const d = drop[nextDrop]!
        nextDrop = (nextDrop + 1) % DROPS
        d.p.fromBufferAttribute(ring, Math.floor(Math.random() * ring.count))
        d.p.sub(kept.c).applyQuaternion(kept.q).add(kept.pos)
        d.v.copy(away).multiplyScalar((Math.random() - 0.3) * 1.6)
        d.v.y += 0.6 + Math.random() * 1.4
        d.v.z += 0.6 + Math.random() * 1.2
        d.life = 0
        d.max = 0.55 + Math.random() * 0.4
        d.r = 0.012 + Math.random() * 0.026
      }
    }

    plan()
    if (still) {
      for (const p of pieces) { p.pos.copy(p.toPos); p.q.copy(p.toQ); place(p) }
    }
    return true
  }

  // ---------- The slash trail (2D, over the stage) ----------
  const trail = document.createElement('canvas')
  trail.className = 'slash-trail'
  trail.setAttribute('aria-hidden', 'true')
  stage.append(trail)
  const tg = trail.getContext('2d')!
  let points: Point[] = []
  let dragging: number | null = null
  let blade: { from: Point; to: Point; at: number } | null = null
  const stagePoint = (clientX: number, clientY: number): Point => {
    const r = stage.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top, t: performance.now() }
  }
  const onDown = (e: PointerEvent) => { dragging = e.pointerId; points = [stagePoint(e.clientX, e.clientY)] }
  const onMove = (e: PointerEvent) => { if (dragging === e.pointerId) points.push(stagePoint(e.clientX, e.clientY)) }
  const onUp = (e: PointerEvent) => { if (dragging === e.pointerId) dragging = null }
  if (!still) {
    stage.addEventListener('pointerdown', onDown)
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerup', onUp)
    stage.addEventListener('pointercancel', onUp)
  }

  function drawTrail(now: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(stageW * dpr)
    const h = Math.round(stageH * dpr)
    if (trail.width !== w || trail.height !== h) { trail.width = w; trail.height = h }
    tg.setTransform(1, 0, 0, 1, 0, 0)
    tg.clearRect(0, 0, w, h)
    if (blade) {
      const k = Math.min(1, (now - blade.at) / SWIPE_MS)
      const e = 1 - (1 - k) ** 3
      points.push({ x: blade.from.x + (blade.to.x - blade.from.x) * e, y: blade.from.y + (blade.to.y - blade.from.y) * e, t: now })
      if (k >= 1) blade = null
    }
    if (dragging === null) points = points.filter((p) => now - p.t < TRAIL_MS)
    if (points.length < 2) return
    tg.setTransform(dpr, 0, 0, dpr, 0, 0)
    tg.globalCompositeOperation = 'lighter'
    tg.lineCap = 'round'
    // One stroke per pass, so joints don't double up; the tail shortens as old points expire.
    const age = dragging !== null ? 0 : (now - points.at(-1)!.t) / TRAIL_MS
    const fade = Math.max(0, 1 - age)
    const passes: [string, number, number][] = [['154,166,255', 16, 0.22], ['205,214,255', 6, 0.6], ['255,255,255', 2.2, 0.95]]
    tg.lineJoin = 'round'
    for (const [rgb, width, alpha] of passes) {
      tg.strokeStyle = `rgba(${rgb},${alpha * fade})`
      tg.lineWidth = width * (0.5 + 0.5 * fade)
      tg.beginPath()
      tg.moveTo(points[0]!.x, points[0]!.y)
      for (const p of points.slice(1)) tg.lineTo(p.x, p.y)
      tg.stroke()
    }
    // A bright head where the blade is.
    const head = points.at(-1)!
    if (now - head.t < 80) {
      const glow = tg.createRadialGradient(head.x, head.y, 0, head.x, head.y, 18)
      glow.addColorStop(0, 'rgba(255,255,255,0.9)')
      glow.addColorStop(1, 'rgba(154,166,255,0)')
      tg.fillStyle = glow
      tg.fillRect(head.x - 18, head.y - 18, 36, 36)
    }
    tg.globalCompositeOperation = 'source-over'
  }

  // The intro's blade: a slash across the piece that is left, sized to the token it cuts off.
  let chain = Promise.resolve()
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  async function runAuto(label: Token, rest?: Token): Promise<void> {
    if (!main) return
    scene.updateMatrixWorld()
    const ndcBox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    const box = new Box3().setFromObject(main.peel)
    for (let i = 0; i < 8; i++) {
      const p = toNdc(new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
      ndcBox.x0 = Math.min(ndcBox.x0, p.x); ndcBox.x1 = Math.max(ndcBox.x1, p.x)
      ndcBox.y0 = Math.min(ndcBox.y0, p.y); ndcBox.y1 = Math.max(ndcBox.y1, p.y)
    }
    const wx = ndcBox.x1 - ndcBox.x0
    const wy = ndcBox.y1 - ndcBox.y0
    // Cut between the inked letters where this token ends; otherwise size the slice to the token.
    const left = Math.max(1, text.length - cutChars)
    let x = ndcBox.x0 + wx * Math.min(0.45, Math.max(0.2, 0.1 + (label.text.length / left) * 0.85))
    let y = (ndcBox.y0 + ndcBox.y1) / 2
    const u = inkU?.[cutChars + label.text.length]
    if (u !== undefined) {
      const a = u * Math.PI * 2
      const gap = toNdc(new Vector3(-Math.cos(a), 0, Math.sin(a)).applyMatrix4(main.peel.matrixWorld))
      if (gap.x > ndcBox.x0 + wx * 0.08 && gap.x < ndcBox.x1 - wx * 0.08) { x = gap.x; y = gap.y }
    }
    const lean = 0.07 * wx // a slight slant, like a real slash
    const top = ndcBox.y1 + wy * 0.12
    const bottom = ndcBox.y0 - wy * 0.12
    const start = { x: x + (lean * (top - y)) / wy, y: top }
    const end = { x: x + (lean * (bottom - y)) / wy, y: bottom }
    if (!still) {
      const c = canvas.getBoundingClientRect()
      const toClient = (p: { x: number; y: number }) => stagePoint(c.left + ((p.x + 1) / 2) * c.width, c.top + ((1 - p.y) / 2) * c.height)
      points = []
      blade = { from: toClient(start), to: toClient(end), at: performance.now() }
      await sleep(SWIPE_MS * 0.7)
    }
    slice(start, end, label, rest, true)
    if (!still) await sleep(SETTLE_MS)
  }

  function autoSlice(label: Token, rest?: Token): Promise<void> {
    chain = chain.then(() => runAuto(label, rest)).catch(() => {})
    return chain
  }

  function reset(): void {
    setText(text, tokenCount)
  }

  // ---------- Layout ----------
  const resize = (w: number, h: number) => {
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const c = canvas.getBoundingClientRect()
    const s = stage.getBoundingClientRect()
    const cx = s.left - c.left + s.width / 2
    const cy = s.top - c.top + s.height / 2
    canvasW = w
    canvasH = h
    stageW = s.width
    stageH = s.height
    labelH = stageW < 520 ? LABEL_H * 1.35 : LABEL_H
    // Shift the lens so the orange's center is the stage's center, without off-axis distortion.
    camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
    camera.updateProjectionMatrix()
    px = (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * CAM_Z) / h
    glowCenter.value.set(cx / w, cy / h)
    glowAspect.value = h / w
    plan()
    if (!started) { scale.snap(); offX.snap(); offY.snap() }
  }

  // ---------- Frame ----------
  const pointer = createPointer(window, { reducedMotion: still })
  const m4 = new Matrix4()
  const one = new Vector3()
  const noTurn = new Quaternion()
  let tiltX = 0
  let tiltY = 0
  let last = performance.now()
  let started = false

  const tick = () => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now

    const p = pointer.get()
    tiltX = smoothToward(tiltX, p.x * MAX_TILT_RAD, dt, 3)
    tiltY = smoothToward(tiltY, -p.y * MAX_TILT_RAD, dt, 3)
    hero.rotation.set(tiltY, tiltX, 0)
    hero.scale.setScalar(entrance.step(dt))

    fit.scale.setScalar(scale.step(dt))
    fit.position.set(offX.step(dt), offY.step(dt), 0)

    // Pieces ease out to where they're going.
    const k = 1 - Math.exp(-7 * dt)
    for (const piece of pieces) {
      piece.pos.lerp(piece.toPos, k)
      piece.q.slerp(piece.toQ, k)
      place(piece)
    }

    // A fresh cut glints, then settles to juicy.
    for (let i = glints.length - 1; i >= 0; i--) {
      const g = glints[i]!
      const t = Math.min(1, (now - g.at) / 500)
      g.mat.emissiveIntensity = FLESH_GLOW + (GLINT - FLESH_GLOW) * (1 - t) ** 2
      if (t >= 1) glints.splice(i, 1)
    }

    let live = 0
    for (const d of drop) {
      if (d.life >= d.max) continue
      d.life += dt
      d.v.y -= 7 * dt
      d.p.addScaledVector(d.v, dt)
      const r = d.r * Math.max(0, 1 - d.life / d.max)
      drops.setMatrixAt(live++, m4.compose(d.p, noTurn, one.setScalar(r)))
    }
    drops.count = live
    drops.instanceMatrix.needsUpdate = true

    const { labels } = layout(false)
    for (const piece of pieces) {
      const l = piece.label
      if (!l) continue
      const a = l.appear.step(dt)
      const at = labels.get(l)!
      l.group.visible = a > 0.01
      l.group.position.set(at.x, at.y, 1.1)
      l.group.scale.setScalar(Math.max(0, a) * labelH)
    }

    drawTrail(now)
    if (pipeline) pipeline.render()
    else renderer.render(scene, camera)
  }

  let pipeline: RenderPipeline | null = null
  if (high) {
    pipeline = new RenderPipeline(renderer)
    const scenePass = pass(scene, camera).getTextureNode('output')
    pipeline.outputNode = scenePass.add(bloom(scenePass, 0.25, 0.4, 0.95))
  }

  const ro = new ResizeObserver(() => resize(canvas.clientWidth, canvas.clientHeight))
  ro.observe(canvas)
  ro.observe(stage)
  setText('', 0)
  resize(canvas.clientWidth, canvas.clientHeight)

  return {
    setText,
    slice,
    autoSlice,
    reset,
    start: () => {
      started = true
      last = performance.now()
      setStatus(backend === 'webgpu' ? 'WEBGPU · LIVE' : 'WEBGL · LIVE')
      renderer.setAnimationLoop(tick)
    },
    stop: () => renderer.setAnimationLoop(null),
    resize,
    dispose: () => {
      ro.disconnect()
      pointer.dispose()
      renderer.setAnimationLoop(null)
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onUp)
      trail.remove()
      for (const piece of pieces) disposePiece(piece)
      drops.geometry.dispose()
      drops.dispose()
      for (const m of [peelMat, fleshMat, pillMat, juiceMat]) m.dispose()
      for (const t of [peelTex.map, peelTex.bump, fleshMap]) t.dispose()
      envMap.dispose()
      pipeline?.dispose()
      renderer.dispose()
    },
  }
}
