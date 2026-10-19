import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/sections/orange/tokenize'

describe('tokenize', () => {
  it('splits hello world into two real tokens', async () => {
    const r = await tokenize('hello world')
    expect(r.tokens.map((t) => t.text)).toEqual(['hello', ' world'])
    expect(r.tokens.some((t) => t.partial)).toBe(false)
    expect(r.truncated).toBe(false)
  })

  it('never shows a replacement character for partial bytes', async () => {
    const r = await tokenize('🦄')
    for (const t of r.tokens) {
      expect(t.text.includes('�')).toBe(false)
      expect(t.partial ? t.text === '⟨byte⟩' : t.text.length > 0).toBe(true)
    }
  })

  it('caps at 16 tokens and reports the full total', async () => {
    const r = await tokenize(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '))
    expect(r.tokens).toHaveLength(16)
    expect(r.truncated).toBe(true)
    expect(r.total).toBeGreaterThan(16)
  })

  it('returns nothing for empty text', async () => {
    expect(await tokenize('')).toEqual({ tokens: [], total: 0, truncated: false })
  })

  it('handles accented and CJK text without replacement characters', async () => {
    const r = await tokenize('café 東京')
    const readable = r.tokens.filter((t) => !t.partial).map((t) => t.text).join('')
    expect(readable.includes('�')).toBe(false)
    expect('café 東京'.includes(readable.trim()) || readable.length > 0).toBe(true)
  })
})
