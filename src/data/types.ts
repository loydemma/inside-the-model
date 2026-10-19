import { TEMPERATURE_STOPS } from '../config';

export interface TemperatureSample {
  temperature: number;
  text: string;
}
export interface TemperatureData {
  source: string;
  prompt: string;
  samples: TemperatureSample[];
}

export interface Candidate {
  token: string;
  p: number;
}
export interface GenerationStep {
  chosen: string;
  candidates: Candidate[];
}
export interface GenerationData {
  source: string;
  prompt: string;
  steps: GenerationStep[];
}

export const GENERATION_STEPS = 24;
export const GENERATION_CANDIDATES = 5;

function fail(field: string, why: string): never {
  throw new Error(`Invalid data: ${field} ${why}`);
}

function obj(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(field, 'must be an object');
  return v as Record<string, unknown>;
}
function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v === '') fail(field, 'must be a non-empty string');
  return v as string;
}
function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(field, 'must be a finite number');
  return v as number;
}
function arr(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v)) fail(field, 'must be an array');
  return v as unknown[];
}

export function parseTemperature(raw: unknown): TemperatureData {
  const root = obj(raw, 'temperature');
  const samples = arr(root.samples, 'samples');
  if (samples.length !== TEMPERATURE_STOPS.length) fail('samples', `must have ${TEMPERATURE_STOPS.length} entries`);
  return {
    source: str(root.source, 'source'),
    prompt: str(root.prompt, 'prompt'),
    samples: samples.map((s, i) => {
      const o = obj(s, `samples[${i}]`);
      const temperature = num(o.temperature, `samples[${i}].temperature`);
      if (temperature !== TEMPERATURE_STOPS[i]) fail(`samples[${i}].temperature`, `must be ${TEMPERATURE_STOPS[i]}`);
      const text = str(o.text, `samples[${i}].text`);
      if (text.split(/\s+/).length > 40) fail(`samples[${i}].text`, 'must be at most 40 words');
      return { temperature, text };
    }),
  };
}

export function parseGeneration(raw: unknown): GenerationData {
  const root = obj(raw, 'generation');
  const steps = arr(root.steps, 'steps');
  if (steps.length !== GENERATION_STEPS) fail('steps', `must have ${GENERATION_STEPS} entries`);
  return {
    source: str(root.source, 'source'),
    prompt: str(root.prompt, 'prompt'),
    steps: steps.map((s, i) => {
      const o = obj(s, `steps[${i}]`);
      const chosen = str(o.chosen, `steps[${i}].chosen`);
      const cands = arr(o.candidates, `steps[${i}].candidates`);
      if (cands.length !== GENERATION_CANDIDATES) fail(`steps[${i}].candidates`, `must have ${GENERATION_CANDIDATES} entries`);
      const candidates = cands.map((c, j) => {
        const co = obj(c, `steps[${i}].candidates[${j}]`);
        const p = num(co.p, `steps[${i}].candidates[${j}].p`);
        if (p < 0 || p > 1) fail(`steps[${i}].candidates[${j}].p`, 'must be between 0 and 1');
        return { token: str(co.token, `steps[${i}].candidates[${j}].token`), p };
      });
      if (candidates.some((c, j) => j > 0 && c.p > candidates[j - 1]!.p)) fail(`steps[${i}].candidates`, 'must be sorted by p descending');
      if (candidates.reduce((a, c) => a + c.p, 0) > 1 + 1e-3) fail(`steps[${i}].candidates`, 'p must sum to at most 1');
      if (!candidates.some((c) => c.token === chosen)) fail(`steps[${i}].chosen`, 'must be one of the candidates');
      return { chosen, candidates };
    }),
  };
}
