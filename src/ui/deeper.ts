export function initDeeper(doc: Document) {
  const panel = doc.getElementById('deeper-panel') as HTMLElement
  const body = panel.querySelector<HTMLElement>('[data-deeper-body]') as HTMLElement
  const slots = new Map<string, string>()
  let current: string | null = null

  const button = (id: string): HTMLElement | null => doc.querySelector<HTMLElement>(`[data-deeper="${id}"]`)

  function applySlots(id: string): void {
    for (const [key, text] of slots) {
      const [slotId, slot] = key.split('\u0000')
      if (slotId !== id) continue
      body.querySelectorAll(`[data-slot="${slot}"]`).forEach((el) => { el.textContent = text })
    }
  }

  function open(id: string): void {
    const tpl = doc.getElementById(`deeper-${id}`) as HTMLTemplateElement | null
    if (!tpl) return
    if (current && current !== id) button(current)?.setAttribute('aria-expanded', 'false')
    current = id
    body.replaceChildren(tpl.content.cloneNode(true))
    applySlots(id)
    body.scrollTop = 0
    button(id)?.setAttribute('aria-expanded', 'true')
    panel.classList.add('open')
    panel.setAttribute('aria-hidden', 'false')
    doc.body.classList.add('deeper-open')
  }

  function close(): void {
    if (!current) return
    const btn = button(current)
    btn?.setAttribute('aria-expanded', 'false')
    current = null
    panel.classList.remove('open')
    panel.setAttribute('aria-hidden', 'true')
    doc.body.classList.remove('deeper-open')
    btn?.focus()
  }

  function setSlot(id: string, slot: string, text: string): void {
    slots.set(`${id}\u0000${slot}`, text)
    if (current === id) applySlots(id)
  }

  panel.querySelector('[data-deeper-close]')?.addEventListener('click', close)
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })

  return { open, close, setSlot }
}

export type Deeper = ReturnType<typeof initDeeper>
