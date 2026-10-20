import {
  BackSide, BufferAttribute, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, Color, DirectionalLight, DoubleSide, Euler,
  Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial,
  NeutralToneMapping, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Quaternion, RenderPipeline,
  RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, TextureLoader, TubeGeometry, Vector3, type Node, type Texture,
} from 'three/webgpu'
import { abs, color, dot, mix, pass, screenUV, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createRenderer } from '../../engine/renderer'
import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { FlowerScene } from './flowerController'
import petalRoseUrl from './petal-rose.jpg'
import petalBlueUrl from './petal-blue.jpg'
import petalWhiteUrl from './petal-white.jpg'
import leafUrl from './leaf.jpg'
import stemUrl from './stem.jpg'

const STAGE = '#05060a'
const GLOW = '#121a44'
const CAM_Z = 10
const FOV = 30
const GOLDEN = (137.508 * Math.PI) / 180
const FILL = 0.66 // the open bloom's share of the stage's short side
const BLOOM_D = 3.1 // the open bloom's natural diameter, in world units
const SEG_U = 10
const SEG_V = 22
const STAMENS = 64

// Two moods: warm and golden while it guesses; cool and steady once it has a source. The petal
// photos carry the color; these tint the heart, its glow and the lights.
const MOODS = {
  guess: { heart: '#ffae12', glow: '#ffa20a', key: '#fff1e8', rim: '#ff9ec4', bg: '#22102e' },
  grounded: { heart: '#bfefff', glow: '#7fc4ff', key: '#eef4ff', rim: '#8fb4ff', bg: '#0f1d4a' },
}
const INVENTED = '#d4142c' // the made-up word's petal: a warning crimson

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

function loadTexture(url: string): Promise<Texture> {
  return new TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    return t
  })
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

