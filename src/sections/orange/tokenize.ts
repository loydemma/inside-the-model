import { MAX_TOKENS } from '../../config'

export type Token = { id: number; text: string; partial: boolean }

type Encoder = { encode(text: string): number[]; decode(ids: number[]): string }
let encoder: Promise<Encoder> | null = null

// The tokenizer and its ~2 MB rank table load on first use, not with the page.
function getEncoder(): Promise<Encoder> {
  encoder ??= Promise.all([import('js-tiktoken/lite'), import('js-tiktoken/ranks/o200k_base')]).then(
    ([{ Tiktoken }, ranks]) => new Tiktoken(ranks.default),
  )
  // A failed download must not stick; the next call tries again.
  encoder.catch(() => { encoder = null })
  return encoder
}

export async function tokenize(
  text: string,
  max: number = MAX_TOKENS,
): Promise<{ tokens: Token[]; total: number; truncated: boolean }> {
  if (!text) return { tokens: [], total: 0, truncated: false }
  const enc = await getEncoder()
  const ids = enc.encode(text)
  const tokens = ids.slice(0, max).map((id): Token => {
    // A token can be half of a multi-byte character, which decodes to a replacement character.
    const decoded = enc.decode([id])
    return decoded.includes('�') ? { id, text: '⟨byte⟩', partial: true } : { id, text: decoded, partial: false }
  })
  return { tokens, total: ids.length, truncated: ids.length > max }
}
