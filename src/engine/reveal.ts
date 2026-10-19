export function initReveals(
  root: ParentNode,
  opts: { reducedMotion: boolean; io?: typeof IntersectionObserver },
): void {
  const els = root.querySelectorAll<HTMLElement>('[data-reveal]')
  const Observer = opts.io ?? (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : undefined)
  if (opts.reducedMotion || !Observer) {
    els.forEach((el) => el.classList.add('in-view'))
    return
  }
  const observer = new Observer((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('in-view')
      observer.unobserve(entry.target)
    }
  }, { threshold: 0.15 })
  els.forEach((el) => observer.observe(el))
}
