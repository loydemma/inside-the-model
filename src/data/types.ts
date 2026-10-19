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
  invented?: boolean;
}
export interface HallucinationData {
  source: string;
  question: string;
  ungrounded: { steps: GenerationStep[] };
  grounded: { sourceCard: { title: string; text: string }; steps: GenerationStep[] };
}

export interface MemoryData {
  source: string;
  capacity: number;
  instruction: string;
  messages: string[];
  replyRemembered: string;
  replyForgotten: string;
}

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

function parseSteps(v: unknown, field: string, min: number, max: number): GenerationStep[] {
  const steps = arr(v, field);
  if (steps.length < min || steps.length > max) fail(field, `must have ${min} to ${max} entries`);
  return steps.map((s, i) => {
    const o = obj(s, `${field}[${i}]`);
    const chosen = str(o.chosen, `${field}[${i}].chosen`);
    const cands = arr(o.candidates, `${field}[${i}].candidates`);
    if (cands.length !== GENERATION_CANDIDATES) fail(`${field}[${i}].candidates`, `must have ${GENERATION_CANDIDATES} entries`);
    const candidates = cands.map((c, j) => {
      const co = obj(c, `${field}[${i}].candidates[${j}]`);
      const p = num(co.p, `${field}[${i}].candidates[${j}].p`);
      if (p < 0 || p > 1) fail(`${field}[${i}].candidates[${j}].p`, 'must be between 0 and 1');
      return { token: str(co.token, `${field}[${i}].candidates[${j}].token`), p };
    });
    if (candidates.some((c, j) => j > 0 && c.p > candidates[j - 1]!.p)) fail(`${field}[${i}].candidates`, 'must be sorted by p descending');
    if (candidates.reduce((a, c) => a + c.p, 0) > 1 + 1e-3) fail(`${field}[${i}].candidates`, 'p must sum to at most 1');
    if (!candidates.some((c) => c.token === chosen)) fail(`${field}[${i}].chosen`, 'must be one of the candidates');
    if (o.invented !== undefined && typeof o.invented !== 'boolean') fail(`${field}[${i}].invented`, 'must be a boolean');
    return o.invented === true ? { chosen, candidates, invented: true } : { chosen, candidates };
  });
}

export function parseHallucination(raw: unknown): HallucinationData {
  const root = obj(raw, 'generation');
  const ungrounded = parseSteps(obj(root.ungrounded, 'ungrounded').steps, 'ungrounded.steps', 12, 20);
  if (ungrounded.filter((s) => s.invented).length !== 1) fail('ungrounded.steps', 'must have exactly one step with invented: true');
  const grounded = obj(root.grounded, 'grounded');
  const card = obj(grounded.sourceCard, 'grounded.sourceCard');
  return {
    source: str(root.source, 'source'),
    question: str(root.question, 'question'),
    ungrounded: { steps: ungrounded },
    grounded: {
      sourceCard: { title: str(card.title, 'grounded.sourceCard.title'), text: str(card.text, 'grounded.sourceCard.text') },
      steps: parseSteps(grounded.steps, 'grounded.steps', 8, 16),
    },
  };
}

export function parseMemory(raw: unknown): MemoryData {
  const root = obj(raw, 'memory');
  const capacity = num(root.capacity, 'capacity');
  if (!Number.isInteger(capacity) || capacity < 2) fail('capacity', 'must be an integer of at least 2');
  const messages = arr(root.messages, 'messages').map((m, i) => str(m, `messages[${i}]`));
  if (messages.length < 8 || messages.length > 12) fail('messages', 'must have 8 to 12 entries');
  return {
    source: str(root.source, 'source'),
    capacity,
    instruction: str(root.instruction, 'instruction'),
    messages,
    replyRemembered: str(root.replyRemembered, 'replyRemembered'),
    replyForgotten: str(root.replyForgotten, 'replyForgotten'),
  };
}
