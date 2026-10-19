import { showFallback } from './status'

export interface SceneHandle {
  start(): void
  stop(): void
  resize(w: number, h: number): void
  dispose(): void
}

export function mountWhenVisible(
  el: Element,
  factory: () => Promise<SceneHandle>,
  io: typeof IntersectionObserver = IntersectionObserver,
): void {
  let handle: SceneHandle | null = null
  let loading: Promise<void> | null = null
  let visible = false

  const observer = new io((entries) => {
    visible = entries[entries.length - 1].isIntersecting
    if (handle) {
      if (visible) handle.start()
      else handle.stop()
      return
    }
    if (visible && !loading) {
      loading = factory().then(
        (h) => {
          handle = h
          ;(el as HTMLElement).dataset.ready = 'true'
          if (visible) h.start()
        },
        (err: unknown) => {
          console.warn('Scene failed to start', err)
          ;(el as HTMLElement).style.visibility = 'hidden'
          observer.disconnect()
          showFallback()
        },
      )
    }
  }, { rootMargin: '120px 0px' })
  observer.observe(el)
}
