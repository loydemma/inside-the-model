import {
  AdditiveBlending, BackSide, CanvasTexture, CapsuleGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide, Group, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, NeutralToneMapping, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Quaternion,
  RenderPipeline, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three/webgpu'
import { color, mix, pass, screenUV, smoothstep, uniform, vec2 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createRenderer } from '../../engine/renderer'
import { setStatus } from '../../engine/status'
import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { OrangeScene } from './orangeController'
import type { Token } from './tokenize'
import { buildSlab, slabBounds } from './sliceGeometry'

const STAGE = '#05060a' // matches --stage, so the canvas edge disappears into the page
const GLOW = '#121a44'
const FLASH = new Color('#fff1dc')
const CAM_Z = 10
const FOV = 30
const R = 1 // the orange's radius; the fit group scales it to the stage
const TILT = -0.42 // the cut axis leans toward the camera so the flesh faces show, lit by the warm rim
const LABEL_H = 0.27 // label pill height, in orange radii (larger on a narrow stage)
const LABEL_GAP = 0.16 // between the orange's edge and its label
const WHOLE_FILL = 0.66 // the whole orange's share of the stage's short side

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
// texel covers less of the surface.
function peelTextures(W: number): { map: CanvasTexture; bump: CanvasTexture } {
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

  const map = new CanvasTexture(cc)
  map.colorSpace = SRGBColorSpace
  const bump = new CanvasTexture(bc)
  for (const t of [map, bump]) { t.wrapS = RepeatWrapping; t.anisotropy = 8 }
  return { map, bump }
}

// The cut face: peel rim, white pith, eleven juicy segments with membranes and juice sacs.
function fleshTexture(S: number): CanvasTexture {
  const [c, g] = canvas2d(S, S)
  const rng = rand(3)
  const cx = S / 2
  const R0 = S / 2
  const disc = (r: number, fill: string | CanvasGradient) => {
    g.beginPath()
    g.arc(cx, cx, r * R0, 0, Math.PI * 2)
    g.fillStyle = fill
    g.fill()
  }
  disc(1, '#e2700e')
  disc(0.95, '#f6e3c2')
  const SEG = 11
  const flesh = g.createRadialGradient(cx, cx, R0 * 0.1, cx, cx, R0 * 0.88)
  flesh.addColorStop(0, '#ffc15a')
  flesh.addColorStop(0.55, '#f9a033')
  flesh.addColorStop(1, '#ef8719')
  disc(0.885, '#f3d9a8')
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * Math.PI * 2 + 0.035
    const a1 = ((s + 1) / SEG) * Math.PI * 2 - 0.035
    g.beginPath()
    g.moveTo(cx + Math.cos((a0 + a1) / 2) * R0 * 0.13, cx + Math.sin((a0 + a1) / 2) * R0 * 0.13)
    g.arc(cx, cx, R0 * 0.865, a0, a1)
    g.closePath()
    g.fillStyle = flesh
    g.fill()
  }
  // Juice sacs: small radial teardrops, lighter and darker.
  g.save()
  for (let i = 0; i < S * 5; i++) {
    const a = rng() * Math.PI * 2
    const local = (a / (Math.PI * 2)) * SEG
    if (Math.abs(local - Math.round(local)) < 0.06) continue
    const r = (0.16 + rng() * 0.68) * R0
    g.setTransform(1, 0, 0, 1, cx + Math.cos(a) * r, cx + Math.sin(a) * r)
    g.rotate(a)
    g.beginPath()
    g.ellipse(0, 0, R0 * (0.03 + rng() * 0.03), R0 * (0.007 + rng() * 0.006), 0, 0, Math.PI * 2)
    g.fillStyle = rng() < 0.6 ? 'rgba(255,214,140,0.38)' : 'rgba(214,100,10,0.32)'
    g.fill()
  }
  g.restore()
  disc(0.12, '#f8e8c8')
  const map = new CanvasTexture(c)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  return map
}

