export function showFallback(message?: string): void {
  const card = document.getElementById('fallback-card')
  if (card) {
    card.hidden = false
    const body = card.querySelector('[data-fallback-text]')
    if (message && body) body.textContent = message
  }
}
