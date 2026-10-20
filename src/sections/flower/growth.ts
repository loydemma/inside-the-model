// The flower's clock: while held, it runs through the answer one step (one word) at a time.
// Each step shows its candidates 40% of the way in and commits its word at the end.
export const STEP_MS = 420
const CANDIDATES_AT = 0.4

export type GrowthEvent =
  | { type: 'candidates'; step: number }
  | { type: 'commit'; step: number }
  | { type: 'done' }

export function createGrowth(totalSteps: number) {
  const end = totalSteps * STEP_MS
  let t = 0
  let done = false

  function tick(dtMs: number, holding: boolean): GrowthEvent[] {
    if (!holding || done) return []
    const before = t
    t = Math.min(t + dtMs, end)
    const events: GrowthEvent[] = []
    const crossed = (at: number) => before < at && at <= t
    for (let step = 0; step < totalSteps; step++) {
      if (crossed((step + CANDIDATES_AT) * STEP_MS)) events.push({ type: 'candidates', step })
      if (crossed((step + 1) * STEP_MS)) events.push({ type: 'commit', step })
    }
    if (t >= end) {
      done = true
      events.push({ type: 'done' })
    }
    return events
  }

  return {
    tick,
    progress: (): number => (end === 0 ? 1 : t / end),
    reset(): void { t = 0; done = false },
  }
}
