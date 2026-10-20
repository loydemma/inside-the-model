import { describe, it, expect, beforeEach } from 'vitest'
import { initDeeper } from '../src/ui/deeper'

const ids = ['orange', 'jello']

function setup() {
  document.body.className = ''
  document.body.innerHTML =
    ids
      .map(
        (id) => `<button class="deeper-btn" data-deeper="${id}" aria-expanded="false">Go deeper</button>
<template id="deeper-${id}"><h3>${id} title</h3><p>${id} text <span data-slot="count"></span></p></template>`,
      )
      .join('') +
    `<aside id="deeper-panel" aria-hidden="true"><button data-deeper-close>Close</button><div data-deeper-body></div></aside>`
  return initDeeper(document)
}

const panel = () => document.getElementById('deeper-panel')!
const btn = (id: string) => document.querySelector<HTMLButtonElement>(`[data-deeper="${id}"]`)!
const isOpen = () => panel().classList.contains('open') && panel().getAttribute('aria-hidden') === 'false'

beforeEach(() => { setup() })

describe('initDeeper', () => {
  it('opens a panel with the template text and expands the button', () => {
    const d = setup()
    d.open('orange')
    expect(isOpen()).toBe(true)
    expect(panel().querySelector('[data-deeper-body]')!.textContent).toContain('orange text')
    expect(btn('orange').getAttribute('aria-expanded')).toBe('true')
    expect(document.body.classList.contains('deeper-open')).toBe(true)
    expect(document.activeElement).toBe(panel().querySelector('[data-deeper-close]'))
  })

  it('shows only the newest content when another opens', () => {
    const d = setup()
    d.open('orange')
    d.open('jello')
    const text = panel().querySelector('[data-deeper-body]')!.textContent!
    expect(text).toContain('jello text')
    expect(text).not.toContain('orange text')
    expect(btn('orange').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape and returns focus to the button', () => {
    const d = setup()
    d.open('jello')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(btn('jello'))
  })

  it('applies a slot set before open', () => {
    const d = setup()
    d.setSlot('orange', 'count', '7')
    d.open('orange')
    expect(panel().querySelector('[data-slot=count]')!.textContent).toBe('7')
  })

  it('close button closes and removes the scroll lock', () => {
    const d = setup()
    d.open('orange')
    panel().querySelector<HTMLButtonElement>('[data-deeper-close]')!.click()
    expect(isOpen()).toBe(false)
    expect(document.body.classList.contains('deeper-open')).toBe(false)
  })
})
