export function setStatus(text: string, state: 'live' | 'paused' | 'unavailable' = 'live'): void {
  const pill = document.getElementById('status-pill')
  if (!pill) return
  pill.textContent = text
  pill.dataset.state = state
}

export function showFallback(message?: string): void {
  const card = document.getElementById('fallback-card')
  if (card) {
    card.hidden = false
    const body = card.querySelector('[data-fallback-text]')
    if (message && body) body.textContent = message
  }
  setStatus('UNAVAILABLE', 'unavailable')
}
