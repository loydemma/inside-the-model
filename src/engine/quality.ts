// `software`: the browser has no GPU acceleration; live 3D would freeze the page there.
export type Quality = { tier: 'high' | 'light'; reducedMotion: boolean; pixelRatio: number; software: boolean }

type Env = { coarsePointer: boolean; reducedMotion: boolean; cores: number; dpr: number; softwareGpu?: boolean }

// Renderers that draw on the CPU instead of a GPU (no hardware acceleration available).
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(name)
}

// Ask a throwaway WebGL context which renderer the browser is using.
function detectSoftwareGpu(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return isSoftwareRenderer(name)
  } catch {
    return false
  }
}

function readEnv(): Env {
  return {
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    cores: navigator.hardwareConcurrency ?? 4,
    dpr: window.devicePixelRatio || 1,
    softwareGpu: detectSoftwareGpu(),
  }
}

export function detectQuality(env: Env = readEnv()): Quality {
  const light = env.coarsePointer || env.cores <= 4 || !!env.softwareGpu
  return {
    tier: light ? 'light' : 'high',
    reducedMotion: env.reducedMotion,
    // Software rendering is slow per pixel, so render at 1x there.
    pixelRatio: env.softwareGpu ? 1 : Math.min(env.dpr, light ? 1.5 : 2),
    software: !!env.softwareGpu,
  }
}
