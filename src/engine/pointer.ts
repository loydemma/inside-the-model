export const MAX_TILT_RAD = 0.14

export function smoothToward(current: number, target: number, dtSec: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dtSec))
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v))

export function normalizePointer(clientX: number, clientY: number, w: number, h: number): { x: number; y: number } {
  return { x: clamp1((clientX / w) * 2 - 1), y: clamp1(1 - (clientY / h) * 2) }
}

export function createPointer(
  target: EventTarget,
  opts: { reducedMotion: boolean },
): { get(): { x: number; y: number }; dispose(): void } {
  let value = { x: 0, y: 0 }
  const onMove = (e: Event): void => {
    const p = e as PointerEvent
    value = normalizePointer(p.clientX, p.clientY, window.innerWidth, window.innerHeight)
  }
  if (!opts.reducedMotion) target.addEventListener('pointermove', onMove)
  return {
    get: () => value,
    dispose: () => target.removeEventListener('pointermove', onMove),
  }
}
