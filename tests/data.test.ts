import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadData, showDemoError } from '../src/data/load';
import { parseHallucination, parseMemory, parseTemperature } from '../src/data/types';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8'));

describe('data parsers', () => {
  it('accept the real files', () => {
    expect(parseTemperature(read('temperature')).samples).toHaveLength(5);
    expect(parseHallucination(read('generation')).ungrounded.steps.length).toBeGreaterThanOrEqual(12);
    expect(parseMemory(read('memory')).capacity).toBe(6);
  });

  it('parseTemperature rejects 4 samples', () => {
    const raw = read('temperature') as { samples: unknown[] };
    raw.samples.pop();
    expect(() => parseTemperature(raw)).toThrow(/samples/);
  });

  it('parseHallucination rejects zero or two invented steps', () => {
    type Raw = { ungrounded: { steps: { invented?: boolean }[] } };
    const none = read('generation') as Raw;
    none.ungrounded.steps.forEach((st) => delete st.invented);
    expect(() => parseHallucination(none)).toThrow(/invented/);
    const two = read('generation') as Raw;
    two.ungrounded.steps[0]!.invented = true;
    expect(() => parseHallucination(two)).toThrow(/invented/);
  });

  it('parseMemory rejects a tiny capacity and no messages', () => {
    const small = read('memory') as { capacity: number };
    small.capacity = 1;
    expect(() => parseMemory(small)).toThrow(/capacity/);
    const empty = read('memory') as { messages: string[] };
    empty.messages = [];
    expect(() => parseMemory(empty)).toThrow(/messages/);
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
