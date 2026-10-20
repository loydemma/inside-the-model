export interface WobbleParams {
  frequency: number // Hz
  damping: number // 1/s
  amplitude: number // peak stretch, as a fraction of the jello's size
}

// Below this share of its starting size, a wobble counts as settled.
const SETTLED = 0.05

// Higher temperature: a slower, looser, bigger wobble that takes longer to settle.
export function wobbleParams(temperature: number): WobbleParams {
  const k = Math.max(0, Math.min(1, temperature / 2))
  return { frequency: 5.5 - 3 * k, damping: 6.5 - 5.3 * k, amplitude: 0.012 + 0.11 * k }
}

export function settleTime(p: WobbleParams): number {
  return Math.log(1 / SETTLED) / p.damping
}

// How far the jello is pushed `tSec` after a poke `dist` away (same units as `radius`).
export function displacement(dist: number, tSec: number, p: WobbleParams, radius: number): number {
  return p.amplitude * Math.exp(-((dist / radius) ** 2)) * Math.exp(-p.damping * tSec) * Math.sin(2 * Math.PI * p.frequency * tSec)
}