// A leaf: a pointed ellipse along +Y with a creased midrib, curling gently back along its length.
function leafGeometry(): BufferGeometry {
  const geo = petalGeometry()
  const pos = geo.getAttribute('position') as BufferAttribute
  for (let j = 0; j <= SEG_V; j++) {
    const v = j / SEG_V
    const width = 0.21 * Math.sin(Math.PI * v ** 0.8) ** 0.85
    const y = Math.sin(v * 1.1) / 1.1
    const z = 0.22 * v * v
    for (let i = 0; i <= SEG_U; i++) {
      const s = (i / SEG_U) * 2 - 1
      pos.setXYZ(j * (SEG_U + 1) + i, s * width, y, z - 0.35 * Math.abs(s) * width + 0.08 * s * s * width)
    }
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
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
  age: number // seconds since it was told to open
}

export async function createFlowerScene(canvas: HTMLCanvasElement, q: Quality): Promise<FlowerScene> {
  const still = q.reducedMotion
  const high = q.tier === 'high'
  const stage = (canvas.closest('section')?.querySelector('[data-flower-stage]') ?? canvas) as HTMLElement
  const [{ renderer }, rose, blue, white, leafMap, stemMap] = await Promise.all([
    createRenderer(canvas, q),
    loadTexture(petalRoseUrl), loadTexture(petalBlueUrl), loadTexture(petalWhiteUrl), loadTexture(leafUrl), loadTexture(stemUrl),
  ])
  stemMap.wrapS = stemMap.wrapT = RepeatWrapping
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = high ? 1 : 0.9 // no bloom on the light tier; keep its center from running pale

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

  const key = new DirectionalLight(MOODS.guess.key, 2.4)
  key.position.set(-4, 7, 6)
  const rim = new DirectionalLight(MOODS.guess.rim, 2.6)
  rim.position.set(5, 3, -6)
  const heartLight = new PointLight(MOODS.guess.glow, 1, 2.2, 1) // light from the heart, so the inner faces glow
  heartLight.position.set(0, 0.6, 0) // high enough that it can't blow out the innermost petals
  scene.add(key, rim)

  // Petals wear the Grok Imagine petal photos (base at v=0, tip at v=1). The mood crossfades rose to
  // icy blue; the heart's glow lights each petal's throat, and a little self-light keeps them
  // translucent, as if backlit.
  const moodK = uniform(0)
  const cHeart = uniform(new Color(MOODS.guess.heart))
  const cGlow = uniform(new Color(MOODS.guess.glow))
  // Each petal flares briefly as it unfurls, so every word's petal reads as its own.
  const fresh = uniform(0).onObjectUpdate(({ object }) => (object?.userData.fresh as number | undefined) ?? 0)
  const v = uv().y
  const edge = smoothstep(0.55, 1.0, abs(uv().x.mul(2).sub(1)))
  const saturate = (c: Node<'vec3'>) => mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.4)
  const makePetalMat = (lit: Node<'vec3'>, self: number) => {
    // The pale throat is darkened a touch (more without bloom) so the center reads gold, not white.
    const albedo = lit.mul(smoothstep(0.0, 0.45, v).mul(high ? 0.3 : 0.45).add(high ? 0.7 : 0.55))
    const m = new MeshPhysicalNodeMaterial({ side: DoubleSide, roughness: 0.5, sheen: 0.5, sheenRoughness: 0.45 })
    m.colorNode = albedo
    m.sheenNode = albedo
    m.emissiveNode = albedo.mul(edge.mul(0.25).add(self).add(fresh.mul(0.55)))
      .add(cGlow.mul(smoothstep(0.32, 0.0, v).mul(high ? 0.28 : 0.1)))
    return m
  }
  // While guessing, the tips deepen toward magenta, as in the Grok bloom.
  const blush = mix(vec3(1), vec3(1.0, 0.62, 0.92), smoothstep(0.4, 1.0, v).mul(moodK.oneMinus()).mul(0.8))
  const petalMat = makePetalMat(saturate(mix(texture(rose).rgb, texture(blue).rgb, moodK)).mul(blush).mul(0.9), 0.06)
  const inventedMat = makePetalMat(texture(white).rgb.mul(color(INVENTED)), 0.4)

  // Hierarchy: hero (pointer tilt) > fit (scale and centering) > flower (faces the camera a little).
  const hero = new Group()
  const fit = new Group()
  const flower = new Group()
  flower.rotation.x = 0.78
  hero.add(fit)
  fit.add(flower)
  scene.add(hero)
  flower.add(heartLight)

  // The heart: a glowing golden dome ringed by stamens on the golden angle.
  const heartMat = new MeshStandardNodeMaterial({ roughness: 0.5 })
  heartMat.colorNode = cHeart
  heartMat.emissiveNode = cHeart.mul(high ? 0.8 : 0.9)
  const dome = new Mesh(new SphereGeometry(0.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), heartMat)
  dome.scale.y = 0.5
  flower.add(dome)
  const stamenMat = new MeshStandardNodeMaterial({ roughness: 0.4 })
  stamenMat.colorNode = cHeart
  stamenMat.emissiveNode = cHeart.mul(high ? 0.7 : 0.8)
  const stamens = new InstancedMesh(new CapsuleGeometry(0.014, 0.2, 3, 6), stamenMat, STAMENS)
  {
    const m = new Matrix4()
    const p = new Vector3()
    const s = new Vector3()
    const qn = new Quaternion()
    const e = new Euler()
    for (let i = 0; i < STAMENS; i++) {
      const t = (i + 0.5) / STAMENS
      const r = 0.06 + 0.2 * Math.sqrt(t)
      const a = i * GOLDEN
      const lean = 0.25 + 0.9 * t
      p.set(Math.cos(a) * r, 0.07 + 0.06 * (1 - t), Math.sin(a) * r)
      qn.setFromEuler(e.set(0, -a, -lean, 'YXZ'))
      s.set(1, 0.8 + 0.5 * (1 - t), 1)
      stamens.setMatrixAt(i, m.compose(p, qn, s))
    }
  }
  flower.add(stamens)

  // Stem, two leaves and sepals, all from the Grok leaf and stem photos; the stem fades out down the page.
  const leafMat = new MeshPhysicalNodeMaterial({ side: DoubleSide, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 })
  leafMat.colorNode = texture(leafMap).rgb.mul(1.15)
  const stemCurve = new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(0.05, -0.8, -0.1), new Vector3(-0.12, -2.0, -0.25), new Vector3(0.08, -3.6, -0.3),
  ])
  const stemMat = new MeshPhysicalNodeMaterial({ roughness: 0.42, clearcoat: 0.4, transparent: true })
  // Tube UVs run x along the stem and y around it; the fibers run along the stem, tiled so they keep
  // their proportions.
  stemMat.colorNode = texture(stemMap, vec2(uv().y, uv().x.mul(7))).rgb.mul(0.8)
  stemMat.opacityNode = smoothstep(1.0, 0.45, uv().x)
  const stem = new Mesh(new TubeGeometry(stemCurve, 48, 0.055, 12), stemMat)
  fit.add(stem)
  const leafGeo = leafGeometry()
  const leaves: Mesh[] = []
  for (const [t, side, len, yaw] of [[0.36, -1, 1.25, 0.5], [0.5, 1, 1.0, -0.6]] as const) {
    const leaf = new Mesh(leafGeo, leafMat)
    leaf.position.copy(stemCurve.getPointAt(t))
    leaf.rotation.set(0.15, yaw, side * 0.95, 'YXZ')
    leaf.scale.setScalar(len)
    fit.add(leaf)
    leaves.push(leaf)
  }
  const sepalGeo = petalGeometry()
  shapePetal(sepalGeo, -0.3, 0.25, 0, 0)
  for (let i = 0; i < 5; i++) {
    const pivot = new Group()
    pivot.rotation.y = (i / 5) * Math.PI * 2 + 0.3
    const m = new Mesh(sepalGeo, leafMat)
    m.rotation.x = 1.75
    m.scale.set(0.5, 0.62, 0.5)
    pivot.add(m)
    flower.add(pivot)
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
        closedTilt: 0.05 + 0.06 * r, openTilt: 1.45 - 0.8 * r, size, widthK: 1.05 - 0.2 * r, seed: i * 1.7, invented: false, age: Infinity,
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
    if (p.open.target !== 1) p.age = 0
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
      p.age = Infinity
      p.mesh.userData.fresh = 0
      p.mesh.material = petalMat
      shape(p, 0)
    }
    entrance.x = still ? 1 : 0.9
  }

  // ---------- Mood ----------
  const mood = new Spring(0, 0, 6, 1)
  type Tint = keyof typeof MOODS.guess
  const from = {} as Record<Tint, Color>
  const to = {} as Record<Tint, Color>
  for (const k of Object.keys(MOODS.guess) as Tint[]) {
    from[k] = untoned(MOODS.guess[k])
    to[k] = untoned(MOODS.grounded[k])
  }
  function setMood(m: 'guess' | 'grounded'): void {
    mood.target = m === 'grounded' ? 1 : 0
    if (still) mood.snap()
  }
  function applyMood(t: number): void {
    const k = t * t * (3 - 2 * t)
    moodK.value = k
    ;(cHeart.value as Color).lerpColors(from.heart, to.heart, k)
    ;(cGlow.value as Color).lerpColors(from.glow, to.glow, k)
    ;(moodGlow.value as Color).lerpColors(from.bg, to.bg, k)
    heartLight.color.lerpColors(from.glow, to.glow, k)
    key.color.lerpColors(from.key, to.key, k)
    rim.color.lerpColors(from.rim, to.rim, k)
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
      if (i === next && pt.open.target === 0) {
        pt.open.x = smoothToward(pt.open.x, holdP * 0.22, dt, 10)
        pt.mesh.userData.fresh = holdP * 0.5
      } else {
        pt.open.step(dt)
        pt.age += dt
        pt.mesh.userData.fresh = still ? 0 : Math.min(1, pt.age * 6) * Math.exp(-pt.age * 2.2)
      }
      if (Math.abs(pt.open.x - pt.shaped) > 0.002) shape(pt, pt.open.x)
    }
    heartLight.intensity = 0.35 + 0.35 * Math.min(1, petals.filter((pt) => pt.open.target === 1).length / Math.max(1, petals.length))

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
      leafGeo.dispose()
      stem.geometry.dispose()
      dome.geometry.dispose()
      stamens.geometry.dispose()
      stamens.dispose()
      for (const m of [petalMat, inventedMat, heartMat, stamenMat, leafMat, stemMat]) m.dispose()
      for (const t of [rose, blue, white, leafMap, stemMap]) t.dispose()
      envMap.dispose()
      pipeline?.dispose()
      renderer.dispose()
    },
  }
}
