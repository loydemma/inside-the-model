import { it, expect, vi } from 'vitest'
import { mountWhenVisible } from '../src/engine/sceneHost'
import type { SceneHandle } from '../src/engine/sceneHost'

type Cb = (entries: { isIntersecting: boolean }[]) => void
function fakeIO() {
  let cb: Cb = () => {}
  class IO { constructor(c: Cb) { cb = c } observe() {} unobserve() {} disconnect() {} }
  return { IO: IO as unknown as typeof IntersectionObserver, fire: (v: boolean) => cb([{ isIntersecting: v }]) }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
function handle(): SceneHandle {
  return { start: vi.fn(), stop: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
}

it('creates the scene only on first intersection, then starts and stops with visibility', async () => {
  const { IO, fire } = fakeIO()
  const h = handle()
  const factory = vi.fn(async () => h)
  mountWhenVisible(document.createElement('div'), factory, IO)
  expect(factory).not.toHaveBeenCalled()
  fire(true); await flush()
  expect(factory).toHaveBeenCalledTimes(1)
  expect(h.start).toHaveBeenCalledTimes(1)
  fire(false); await flush()
  expect(h.stop).toHaveBeenCalledTimes(1)
  fire(true); await flush()
  expect(factory).toHaveBeenCalledTimes(1)
  expect(h.start).toHaveBeenCalledTimes(2)
})

it('does not throw when the factory rejects', async () => {
  const { IO, fire } = fakeIO()
  mountWhenVisible(document.createElement('div'), async () => { throw new Error('no gpu') }, IO)
  fire(true)
  await expect(flush()).resolves.toBeUndefined()
})
