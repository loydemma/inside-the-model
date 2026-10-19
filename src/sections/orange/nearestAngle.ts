// The cut angle closest to a swipe. Screen y points down, and a swipe either way is the same cut.
export function nearestAngle(dx: number, dy: number): 0 | 45 | 90 | 135 {
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180
  return ((Math.round(deg / 45) * 45) % 180) as 0 | 45 | 90 | 135
}
