import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadData, showDemoError } from '../src/data/load';
import { parseGeneration, parseTemperature } from '../src/data/types';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8'));

describe('data parsers', () => {
  it('accept the real files', () => {
    expect(parseTemperature(read('temperature')).samples).toHaveLength(5);
    expect(parseGeneration(read('generation')).steps).toHaveLength(24);
  });

  it('parseTemperature rejects 4 samples', () => {
    const raw = read('temperature') as { samples: unknown[] };
    raw.samples.pop();
    expect(() => parseTemperature(raw)).toThrow(/samples/);
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
