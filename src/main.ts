import { detectQuality } from './engine/quality'
import { setStatus, showFallback } from './engine/renderer'
import { PORTFOLIO_URL, REPO_URL } from './config'

const q = detectQuality()
setStatus('LOADING')

// Without GPU acceleration, live 3D freezes the page, so skip the scenes there.
// The text works on its own.
if (q.software) {
  showFallback('This browser has no graphics acceleration, so the 3D scenes are turned off to keep the page fast. Everything you need to learn is still in the text.')
  document.documentElement.classList.add('no-3d')
}

document.querySelectorAll<HTMLAnchorElement>('[data-portfolio-link]').forEach((a) => { a.href = PORTFOLIO_URL })
document.querySelectorAll<HTMLAnchorElement>('[data-repo-link]').forEach((a) => { a.href = REPO_URL })
