import {
  AdditiveBlending, BackSide, Fog, CanvasTexture, CapsuleGeometry, Color, DirectionalLight, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshPhysicalNodeMaterial, NeutralToneMapping,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, QuadraticBezierCurve3, Quaternion, Raycaster, RenderPipeline, Scene,
  SphereGeometry, SRGBColorSpace, Timer, TubeGeometry, Vector2, Vector3,
} from 'three/webgpu'
import { color, instancedDynamicBufferAttribute, mix, pass, screenUV, smoothstep, uniform, vec2 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createRenderer } from '../../engine/renderer'
import { setStatus } from '../../engine/status'
import { createPointer, MAX_TILT_RAD, smoothToward } from '../../engine/pointer'
import type { Quality } from '../../engine/quality'
import type { AttentionScene, Link } from './attentionController'

const STAGE = '#05060a'
const GLOW = '#0f1330'
const ACCENT = new Color('#7d8cff')
const LINK_CORE = new Color('#dfe5ff')
const HOLD_MS = 250
const CAM_Z = 10
const FOV = 35
// The field turns toward a point on this plane, just behind the words.
const TARGET_Z = -1.2
const WORD_H = 0.36
const GAP = 0.12

// Small seeded random, so the field is laid out the same way every visit.
function rand(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// White word on a transparent canvas; returns the texture and its width:height ratio.
function wordTexture(text: string): { map: CanvasTexture; aspect: number } {
  const H = 128
  const font = '600 62px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif'
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 8
  c.width = w
  c.height = H
  g.font = font
  g.fillStyle = '#f5f5f7'
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  g.fillText(text, w / 2, H / 2 + 3)
  const map = new CanvasTexture(c)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 4
  return { map, aspect: w / H }
}

type Word = { group: Group; pill: Mesh; mat: MeshPhysicalMaterial; width: number; glow: number; glowTarget: number; born: number }
type LinkView = { core: Mesh; halo: Mesh; pulse: Mesh; curve: QuadraticBezierCurve3; w: number; born: number; speed: number }

export async function createAttentionScene(
  canvas: HTMLCanvasElement,
  q: Quality,
  onFocus: (token: number | null) => void,
): Promise<AttentionScene> {
  const { renderer, backend } = await createRenderer(canvas, q)
  setStatus(backend === 'webgpu' ? 'WEBGPU · LIVE' : 'WEBGL · LIVE')
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new Scene()
  // The same soft glow as the page's loading state, so the canvas fades in seamlessly.
  // The glow sits behind the words and fades to the plain stage at every edge.
  const glowCenter = uniform(vec2(0.5, 0.5))
  const glowAspect = uniform(1)
  const glowFalloff = smoothstep(0.55, 0.0, screenUV.sub(glowCenter).mul(vec2(1.0, glowAspect)).length())
  scene.backgroundNode = mix(color(STAGE), color(GLOW), glowFalloff)
  // Far capsules sink into the dark, so the words and the copy stay readable.
  scene.fog = new Fog(STAGE, 11, 19)
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60)
  camera.position.set(0, 0, CAM_Z)

  // A dark studio with three soft boxes, so glossy surfaces get crisp keynote-style highlights.
  const studio = new Scene()
  studio.add(new Mesh(new SphereGeometry(20, 16, 8), new MeshBasicMaterial({ color: '#020205', side: BackSide })))
  const softbox = (w: number, h: number, c: string, k: number, pos: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c).multiplyScalar(k), side: BackSide }))
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    studio.add(m)
  }
  softbox(14, 3, '#ffffff', 5, [0, 9, 4])
  softbox(2, 10, '#8f9cff', 4, [-9, 1, -2])
  softbox(2, 8, '#ffd9b0', 3, [9, -1, 3])
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(studio, 0.03).texture
  scene.environmentIntensity = 0.9
  pmrem.dispose()

  // Key from high and in front, so each word's highlight is a soft streak along its top edge.
  const key = new DirectionalLight('#fff3e6', 2.2)
  key.position.set(0, 9, 5)
  const rim = new DirectionalLight('#7d8cff', 4.5)
  rim.position.set(5, 4, -8)
  const rim2 = new DirectionalLight('#c08cff', 2.2)
  rim2.position.set(-7, -3, -6)
  scene.add(key, rim, rim2)

  // ---- Ambient field: glossy capsules that all turn to face the pointer. ----
  const high = q.tier === 'high'
  const count = high ? 600 : 250
  const capsule = new CapsuleGeometry(0.055, 0.2, high ? 6 : 4, high ? 12 : 8)
  capsule.rotateX(Math.PI / 2) // long axis along +Z, which lookAt aims
  const glowAttr = new InstancedBufferAttribute(new Float32Array(count), 1)
  const fieldMat = new MeshPhysicalNodeMaterial({
    color: '#1b1e2a', metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06,
  })
  fieldMat.emissiveNode = color(ACCENT).mul(instancedDynamicBufferAttribute(glowAttr, 'float')).mul(2.2)
  const field = new InstancedMesh(capsule, fieldMat, count)
  field.frustumCulled = false
  scene.add(field)

  const rng = rand(7)
  // Each capsule lives at a spot in screen space (u, v) and a depth; world positions follow the aspect.
  const spots = Array.from({ length: count }, () => ({
    u: rng() * 2.3 - 1.15,
    v: rng() * 2.3 - 1.15,
    z: -1.8 - rng() * 7,
    phase: rng() * Math.PI * 2,
    rate: 2.2 + rng() * 3.2,
    scale: 0.7 + rng() * 0.6,
    tint: rng(),
    glow: 0,
    q: new Quaternion(),
    base: new Vector3(),
  }))
  const tint = new Color()
  spots.forEach((s, i) => {
    // Mostly graphite, a few cool and violet ones for depth.
    tint.set(s.tint < 0.8 ? '#20232f' : s.tint < 0.93 ? '#2a3170' : '#4b2f7a')
    field.setColorAt(i, tint)
  })

  // ---- The active sentence, larger, in front of the field. Tilts toward the pointer. ----
  const hero = new Group()
  scene.add(hero)
  const sentence = new Group()
  hero.add(sentence)
  const linkGroup = new Group()
  hero.add(linkGroup)
  let words: Word[] = []
  let links: LinkView[] = []

  const halfH = (z: number) => Math.tan(((camera.fov / 2) * Math.PI) / 180) * (CAM_Z - z)
  const placeField = () => {
    for (const s of spots) {
      const h = halfH(s.z)
      s.base.set(s.u * h * camera.aspect, s.v * h, s.z)
    }
  }

  // Wrap words into rows that fit the free space above the text column.
  const layout = () => {
    const rect = canvas.getBoundingClientRect()
    const section = canvas.parentElement!
    const text = section.querySelector('.stage-text')?.getBoundingClientRect()
    const h0 = halfH(0)
    const pxToWorld = (2 * h0) / rect.height
    // The canvas also reaches up behind the page title; the words sit in the section itself:
    // beside the copy on wide screens, above it on narrow ones.
    const sec = section.getBoundingClientRect()
    const wide = rect.width >= 900 && !!text
    const bandTop = sec.top - rect.top + (wide ? 120 : 40)
    const bandBottom = wide ? sec.bottom - rect.top - 64 : text ? Math.max(bandTop + 120, text.top - rect.top - 32) : rect.height * 0.55
    const bandLeft = wide ? text!.right - rect.left + 56 : 0
    const bandRight = wide ? rect.width - 48 : rect.width
    const maxW = Math.min((bandRight - bandLeft) * pxToWorld * (wide ? 0.95 : 0.86), 9)
    const rows: Word[][] = [[]]
    let rowW = 0
    for (const w of words) {
      if (rowW > 0 && rowW + GAP + w.width > maxW) { rows.push([]); rowW = 0 }
      rowW += (rowW > 0 ? GAP : 0) + w.width
      rows[rows.length - 1]!.push(w)
    }
    const widest = Math.max(...rows.map((r) => r.reduce((a, w) => a + w.width, 0) + GAP * (r.length - 1)))
    const rowH = WORD_H + GAP * 1.6
    const bandH = (bandBottom - bandTop) * pxToWorld
    const scale = Math.min(1, maxW / widest, (bandH * 0.8) / (rows.length * rowH))
    rows.forEach((r, k) => {
      const rw = r.reduce((a, w) => a + w.width, 0) + GAP * (r.length - 1)
      let x = -rw / 2
      for (const w of r) {
        w.group.position.set(x + w.width / 2, ((rows.length - 1) / 2 - k) * rowH, 0)
        x += w.width + GAP
      }
    })
    sentence.scale.setScalar(scale)
    const center = (bandTop + bandBottom) / 2
    const centerX = (bandLeft + bandRight) / 2
    hero.position.set((centerX - rect.width / 2) * pxToWorld, h0 - center * pxToWorld, 0)
    glowCenter.value.set(centerX / rect.width, center / rect.height)
    glowAspect.value = rect.height / rect.width
  }

  const clearLinks = () => {
    for (const l of links) {
      linkGroup.remove(l.core, l.halo, l.pulse)
      l.core.geometry.dispose()
      l.halo.geometry.dispose()
      ;(l.core.material as MeshBasicMaterial).dispose()
      ;(l.halo.material as MeshBasicMaterial).dispose()
      ;(l.pulse.material as MeshBasicMaterial).dispose()
    }
    links = []
    for (const w of words) w.glowTarget = 0
  }

  const setSentence = (next: string[]) => {
    clearLinks()
    for (const w of words) {
      sentence.remove(w.group)
      w.pill.geometry.dispose()
      w.mat.dispose()
      const label = w.group.children[1] as Mesh
      ;((label.material as MeshBasicMaterial).map as CanvasTexture).dispose()
      ;(label.material as MeshBasicMaterial).dispose()
      label.geometry.dispose()
    }
    const now = performance.now()
    words = next.map((text, i) => {
      const { map, aspect } = wordTexture(text)
      const labelW = WORD_H * aspect
      const width = Math.max(WORD_H * 1.6, labelW + WORD_H * 0.75)
      const r = WORD_H / 2
      const geo = new CapsuleGeometry(r, width - 2 * r, high ? 8 : 4, high ? 24 : 14)
      geo.rotateZ(Math.PI / 2)
      const mat = new MeshPhysicalMaterial({
        color: '#12141c', metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04,
        emissive: ACCENT, emissiveIntensity: 0,
      })
      const pill = new Mesh(geo, mat)
      pill.scale.z = 0.55
      pill.userData.i = i
      const label = new Mesh(
        new PlaneGeometry(labelW, WORD_H),
        new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }),
      )
      label.position.z = r * 0.55 + 0.004
      const group = new Group()
      group.add(pill, label)
      sentence.add(group)
      return { group, pill, mat, width, glow: 0, glowTarget: 0, born: now + i * 45 }
    })
    layout()
  }

  const pulseGeo = new SphereGeometry(1, 12, 8)
  const showLinks = (from: number, next: Link[]) => {
    clearLinks()
    const src = words[from]
    if (!src) return
    src.glowTarget = 1
    const strongest = next[0]?.w ?? 1
    const now = performance.now()
    sentence.updateMatrix()
    for (const [k, l] of next.entries()) {
      const dst = words[l.j]
      if (!dst) continue
      const rel = l.w / strongest
      dst.glowTarget = 0.25 + 0.6 * rel
      // From the top of the attended word, arcing up and just behind the words (so labels stay
      // readable where arcs cross them), into the focused word.
      const a = dst.group.position.clone().add(new Vector3(0, WORD_H / 2, 0)).applyMatrix4(sentence.matrix)
      const b = src.group.position.clone().add(new Vector3(0, WORD_H / 2, 0)).applyMatrix4(sentence.matrix)
      const dist = a.distanceTo(b)
      const mid = a.clone().lerp(b, 0.5).add(new Vector3(0, 0.2 + dist * 0.16, -0.35 - dist * 0.08))
      const curve = new QuadraticBezierCurve3(a, mid, b)
      const radius = (0.006 + 0.035 * l.w) * sentence.scale.x
      const core = new Mesh(
        new TubeGeometry(curve, 64, radius, 8, false),
        new MeshBasicMaterial({ color: LINK_CORE.clone().multiplyScalar(1.4 + 1.6 * rel), transparent: true, opacity: 0.35 + 0.65 * rel, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      )
      const halo = new Mesh(
        new TubeGeometry(curve, 64, radius * 3.6, 8, false),
        new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.1 + 0.22 * rel, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      )
      const pulse = new Mesh(
        pulseGeo,
        new MeshBasicMaterial({ color: LINK_CORE.clone().multiplyScalar(3), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      )
      pulse.scale.setScalar(radius * 2.6)
      core.renderOrder = halo.renderOrder = pulse.renderOrder = 5
      linkGroup.add(halo, core, pulse)
      links.push({ core, halo, pulse, curve, w: rel, born: now + k * 70, speed: 0.55 + 0.25 * rel })
    }
  }
  // ---- Pointer: tilt + field target (window-wide), and picking on the canvas. ----
  const pointer = createPointer(window, { reducedMotion: q.reducedMotion })
  const tilt = { x: 0, y: 0 }
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  const pick = (clientX: number, clientY: number): number | null => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(words.map((w) => w.pill), false)[0]
    return hit ? (hit.object.userData.i as number) : null
  }
  let hovered: number | null = null
  let hold = 0
  let holdStart = { x: 0, y: 0 }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      const i = pick(e.clientX, e.clientY)
      canvas.style.cursor = i === null ? '' : 'pointer'
      if (i !== hovered) { hovered = i; onFocus(i) }
    } else if (Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 12) clearTimeout(hold)
  }
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && hovered !== null) { hovered = null; onFocus(null) }
  }
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    holdStart = { x: e.clientX, y: e.clientY }
    clearTimeout(hold)
    hold = window.setTimeout(() => onFocus(pick(holdStart.x, holdStart.y)), HOLD_MS)
  }
  const cancelHold = () => clearTimeout(hold)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', cancelHold)
  canvas.addEventListener('pointercancel', cancelHold)

  // ---- Frame loop ----
  let pipeline: RenderPipeline | null = null
  if (high) {
    pipeline = new RenderPipeline(renderer)
    const scenePass = pass(scene, camera).getTextureNode('output')
    pipeline.outputNode = scenePass.add(bloom(scenePass, 0.55, 0.35, 0.92))
  }

  const timer = new Timer()
  const look = new Matrix4()
  const target = new Vector3()
  const pos = new Vector3()
  const scaleV = new Vector3()
  const goal = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const instance = new Matrix4()
  const still = q.reducedMotion
  let first = true

  const tick = () => {
    timer.update()
    const dt = first ? 1 : Math.min(timer.getDelta(), 1 / 20)
    const t = timer.getElapsed()
    const now = performance.now()

    // Window pointer -> canvas NDC -> a point on the target plane.
    const p = pointer.get()
    const r = canvas.getBoundingClientRect()
    const cx = ((p.x + 1) / 2) * window.innerWidth
    const cy = ((1 - p.y) / 2) * window.innerHeight
    const px = ((cx - r.left) / r.width) * 2 - 1
    const py = 1 - ((cy - r.top) / r.height) * 2
    const th = halfH(TARGET_Z)
    target.set(px * th * camera.aspect, py * th, TARGET_Z)

    tilt.x = smoothToward(tilt.x, p.x * MAX_TILT_RAD, dt, 4)
    tilt.y = smoothToward(tilt.y, -p.y * MAX_TILT_RAD, dt, 4)
    hero.rotation.set(tilt.y, tilt.x, 0)

    const reach = Math.min(th * camera.aspect, th) * 0.55
    for (let i = 0; i < count; i++) {
      const s = spots[i]!
      pos.copy(s.base)
      if (!still) pos.y += Math.sin(t * 0.45 + s.phase) * 0.06
      look.lookAt(target, pos, up)
      goal.setFromRotationMatrix(look)
      s.q.slerp(goal, first ? 1 : 1 - Math.exp(-s.rate * dt))
      // Capsules near the pointer light up, like attention gathering where you look.
      const d = Math.hypot(pos.x - target.x, pos.y - target.y) / reach
      s.glow = smoothToward(s.glow, Math.max(0, 1 - d) ** 2 * (0.25 + 0.45 * s.tint), dt, 3)
      glowAttr.array[i] = s.glow
      instance.compose(pos, s.q, scaleV.setScalar(s.scale))
      field.setMatrixAt(i, instance)
    }
    field.instanceMatrix.needsUpdate = true
    glowAttr.needsUpdate = true

    for (const w of words) {
      const k = still ? 1 : Math.min(1, Math.max(0, (now - w.born) / 600))
      const e = 1 - (1 - k) ** 3
      w.group.scale.setScalar(0.6 + 0.4 * e)
      w.group.position.z = (1 - e) * -0.8
      ;(w.group.children[1] as Mesh).visible = k > 0
      w.pill.visible = k > 0
      w.glow = smoothToward(w.glow, w.glowTarget, dt, 9)
      w.mat.emissiveIntensity = w.glow * 0.9
    }

    for (const l of links) {
      const k = still ? 1 : Math.min(1, Math.max(0, (now - l.born) / 420))
      const e = 1 - (1 - k) ** 3
      const n = l.core.geometry.index!.count
      const drawn = Math.floor((e * n) / 6) * 6
      l.core.geometry.setDrawRange(0, drawn)
      l.halo.geometry.setDrawRange(0, drawn)
      l.core.visible = l.halo.visible = drawn > 0
      // A bright bead runs from the attended word into the focused one: the direction information flows.
      const pm = l.pulse.material as MeshBasicMaterial
      if (still || k < 1) pm.opacity = 0
      else {
        const u = ((t * l.speed) + l.w) % 1
        l.pulse.position.copy(l.curve.getPoint(u))
        pm.opacity = Math.sin(u * Math.PI) * (0.4 + 0.6 * l.w)
      }
    }

    first = false
    if (pipeline) pipeline.render()
    else renderer.render(scene, camera)
  }

  const resize = (w: number, h: number) => {
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Keep the same on-screen scale however tall the canvas is (it spans the title and the section).
    const tall = h / window.innerHeight
    camera.fov = (2 * Math.atan(Math.tan(((FOV / 2) * Math.PI) / 180) * tall) * 180) / Math.PI
    camera.updateProjectionMatrix()
    placeField()
    if (words.length) layout()
  }
  const ro = new ResizeObserver(() => resize(canvas.clientWidth, canvas.clientHeight))
  ro.observe(canvas)
  resize(canvas.clientWidth, canvas.clientHeight)

  return {
    setSentence,
    showLinks,
    clearLinks,
    start: () => { timer.reset(); renderer.setAnimationLoop(tick) },
    stop: () => renderer.setAnimationLoop(null),
    resize,
    dispose: () => {
      ro.disconnect()
      pointer.dispose()
      clearTimeout(hold)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', cancelHold)
      canvas.removeEventListener('pointercancel', cancelHold)
      renderer.setAnimationLoop(null)
      renderer.dispose()
    },
  }
}
