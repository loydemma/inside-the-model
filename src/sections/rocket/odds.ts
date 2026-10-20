// The real math behind the rocket: every step has to work, so the odds multiply.
export function successOdds(reliability: number, steps: number): number {
  return reliability ** steps
}

// One launch: each stage, bottom first, works if its roll lands under the reliability.
// Returns the 0-based index of the first stage that fails, or null if every stage works.
export function rollLaunch(reliability: number, steps: number, rand: () => number = Math.random): { failedAt: number | null } {
  for (let i = 0; i < steps; i++) if (rand() >= reliability) return { failedAt: i }
  return { failedAt: null }
}
