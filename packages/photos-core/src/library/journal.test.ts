import { describe, expect, it } from 'vitest';
import { DecodeError, gzipText } from './gzip';
import { decodeSegment, encodeSegment, MAX_LINE_LENGTH, parseSegmentName, segmentName } from './journal';
import type { OpEnvelope } from './types';

function env(seq: number, overrides: Partial<Record<keyof OpEnvelope, unknown>> = {}): OpEnvelope {
  return {
    id: `dev:${seq}`,
    device: 'dev',
    seq,
    hlc: `00000000000${String(1000 + seq).padStart(4, '0')}-00000-dev`,
    v: 1,
    op: { t: 'set', kind: 'asset', id: 'a', fields: { rating: seq % 6 } },
    ...overrides,
  } as OpEnvelope;
}

describe('segment names', () => {
  it('are zero-padded so they sort by sequence', () => {
    const names = [segmentName(10, 12), segmentName(2, 9), segmentName(100, 100)];
    expect([...names].sort()).toEqual([segmentName(2, 9), segmentName(10, 12), segmentName(100, 100)]);
    expect(parseSegmentName(segmentName(2, 9))).toEqual({ firstSeq: 2, lastSeq: 9 });
  });

  it('reject anything else', () => {
    for (const bad of ['1-2.jsonl.gz', `${segmentName(5, 4)}`, 'readme.txt', segmentName(1, 2) + '.tmp']) {
      expect(parseSegmentName(bad)).toBeNull();
    }
  });
});

describe('segments', () => {
  it('round trip', async () => {
    const ops = [
      env(1),
      env(2, { step: { id: 's1', label: 'Exposure' } }),
      env(3, { op: { t: 'member', kind: 'album', id: 'al', set: 'assets', member: 'a', present: false } }),
    ];
    const decoded = await decodeSegment(await encodeSegment(ops), { device: 'dev', range: { firstSeq: 1, lastSeq: 3 } });
    expect(decoded.errors).toEqual([]);
    expect(decoded.ops).toEqual(ops);
  });

  it('skips and reports malformed lines', async () => {
    const lines = [
      JSON.stringify(env(1)),
      'not json',
      JSON.stringify({ ...env(2), id: 'dev:99' }),
      JSON.stringify({ ...env(3), hlc: '000000000001003-00000-other' }),
      JSON.stringify({ ...env(4), v: 7 }),
      JSON.stringify({ ...env(5), op: { t: 'drop', kind: 'asset', id: 'a' } }),
      JSON.stringify({ ...env(6), op: { t: 'set', kind: 'asset', id: 'a', fields: {} } }),
      JSON.stringify({ ...env(7), op: { t: 'set', kind: 'planet', id: 'a', fields: { x: 1 } } }),
      JSON.stringify({ ...env(8), op: { t: 'set', kind: 'asset', id: 'a', fields: { x: 'y'.repeat(20_000) } } }),
      JSON.stringify({ ...env(9), step: { id: 5, label: 'x' } }),
      JSON.stringify({ ...env(10), op: { t: 'member', kind: 'asset', id: 'a', set: 'k', member: 'm', present: 'yes' } }),
      'x'.repeat(MAX_LINE_LENGTH + 1),
      JSON.stringify(env(11, { device: 'other', id: 'other:11', hlc: '000000000001011-00000-other' })),
      JSON.stringify(env(50)),
      '[1,2,3]',
      '',
      JSON.stringify(env(12)),
    ];
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = [deep];
    lines.push(JSON.stringify({ ...env(13), op: { t: 'set', kind: 'asset', id: 'a', fields: { x: deep } } }));
    const decoded = await decodeSegment(await gzipText(lines.join('\n')), { device: 'dev', range: { firstSeq: 1, lastSeq: 20 } });
    expect(decoded.ops.map((o) => o.seq)).toEqual([1, 12]);
    expect(decoded.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18]);
    expect(decoded.errors.every((e) => e.reason.length > 0)).toBe(true);
  });

  it('rejects files that are not gzip or are truncated', async () => {
    await expect(decodeSegment(new Blob(['plain text']))).rejects.toBeInstanceOf(DecodeError);
    const bytes = new Uint8Array(await (await gzipText('{}')).arrayBuffer());
    await expect(decodeSegment(new Blob([bytes.slice(0, bytes.length - 6)]))).rejects.toBeInstanceOf(DecodeError);
  });

  it('rejects invalid UTF-8', async () => {
    const stream = new Blob([new Uint8Array([0xff, 0xfe, 0x00])]).stream().pipeThrough(new CompressionStream('gzip'));
    const blob = new Blob([await new Response(stream).arrayBuffer()]);
    await expect(decodeSegment(blob)).rejects.toBeInstanceOf(DecodeError);
  });
});