// Token text plus its ID, white and accent on transparent. Spaces show as ␣ so they don't vanish.
function labelTexture(token: Token): { map: CanvasTexture; aspect: number } {
  const H = 128
  const text = token.text.replace(/ /g, '␣').replace(/\n/g, '↵').replace(/\t/g, '⇥')
  const id = String(token.id)
  const fText = '600 64px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif'
  const fId = '500 38px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif'
  const [, m] = canvas2d(1, 1)
  m.font = fText
  const tw = m.measureText(text).width
  m.font = fId
  const iw = m.measureText(id).width
  const gap = 18
  const w = Math.ceil(tw + gap + iw) + 8
  const [c, g] = canvas2d(w, H)
  g.textBaseline = 'middle'
  g.font = fText
  g.fillStyle = '#f5f5f7'
  g.fillText(text, 4, H / 2 + 3)
  g.font = fId
  g.fillStyle = '#a9b3ff'
  g.fillText(id, 4 + tw + gap, H / 2 + 5)
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

type Slab = { group: Group; peel: Mesh; caps: Mesh; center: number }
type Label = { group: Group; text: Mesh; w: number; appear: Spring }

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
  scene.environment = pmrem.fromScene(studio, 0.03).texture
  pmrem.dispose()

  const key = new DirectionalLight('#fff3e4', 3)
  key.position.set(-4, 6, 7)
  const fill = new DirectionalLight('#ffe0c0', 0.9)
  fill.position.set(2, -1, 8)
  const rimWarm = new DirectionalLight('#ffb062', 5)
  rimWarm.position.set(6, 3, -6)
  const rimCool = new DirectionalLight('#7d8cff', 1.8)
  rimCool.position.set(-7, 2, -5)
  scene.add(key, fill, rimWarm, rimCool)

  const peelTex = peelTextures(high ? 2048 : 1024)
  const fleshMap = fleshTexture(high ? 1024 : 512)
  const peelMat = new MeshPhysicalMaterial({
    map: peelTex.map, bumpMap: peelTex.bump, bumpScale: 0.9, roughness: 0.42,
    clearcoat: 0.55, clearcoatRoughness: 0.32, sheen: 0.3, sheenColor: new Color('#ffb066'), sheenRoughness: 0.6,
  })
  const fleshMat = new MeshPhysicalMaterial({
    map: fleshMap, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.14,
    emissive: new Color('#ff8a24'), emissiveMap: fleshMap, emissiveIntensity: 0.32,
  })
  const pillMat = new MeshPhysicalMaterial({
    color: '#161925', metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.09, iridescence: 0.15,
  })
  const flashMat = new MeshBasicMaterial({
    color: FLASH, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false,
  })
  const segments = high ? 112 : 64

  // hero (pointer tilt) > fit (scale and centering) > axis (cut angle) > spin > slabs.
  const hero = new Group()
  const fit = new Group()
  const axis = new Group()
  const spin = new Group()
  scene.add(hero)
  hero.add(fit)
  fit.add(axis)
  axis.add(spin)

  let slabs: Slab[] = []
  let labels: Label[] = []
  let flashes: Mesh[] = []
  let tokens: Token[] = []
  let bounds: [number, number][] = [[-R, R]]

  const gap = new Spring(0, 0, 60, 0.72)
  const roll = new Spring(0, 0, 55, 0.85)
  const scale = new Spring(1, 1, 50, 0.9)
  const offX = new Spring(0, 0, 50, 0.9)
  const offY = new Spring(0, 0, 50, 0.9)
  const entrance = new Spring(still ? 1 : 0.82, 1, 40, 0.7)
  let flashAt = -1
  let angle = 0
  let sliced = false
  let openGap = 0.25
  let labelScale = 1
  let radial = false
  const dir = new Vector3(1, 0, 0)
  const side = new Vector3(0, -1, 0)

  // Stage rect inside the canvas, and world units per pixel at the orange's depth.
  let stageW = 300
  let labelH = LABEL_H
  let stageH = 300
  let px = 0.01

  const queue: { at: number; run: () => void }[] = []
  const later = (at: number, run: () => void) => { queue.push({ at, run }); queue.sort((a, b) => a.at - b.at) }

  function clearSlabs(): void {
    for (const s of slabs) { s.peel.geometry.dispose(); s.caps.geometry.dispose(); spin.remove(s.group) }
    for (const l of labels) { (l.text.material as MeshBasicMaterial).map?.dispose(); (l.text.material as MeshBasicMaterial).dispose(); l.text.geometry.dispose(); (l.group.children[0] as Mesh).geometry.dispose(); fit.remove(l.group) }
    for (const f of flashes) { f.geometry.dispose(); spin.remove(f) }
    slabs = []
    labels = []
    flashes = []
  }

  function build(): void {
    clearSlabs()
    const n = Math.max(1, tokens.length)
    bounds = slabBounds(R, n)
    slabs = bounds.map(([x0, x1]) => {
      const { peel, caps } = buildSlab(R, x0, x1, segments)
      const group = new Group()
      const pm = new Mesh(peel, peelMat)
      const cm = new Mesh(caps, fleshMat)
      group.add(pm, cm)
      spin.add(group)
      return { group, peel: pm, caps: cm, center: (x0 + x1) / 2 }
    })
    for (let i = 1; i < n; i++) {
      const x = bounds[i]![0]
      const f = new Mesh(new CircleGeometry(Math.sqrt(R * R - x * x) * 1.06, 48), flashMat)
      f.rotation.y = Math.PI / 2
      f.position.x = x
      f.visible = false
      spin.add(f)
      flashes.push(f)
    }
    labels = tokens.map((t) => {
      const { map, aspect } = labelTexture(t)
      const w = Math.max(1.6, aspect + 0.95)
      const pill = new Mesh(new CapsuleGeometry(0.5, w - 1, high ? 8 : 5, high ? 28 : 18), pillMat)
      pill.geometry.rotateZ(Math.PI / 2)
      pill.scale.z = 0.55
      const text = new Mesh(new PlaneGeometry(aspect, 1), new MeshBasicMaterial({ map, color: new Color(0.9, 0.9, 0.9), transparent: true, depthWrite: false, toneMapped: false }))
      text.position.z = 0.29
      text.renderOrder = 2
      const group = new Group()
      group.add(pill, text)
      group.visible = false
      fit.add(group)
      return { group, text, w, appear: new Spring(0, 0, 90, 0.62) }
    })
  }

  // Where things go for the current cut: the gap between pieces, label layout and the fit.
  function plan(): void {
    const d = dir
    const n = slabs.length
    const cosT = Math.cos(TILT)
    const along = (w: number) => Math.abs(w * labelH * d.x) + Math.abs(labelH * d.y)
    const widest = labels.reduce((m, l) => Math.max(m, along(l.w)), 0)
    // Few pieces: open wide enough that flat labels sit side by side. Many: labels turn to
    // point away from the orange, and shrink only if even that is too tight.
    const flatGap = (widest * 1.12) / cosT - (2 * R) / n
    radial = !(n <= 5 && flatGap <= 0.95)
    openGap = n === 1 ? 0 : radial ? (n > 8 ? 0.16 : 0.24) : Math.max(0.24, flatGap)
    const pitch = ((2 * R) / n + openGap) * cosT
    labelScale = radial ? Math.min(1, pitch / (labelH * 1.15)) : 1
    if (n === 1) { radial = false; labelScale = 1 }
    // Bounding box of the opened pieces and labels, in orange radii.
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    const grow = (x: number, y: number, hx: number, hy: number) => {
      x0 = Math.min(x0, x - hx); x1 = Math.max(x1, x + hx); y0 = Math.min(y0, y - hy); y1 = Math.max(y1, y + hy)
    }
    slabs.forEach((s, i) => {
      const c = (s.center + (i - (n - 1) / 2) * openGap) * cosT
      grow(c * d.x, c * d.y, R, R)
      const l = labels[i]
      if (!l) return
      const { cx, cy, hx, hy } = labelBox(c * d.x, c * d.y, l.w)
      grow(cx, cy, hx, hy)
    })
    const fitScale = Math.min((stageW * px * 0.92) / (x1 - x0), (stageH * px * 0.9) / (y1 - y0))
    const wholeScale = (Math.min(stageW, stageH) * px * WHOLE_FILL) / (2 * R)
    if (sliced) {
      scale.target = Math.min(fitScale, wholeScale)
      offX.target = -((x0 + x1) / 2) * scale.target
      offY.target = -((y0 + y1) / 2) * scale.target
    } else {
      scale.target = wholeScale
      offX.target = 0
      offY.target = 0
    }
  }

  // A label's center and half-extent next to a piece centered at (x, y).
  function labelBox(x: number, y: number, w: number): { cx: number; cy: number; hx: number; hy: number; rot: number } {
    const h = labelH * labelScale
    const lw = w * h
    if (radial) {
      const reach = R + LABEL_GAP + lw / 2
      const rot = Math.atan2(side.y, side.x)
      const readable = rot > Math.PI / 2 ? rot - Math.PI : rot < -Math.PI / 2 ? rot + Math.PI : rot
      return {
        cx: x + side.x * reach, cy: y + side.y * reach, rot: readable,
        hx: Math.abs((lw / 2) * Math.cos(readable)) + Math.abs((h / 2) * Math.sin(readable)),
        hy: Math.abs((lw / 2) * Math.sin(readable)) + Math.abs((h / 2) * Math.cos(readable)),
      }
    }
    const ext = Math.abs(lw * side.x) + Math.abs(h * side.y)
    const reach = R + LABEL_GAP + ext / 2
    return { cx: x + side.x * reach, cy: y + side.y * reach, hx: lw / 2, hy: h / 2, rot: 0 }
  }

  function setAngle(deg: number): void {
    angle = deg
    const a = (deg * Math.PI) / 180
    // Pieces read left to right (top to bottom when vertical), like the word.
    dir.set(Math.cos(a), -Math.sin(a), 0)
    if (dir.x < -1e-6) dir.negate()
    if (Math.abs(dir.x) < 1e-6) dir.set(0, -1, 0)
    // Labels sit below the pieces, or to the right of a vertical stack.
    side.set(-dir.y, dir.x, 0)
    if (side.y > 1e-6) side.negate()
    if (Math.abs(side.y) < 1e-6 && side.x < 0) side.negate()
    const target = Math.atan2(dir.y, dir.x)
    roll.target = target
  }

  function whole(): void {
    queue.length = 0
    sliced = false
    gap.target = 0
    for (const l of labels) l.appear.target = 0
    plan()
    if (still) { gap.snap(); for (const l of labels) l.appear.snap() }
  }

  function setTokens(next: Token[]): void {
    tokens = next
    const g = gap.x
    build()
    whole()
    // The new pieces start where the old ones were and close up.
    gap.x = still ? 0 : g
  }

  function open(): void {
    sliced = true
    plan()
    gap.target = openGap
    const now = performance.now()
    labels.forEach((l, i) => later(now + 120 + i * 70, () => { l.appear.target = labelScale }))
    if (still) {
      queue.length = 0
      gap.snap()
      for (const l of labels) { l.appear.target = labelScale; l.appear.snap() }
      scale.snap(); offX.snap(); offY.snap()
    }
  }

  function slice(deg: number): void {
    const wasOpen = sliced && gap.x > 0.02
    const turning = deg !== angle
    queue.length = 0
    sliced = false
    gap.target = 0
    for (const l of labels) l.appear.target = 0
    setAngle(deg)
    if (still) { roll.snap(); open(); return }
    plan()
    let t = performance.now()
    if (wasOpen) t += 380
    else if (turning) t += 260
    if (slabs.length > 1) {
      later(t, () => { flashAt = performance.now() })
      t += 200
    }
    later(t, open)
  }

  function reset(): void {
    whole()
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
  const qRoll = new Quaternion()
  const qTilt = new Quaternion()
  const zAxis = new Vector3(0, 0, 1)
  const tiltAxis = new Vector3()
  const p3 = new Vector3()
  let tiltX = 0
  let tiltY = 0
  let last = performance.now()
  let started = false

  const tick = () => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    while (queue.length && now >= queue[0]!.at) queue.shift()!.run()

    const p = pointer.get()
    tiltX = smoothToward(tiltX, p.x * MAX_TILT_RAD, dt, 3)
    tiltY = smoothToward(tiltY, -p.y * MAX_TILT_RAD, dt, 3)
    hero.rotation.set(tiltY, tiltX, 0)
    hero.scale.setScalar(entrance.step(dt))

    const s = scale.step(dt)
    fit.scale.setScalar(s)
    fit.position.set(offX.step(dt), offY.step(dt), 0)
    const r = roll.step(dt)
    qRoll.setFromAxisAngle(zAxis, r)
    tiltAxis.set(-Math.sin(r), Math.cos(r), 0)
    qTilt.setFromAxisAngle(tiltAxis, TILT)
    axis.quaternion.multiplyQuaternions(qTilt, qRoll)
    if (!still) spin.rotation.x += dt * 0.12

    const g = Math.max(0, gap.step(dt))
    const n = slabs.length
    slabs.forEach((sl, i) => { sl.group.position.x = (i - (n - 1) / 2) * g })

    // The cut: bright planes sweep through the orange, then fade.
    const fk = flashAt < 0 ? 1 : (now - flashAt) / 360
    for (const f of flashes) {
      f.visible = fk < 1
      if (!f.visible) continue
      const sweep = Math.min(1, fk / 0.35)
      f.scale.set(1, sweep, 1 - (1 - sweep) * 0.92)
    }
    flashMat.opacity = fk < 1 ? (fk < 0.35 ? 1 : 1 - (fk - 0.35) / 0.65) * 0.9 : 0

    labels.forEach((l, i) => {
      const a = l.appear.step(dt)
      l.group.visible = a > 0.01
      if (!l.group.visible) return
      const sl = slabs[i]!
      p3.set(sl.center + sl.group.position.x, 0, 0).applyQuaternion(axis.quaternion)
      const box = labelBox(p3.x, p3.y, l.w)
      l.group.position.set(box.cx, box.cy, 0.1) // flat, so a row of labels lines up
      l.group.rotation.z = box.rot
      l.group.scale.setScalar(Math.max(0, a) * labelH)
    })

    if (pipeline) pipeline.render()
    else renderer.render(scene, camera)
  }

  let pipeline: RenderPipeline | null = null
  if (high) {
    pipeline = new RenderPipeline(renderer)
    const scenePass = pass(scene, camera).getTextureNode('output')
    pipeline.outputNode = scenePass.add(bloom(scenePass, 0.3, 0.4, 0.95))
  }

  const ro = new ResizeObserver(() => resize(canvas.clientWidth, canvas.clientHeight))
  ro.observe(canvas)
  ro.observe(stage)
  build()
  setAngle(0)
  roll.snap()
  resize(canvas.clientWidth, canvas.clientHeight)

  return {
    setTokens,
    slice,
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
      clearSlabs()
      for (const m of [peelMat, fleshMat, pillMat, flashMat]) m.dispose()
      for (const t of [peelTex.map, peelTex.bump, fleshMap]) t.dispose()
      renderer.dispose()
    },
  }
}
