import {
  BackSide, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DirectionalLight, DoubleSide, Group,
  IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial,
  NeutralToneMapping, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Quaternion, RenderPipeline, Scene,
  SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3,
} from 'three/webgpu'
import { color, float, mix, pass, screenUV, smoothstep, texture, uniform, uv, vec2 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createRenderer } from '../../engine/renderer'
import { setStatus } from '../../engine/status'
import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { FlowerScene } from './flowerController'

const STAGE = '#05060a'
const GLOW = '#121a44'
const CAM_Z = 10
const FOV = 30
const GOLDEN = (137.508 * Math.PI) / 180
const FILL = 0.66 // the open bloom's share of the stage's short side
const BLOOM_D = 3.1 // the open bloom's natural diameter, in world units
const SEG_U = 10
const SEG_V = 22
const SEEDS = 220

// Two palettes: warm and a little feverish while it guesses; cool and steady once it has a source.
const MOODS = {
  guess: { base: '#d63a6e', mid: '#ff5c8a', tip: '#ffc4b4', heart: '#ffb43a', glow: '#ff7a59' },
  grounded: { base: '#3d63d8', mid: '#7fa4ff', tip: '#dfe9ff', heart: '#9ff0e0', glow: '#7fb0ff' },
}
const INVENTED = { base: '#7a0618', mid: '#e0283c', tip: '#ff9a8a' }

// Damped spring; a ratio below 1 gives a small, organic settle.
class Spring {
  v = 0
  constructor(public x: number, public target = x, public k = 60, public ratio = 0.62) {}
  step(dt: number): number {
    const c = 2 * Math.sqrt(this.k) * this.ratio
    this.v += (this.k * (this.target - this.x) - c * this.v) * dt
    this.x += this.v * dt
    return this.x
  }
  snap(): void { this.x = this.target; this.v = 0 }
}

function untoned(hex: string): Color {
  const t = new Color(hex)
  const m = Math.min(t.r, t.g, t.b)
  const d = Math.sqrt(m / 6.25) - m
  return new Color(t.r + d, t.g + d, t.b + d)
}

// Petal veins: fine lines fanning from the base, a soft midrib, and a darker throat. Luminance only;
// the color comes from the mood palette.
function veinTexture(): CanvasTexture {
  const W = 256
  const H = 512
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  g.lineCap = 'round'
  for (let i = 0; i < 26; i++) {
    const s = (i / 25) * 2 - 1
    g.strokeStyle = `rgba(80,40,60,${0.1 + 0.08 * (1 - Math.abs(s))})`
    g.lineWidth = 1.4 + (1 - Math.abs(s)) * 1.2
    g.beginPath()
    g.moveTo(W / 2 + s * 6, H)
    g.bezierCurveTo(W / 2 + s * W * 0.22, H * 0.62, W / 2 + s * W * 0.42, H * 0.3, W / 2 + s * W * 0.36, H * 0.02)
    g.stroke()
  }
  const rib = g.createLinearGradient(W * 0.44, 0, W * 0.56, 0)
  rib.addColorStop(0, 'rgba(90,40,60,0)')
  rib.addColorStop(0.5, 'rgba(90,40,60,0.16)')
  rib.addColorStop(1, 'rgba(90,40,60,0)')
  g.fillStyle = rib
  g.fillRect(0, H * 0.25, W, H * 0.75)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

// A petal: base at the origin, running up +Y, its inner face toward -Z. `curl` bends it along its
// length toward the inner face (a closed bud) or away (negative: an open, slightly reflexed petal);
// `cup` lifts its edges toward the inner face.
function petalGeometry(): BufferGeometry {
  const geo = new BufferGeometry()
  const n = (SEG_U + 1) * (SEG_V + 1)
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3))
  const uvs = new Float32Array(n * 2)
  const index: number[] = []
  for (let j = 0; j <= SEG_V; j++) {
    for (let i = 0; i <= SEG_U; i++) {
      const k = j * (SEG_U + 1) + i
      uvs[k * 2] = i / SEG_U
      uvs[k * 2 + 1] = j / SEG_V
      if (i < SEG_U && j < SEG_V) {
        const a = k
        const b = k + 1
        const c = k + SEG_U + 1
        const d = c + 1
        index.push(a, b, d, a, d, c)
      }
    }
  }
  geo.setAttribute('uv', new BufferAttribute(uvs, 2))
  geo.setIndex(index)
  return geo
}

