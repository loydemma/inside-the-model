// Calls `run` once, the first time `el` is at least `threshold` visible. Returns a disposer.
export function onFirstArrival(
  el: Element,
  run: () => void,
  opts: { io?: typeof IntersectionObserver; threshold?: number } = {},
): () => void {
  const Observer = opts.io ?? (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : undefined)
  if (!Observer) {
    run()
    return () => {}
  }
  const threshold = opts.threshold ?? 0.5
  let done = false
  const observer = new Observer((entries) => {
    if (done) return
    if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= threshold)) return
    done = true
    observer.disconnect()
    run()
  }, { threshold: [0, threshold] })
  observer.observe(el)
  return () => {
    done = true
    observer.disconnect()
  }
}
