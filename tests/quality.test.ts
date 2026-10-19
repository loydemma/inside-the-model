import { describe, it, expect } from 'vitest'
import { detectQuality, isSoftwareRenderer } from '../src/engine/quality'

describe('detectQuality', () => {
  it('uses light tier with capped pixel ratio on touch devices', () => {
    const q = detectQuality({ coarsePointer: true, reducedMotion: false, cores: 8, dpr: 3 })
    expect(q.tier).toBe('light')
    expect(q.pixelRatio).toBeLessThanOrEqual(1.5)
  })
  it('uses high tier on a capable desktop', () => {
    const q = detectQuality({ coarsePointer: false, reducedMotion: false, cores: 8, dpr: 2 })
    expect(q.tier).toBe('high')
    expect(q.pixelRatio).toBe(2)
  })
  it('uses light tier on low-core machines', () => {
    expect(detectQuality({ coarsePointer: false, reducedMotion: false, cores: 2, dpr: 1 }).tier).toBe('light')
  })
  it('passes reduced motion through', () => {
    expect(detectQuality({ coarsePointer: false, reducedMotion: true, cores: 8, dpr: 1 }).reducedMotion).toBe(true)
  })
})

describe('software rendering', () => {
  it('recognizes common software renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true)
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true)
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true)
    expect(isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe(false)
  })
  it('drops to the light tier at 1x pixels when the GPU is software', () => {
    const q = detectQuality({ coarsePointer: false, reducedMotion: false, cores: 8, dpr: 2, softwareGpu: true })
    expect(q.tier).toBe('light')
    expect(q.pixelRatio).toBe(1)
  })
})