function shapePetal(geo: BufferGeometry, curl: number, cup: number, ruffle: number, seed: number): void {
  const pos = geo.getAttribute('position') as BufferAttribute
  const step = 1 / SEG_V
  let y = 0
  let z = 0
  for (let j = 0; j <= SEG_V; j++) {
    const v = j / SEG_V
    const phi = curl * v ** 1.6
    if (j > 0) {
      const pv = (j - 0.5) / SEG_V
      const pphi = curl * pv ** 1.6
      y += Math.cos(pphi) * step
      z -= Math.sin(pphi) * step
    }
    // Inner-face normal of the spine.
    const ny = -Math.sin(phi)
    const nz = -Math.cos(phi)
    const width = 0.5 * Math.sin(Math.PI * Math.min(1, v ** 0.72)) ** 0.75 * (1 - 0.08 * v)
    for (let i = 0; i <= SEG_U; i++) {
      const s = (i / SEG_U) * 2 - 1
      const x = s * width
      const lift = cup * x * x * 2.2 + ruffle * Math.sin(s * 5 + seed + v * 7) * 0.03 * v * Math.abs(s)
      const k = j * (SEG_U + 1) + i
      pos.setXYZ(k, x, y + ny * lift, z + nz * lift)
    }
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
}

interface Petal {
  pivot: Group
  mesh: Mesh
  open: Spring
  shaped: number // the open amount the geometry was last shaped for
  closedTilt: number
  openTilt: number
  size: number
  widthK: number
  seed: number
  invented: boolean
}

export async function createFlowerScene(canvas: HTMLCanvasElement, q: Quality): Promise<FlowerScene> {
  const still = q.reducedMotion
  const high = q.tier === 'high'
  const stage = (canvas.closest('section')?.querySelector('[data-flower-stage]') ?? canvas) as HTMLElement
  const { renderer, backend } = await createRenderer(canvas, q)
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1

  const scene = new Scene()
  const glowCenter = uniform(vec2(0.5, 0.5))
  const glowAspect = uniform(1)
  const moodGlow = uniform(untoned(GLOW))
  const falloff = smoothstep(0.7, 0.0, screenUV.sub(glowCenter).mul(vec2(1.0, glowAspect)).length())
  scene.backgroundNode = mix(color(untoned(STAGE)), moodGlow, falloff.mul(falloff))
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60)
  camera.position.set(0, 0, CAM_Z)

  // A dark studio with soft boxes, so the petals get product-shot sheen.
  const studio = new Scene()
  studio.add(new Mesh(new SphereGeometry(20, 16, 8), new MeshBasicMaterial({ color: '#010103', side: BackSide })))
  const softbox = (w: number, h: number, c: string, k: number, p: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c).multiplyScalar(k), side: BackSide }))
    m.position.set(...p)
    m.lookAt(0, 0, 0)
    studio.add(m)
  }
  softbox(12, 5, '#fff6ec', 4, [-4, 9, 6])
  softbox(1.6, 10, '#8f9cff', 3, [-9, 1, -3])
  softbox(1.8, 9, '#ffc0d0', 3, [9, 0, -2])
  const pmrem = new PMREMGenerator(renderer)
  const envMap = pmrem.fromScene(studio, 0.03)
  scene.environment = envMap.texture
  pmrem.dispose()
  studio.traverse((o) => {
    if (o instanceof Mesh) { o.geometry.dispose(); (o.material as MeshBasicMaterial).dispose() }
  })

  const key = new DirectionalLight('#fff1e8', 2.6)
  key.position.set(-4, 7, 6)
  const rim = new DirectionalLight('#9fb0ff', 2.2)
  rim.position.set(5, 3, -6)
  const heartLight = new PointLight('#ffb070', 1, 1.6, 2) // light from the heart, so the inner faces glow
  heartLight.position.set(0, 0.35, 0)
  scene.add(key, rim)

  // Mood colors, shared by every petal (uniforms ease toward their target).
  const cBase = uniform(new Color(MOODS.guess.base))
  const cMid = uniform(new Color(MOODS.guess.mid))
  const cTip = uniform(new Color(MOODS.guess.tip))
  const cHeart = uniform(new Color(MOODS.guess.heart))
  const veins = veinTexture()
  const petalColor = (base: typeof cBase, mid: typeof cBase, tip: typeof cBase) => {
    const v = uv().y
    const grad = mix(mix(base, mid, smoothstep(0.0, 0.45, v)), tip, smoothstep(0.4, 1.0, v))
    return grad.mul(texture(veins).r.mul(0.5).add(0.5))
  }
  const makePetalMat = (base: typeof cBase, mid: typeof cBase, tip: typeof cBase) => {
    const m = new MeshPhysicalNodeMaterial({ side: DoubleSide, roughness: 0.52, sheen: 0.6, sheenRoughness: 0.4 })
    m.colorNode = petalColor(base, mid, tip)
    m.sheenNode = mid
    // A soft inner glow, strongest at the throat, so the bloom reads as lit from within.
    m.emissiveNode = mix(base, mid, float(0.5)).mul(smoothstep(0.6, 0.0, uv().y).mul(0.2))
    return m
  }
  const petalMat = makePetalMat(cBase, cMid, cTip)
  const iBase = uniform(new Color(INVENTED.base))
  const iMid = uniform(new Color(INVENTED.mid))
  const iTip = uniform(new Color(INVENTED.tip))
  const inventedMat = makePetalMat(iBase, iMid, iTip)

  // Hierarchy: hero (pointer tilt) > fit (scale and centering) > flower (faces the camera a little).
  const hero = new Group()
  const fit = new Group()
  const flower = new Group()
  flower.rotation.x = 0.78
  hero.add(fit)
  fit.add(flower)
  scene.add(hero)
  flower.add(heartLight)

  // The heart: a soft dome of seeds laid out on the golden angle too.
  const heartMat = new MeshStandardNodeMaterial({ roughness: 0.55 })
  heartMat.colorNode = cHeart
  heartMat.emissiveNode = cHeart.mul(0.12)
  const dome = new Mesh(new SphereGeometry(0.26, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), heartMat)
  dome.scale.y = 0.42
  flower.add(dome)
  const seedMat = new MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 })
  seedMat.colorNode = cHeart.mul(0.75)
  seedMat.emissiveNode = cHeart.mul(0.2)
  const seeds = new InstancedMesh(new IcosahedronGeometry(1, 1), seedMat, SEEDS)
  {
    const m = new Matrix4()
    const p = new Vector3()
    const s = new Vector3()
    const qn = new Quaternion()
    for (let i = 0; i < SEEDS; i++) {
      const r = 0.25 * Math.sqrt((i + 0.5) / SEEDS)
      const a = i * GOLDEN
      const h = 0.11 * Math.sqrt(Math.max(0, 1 - (r / 0.26) ** 2))
      p.set(Math.cos(a) * r, h + 0.004, Math.sin(a) * r)
      s.setScalar(0.011 + 0.006 * (1 - r / 0.25))
      seeds.setMatrixAt(i, m.compose(p, qn, s))
    }
  }
  flower.add(seeds)

  // Stem and sepals, in a deep green that fades out down the page.
  const green = new MeshPhysicalNodeMaterial({ roughness: 0.42, clearcoat: 0.4 })
  green.colorNode = color('#1f5a32')
  const stemCurve = new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(0.05, -0.8, -0.1), new Vector3(-0.12, -2.0, -0.25), new Vector3(0.08, -3.6, -0.3),
  ])
  const stemMat = new MeshPhysicalNodeMaterial({ roughness: 0.42, clearcoat: 0.4, transparent: true })
  stemMat.colorNode = color('#1f5a32')
  stemMat.opacityNode = smoothstep(1.0, 0.45, uv().x)
  const stem = new Mesh(new TubeGeometry(stemCurve, 48, 0.055, 12), stemMat)
  fit.add(stem)
  const sepalGeo = petalGeometry()
  shapePetal(sepalGeo, -0.3, 0.25, 0, 0)
  const sepals: Mesh[] = []
  for (let i = 0; i < 5; i++) {
    const pivot = new Group()
    pivot.rotation.y = (i / 5) * Math.PI * 2 + 0.3
    const m = new Mesh(sepalGeo, green)
    m.rotation.x = 1.75
    m.scale.set(0.5, 0.62, 0.5)
    pivot.add(m)
    flower.add(pivot)
    sepals.push(m)
  }

  // ---------- Petals ----------
  let petals: Petal[] = []
  let holdP = 0

  function disposePetals(): void {
    for (const p of petals) { p.mesh.geometry.dispose(); p.pivot.removeFromParent() }
    petals = []
  }

  // n petals on the golden angle. Earlier petals sit outside, bigger and flatter, so the bloom opens
  // from the outside in; unopened petals stay folded into a bud around the heart.
  function setPetalCount(n: number): void {
    disposePetals()
    for (let i = 0; i < n; i++) {
      const r = n === 1 ? 0 : i / (n - 1)
      const pivot = new Group()
      pivot.rotation.y = i * GOLDEN
      const mesh = new Mesh(petalGeometry(), petalMat)
      const size = 1.42 - 0.62 * r
      mesh.position.z = 0.04 + 0.12 * (1 - r) // set out from the heart
      pivot.add(mesh)
      flower.add(pivot)
      const petal: Petal = {
        pivot, mesh, open: new Spring(0, 0, 55, 0.6), shaped: -1,
        closedTilt: 0.05 + 0.06 * r, openTilt: 1.45 - 0.8 * r, size, widthK: 1.05 - 0.2 * r, seed: i * 1.7, invented: false,
      }
      shape(petal, 0)
      petals.push(petal)
    }
  }

  function shape(p: Petal, a: number): void {
    const t = Math.max(-0.1, Math.min(1.15, a))
    // Closed: curled hard over the heart. Open: tips relax back a little.
    shapePetal(p.mesh.geometry, 1.15 * (1 - t) - 0.35 * t, 0.7 * (1 - t) + 0.32 * t, t, p.seed)
    // A folded petal is smaller, so the bud stays neat around the heart.
    const k = p.size * (0.62 + 0.38 * Math.min(1, Math.max(0, t)))
    p.mesh.scale.set(k * p.widthK, k, k)
    p.mesh.rotation.x = (p.closedTilt + (p.openTilt - p.closedTilt) * t)
    p.shaped = a
  }

  function openPetal(i: number, invented = false): void {
    const p = petals[i]
    if (!p) return
    p.open.target = 1
    p.invented = invented
    p.mesh.material = invented ? inventedMat : petalMat
    if (still) { p.open.snap(); shape(p, 1) }
  }

  function reset(): void {
    for (const p of petals) {
      p.open.target = 0
      p.open.snap()
      p.invented = false
      p.mesh.material = petalMat
      shape(p, 0)
    }
    entrance.x = still ? 1 : 0.9
  }

  // ---------- Mood ----------
  const mood = new Spring(0, 0, 6, 1)
  const from = { base: new Color(), mid: new Color(), tip: new Color(), heart: new Color(), glow: new Color() }
  const to = { base: new Color(), mid: new Color(), tip: new Color(), heart: new Color(), glow: new Color() }
  for (const k of Object.keys(from) as (keyof typeof from)[]) {
    from[k].set(MOODS.guess[k])
    to[k].set(MOODS.grounded[k])
  }
  const glowGuess = untoned('#1d1240')
  const glowGround = untoned('#0f1d4a')
  function setMood(m: 'guess' | 'grounded'): void {
    mood.target = m === 'grounded' ? 1 : 0
    if (still) mood.snap()
  }
  function applyMood(t: number): void {
    ;(cBase.value as Color).lerpColors(from.base, to.base, t)
    ;(cMid.value as Color).lerpColors(from.mid, to.mid, t)
    ;(cTip.value as Color).lerpColors(from.tip, to.tip, t)
    ;(cHeart.value as Color).lerpColors(from.heart, to.heart, t)
    ;(moodGlow.value as Color).lerpColors(glowGuess, glowGround, t)
    heartLight.color.lerpColors(from.glow, to.glow, t)
  }

  // ---------- Layout ----------
  const entrance = new Spring(still ? 1 : 0.9, 1, 30, 0.7)
  const scale = new Spring(1, 1, 40, 1)
  const offX = new Spring(0, 0, 40, 1)
  const offY = new Spring(0, 0, 40, 1)
  let started = false
  const resize = (w: number, h: number) => {
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const c = canvas.getBoundingClientRect()
    const s = stage.getBoundingClientRect()
    const cx = s.left - c.left + s.width / 2
    const cy = s.top - c.top + s.height / 2
    camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
    camera.updateProjectionMatrix()
    const px = (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * CAM_Z) / h
    glowCenter.value.set(cx / w, cy / h)
    glowAspect.value = h / w
    const k = (FILL * Math.min(s.width, s.height) * px) / BLOOM_D
    scale.target = k
    offY.target = 0.08 * s.height * px // lift the bloom so a little stem shows below
    if (!started) { scale.snap(); offX.snap(); offY.snap() }
  }

  // ---------- Frame ----------
  const pointer = createPointer(window, { reducedMotion: still })
  let tiltX = 0
  let tiltY = 0
  let last = performance.now()
  let time = 0

  const tick = () => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    time += dt

    const p = pointer.get()
    tiltX = smoothToward(tiltX, p.x * MAX_TILT_RAD, dt, 3)
    tiltY = smoothToward(tiltY, -p.y * MAX_TILT_RAD, dt, 3)
    const sway = still ? 0 : Math.sin(time * 0.7) * 0.025
    hero.rotation.set(tiltY, tiltX + sway, sway * 0.4)
    hero.scale.setScalar(entrance.step(dt))
    fit.scale.setScalar(scale.step(dt))
    fit.position.set(offX.step(dt), offY.step(dt), 0)
    applyMood(Math.max(0, Math.min(1, mood.step(dt))))

    // The next petal stirs while you hold; opened ones unfurl on a spring.
    const next = petals.findIndex((pt) => pt.open.target === 0)
    for (let i = 0; i < petals.length; i++) {
      const pt = petals[i]!
      if (i === next && pt.open.target === 0) pt.open.x = smoothToward(pt.open.x, holdP * 0.16, dt, 10)
      else pt.open.step(dt)
      if (Math.abs(pt.open.x - pt.shaped) > 0.002) shape(pt, pt.open.x)
    }
    heartLight.intensity = 1 + 0.8 * Math.min(1, petals.filter((pt) => pt.open.target === 1).length / Math.max(1, petals.length))

    if (pipeline) pipeline.render()
    else renderer.render(scene, camera)
  }

  let pipeline: RenderPipeline | null = null
  if (high) {
    pipeline = new RenderPipeline(renderer)
    const scenePass = pass(scene, camera).getTextureNode('output')
    pipeline.outputNode = scenePass.add(bloom(scenePass, 0.18, 0.4, 0.92))
  }

  const ro = new ResizeObserver(() => resize(canvas.clientWidth, canvas.clientHeight))
  ro.observe(canvas)
  ro.observe(stage)
  setPetalCount(0)
  resize(canvas.clientWidth, canvas.clientHeight)

  return {
    setPetalCount,
    openPetal,
    setHoldProgress: (v: number) => { holdP = v },
    setMood,
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
      disposePetals()
      sepalGeo.dispose()
      stem.geometry.dispose()
      dome.geometry.dispose()
      seeds.geometry.dispose()
      seeds.dispose()
      for (const m of [petalMat, inventedMat, heartMat, seedMat, green, stemMat]) m.dispose()
      veins.dispose()
      envMap.dispose()
      pipeline?.dispose()
      renderer.dispose()
    },
  }
}
