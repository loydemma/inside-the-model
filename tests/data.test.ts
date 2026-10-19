import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadData, showDemoError } from '../src/data/load';
import { parseAgentPlan, parseAttention, parseGeneration, parseTemperature } from '../src/data/types';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8'));

describe('data parsers', () => {
  it('accept the real files', () => {
    expect(parseAttention(read('attention')).sentences.length).toBeGreaterThanOrEqual(3);
    expect(parseTemperature(read('temperature')).samples).toHaveLength(5);
    expect(parseGeneration(read('generation')).steps).toHaveLength(24);
    expect(parseAgentPlan(read('agent-plan')).steps).toHaveLength(6);
  });

  it('parseAgentPlan rejects 5 steps', () => {
    const raw = read('agent-plan') as { steps: unknown[] };
    raw.steps.pop();
    expect(() => parseAgentPlan(raw)).toThrow(/steps/);
  });

  it('parseTemperature rejects 4 samples', () => {
    const raw = read('temperature') as { samples: unknown[] };
    raw.samples.pop();
    expect(() => parseTemperature(raw)).toThrow(/samples/);
  });

  it('parseAttention rejects a non-square matrix', () => {
    const raw = read('attention') as { sentences: { weights: number[][] }[] };
    raw.sentences[0]!.weights.pop();
    expect(() => parseAttention(raw)).toThrow(/weights/);
  });
});

describe('loadData', () => {
  it('rejects on a 404', async () => {
    const fetchFn = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(loadData('/data/x.json', (r) => r, fetchFn)).rejects.toThrow();
  });
});

describe('showDemoError', () => {
  it('appends exactly one message even when called twice', () => {
    const section = document.createElement('section');
    showDemoError(section);
    showDemoError(section);
    expect(section.querySelectorAll('.demo-error')).toHaveLength(1);
  });
});
