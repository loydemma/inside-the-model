import { initDeeper } from './ui/deeper'
import { detectQuality } from './engine/quality'
import { setStatus, showFallback } from './engine/status'
import { initReveals } from './engine/reveal'
import { onFirstArrival } from './engine/arrival'
import { mountWhenVisible } from './engine/sceneHost'
import { createOrangeController } from './sections/orange/orangeController'
import { createFlowerController } from './sections/flower/flowerController'
import { createJelloController } from './sections/jello/jelloController'
import { createRocketController } from './sections/rocket/rocketController'
import { loadData, showDemoError } from './data/load'
import { parseHallucination, parseTemperature } from './data/types'
import { PORTFOLIO_URL, REPO_URL } from './config'

const q = detectQuality()
setStatus('LOADING')
initReveals(document, { reducedMotion: q.reducedMotion })

// Without GPU acceleration, live 3D freezes the page, so skip the scenes there.
// The text works on its own.
if (q.software) {
  showFallback('This browser has no graphics acceleration, so the 3D scenes are turned off to keep the page fast. Everything you need to learn is still in the text.')
  document.documentElement.classList.add('no-3d')
}

document.querySelectorAll<HTMLAnchorElement>('[data-portfolio-link]').forEach((a) => { a.href = PORTFOLIO_URL })
document.querySelectorAll<HTMLAnchorElement>('[data-repo-link]').forEach((a) => { a.href = REPO_URL })

const deeper = initDeeper(document)
document.querySelectorAll<HTMLButtonElement>('.deeper-btn').forEach((b) => {
  b.addEventListener('click', () => deeper.open(b.dataset.deeper as string))
})

// Tokenizing is real and works with no 3D, so the controller starts right away. The orange
// scene attaches when it scrolls near.
const orangeSection = document.getElementById('orange') as HTMLElement
const orangeCanvas = document.getElementById('orange-canvas') as HTMLCanvasElement
const orange = createOrangeController(orangeSection, deeper)
onFirstArrival(orangeSection, () => (q.reducedMotion ? orange.showAnswered() : void orange.playIntro()))
if (!q.software) {
  mountWhenVisible(orangeCanvas, async () => {
    const { createOrangeScene } = await import('./sections/orange/orangeScene')
    const scene = await createOrangeScene(orangeCanvas, q)
    orange.attach(scene)
    return scene
  })
}

// The flower's words and odds are illustrative data; the scene attaches when it scrolls near.
const flowerSection = document.getElementById('flower') as HTMLElement
const flowerCanvas = document.getElementById('flower-canvas') as HTMLCanvasElement
loadData('/data/generation.json', parseHallucination).then(
  (data) => {
    const flower = createFlowerController(flowerSection, data, deeper)
    onFirstArrival(flowerSection, () => (q.reducedMotion ? flower.showAnswered() : void flower.playIntro()))
    if (!q.software) {
      mountWhenVisible(flowerCanvas, async () => {
        const { createFlowerScene } = await import('./sections/flower/flowerScene')
        const scene = await createFlowerScene(flowerCanvas, q)
        flower.attach(scene)
        return scene
      })
    }
  },
  () => {
    showDemoError(flowerSection)
    flowerSection.querySelectorAll('.caption, .why').forEach((el) => el.classList.add('is-shown'))
  },
)

// The jello's answers are illustrative data. It is video, not 3D, so it needs no GPU.
const jelloSection = document.getElementById('jello') as HTMLElement
const jelloStage = jelloSection.querySelector('[data-jello-stage]') as HTMLElement
loadData('/data/temperature.json', parseTemperature).then(
  (data) => {
    const jello = createJelloController(jelloSection, data, deeper)
    onFirstArrival(jelloSection, () => (q.reducedMotion ? jello.showAnswered() : void jello.playIntro()))
    mountWhenVisible(jelloStage, async () => {
      const { createJelloScene } = await import('./sections/jello/jelloScene')
      const scene = await createJelloScene(jelloStage, q)
      jello.attach(scene)
      return scene
    })
  },
  () => {
    showDemoError(jelloSection)
    jelloSection.querySelectorAll('.caption, .why').forEach((el) => el.classList.add('is-shown'))
  },
)

// The rocket's odds are real math. It is stills and a video, not 3D, so it needs no GPU.
const rocketSection = document.getElementById('rocket') as HTMLElement
const rocketStage = rocketSection.querySelector('[data-rocket-stage]') as HTMLElement
const rocket = createRocketController(rocketSection, deeper)
onFirstArrival(rocketSection, () => (q.reducedMotion ? rocket.showAnswered() : void rocket.playIntro()))
mountWhenVisible(rocketStage, async () => {
  const { createRocketScene } = await import('./sections/rocket/rocketScene')
  const scene = await createRocketScene(rocketStage, q)
  rocket.attach(scene)
  return scene
})
