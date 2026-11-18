/**
 * Journal segments (spec 6.6): one gzipped JSON-lines file of consecutive
 * ops from one device, `<firstSeq>-<lastSeq>.jsonl.gz`. Segments are read
 * from storage any device can write to, so every line is validated and a
 * bad line is reported and skipped rather than trusted.
 */

import { gunzipText, gzipText } from './gzip';
import type { OpEnvelope } from './types';
import { validateEnvelope } from './validate';

const SEQ_DIGITS = 12;
const SEGMENT_PATTERN = /^(\d{12})-(\d{12})\.jsonl\.gz$/;

/** A decoded segment may not inflate past this. */
export const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
/** Lines longer than this are rejected without parsing. */
export const MAX_LINE_LENGTH = 256 * 1024;

export const SEGMENT_MIME_TYPE = 'application/gzip';

export function segmentName(firstSeq: number, lastSeq: number): string {
  return `${String(firstSeq).padStart(SEQ_DIGITS, '0')}-${String(lastSeq).padStart(SEQ_DIGITS, '0')}.jsonl.gz`;
}

export function parseSegmentName(name: string): { firstSeq: number; lastSeq: number } | null {
  const match = SEGMENT_PATTERN.exec(name);
  if (!match) return null;
  const firstSeq = Number(match[1]);
  const lastSeq = Number(match[2]);
  if (firstSeq < 1 || lastSeq < firstSeq) return null;
  return { firstSeq, lastSeq };
}

export async function encodeSegment(ops: readonly OpEnvelope[]): Promise<Blob> {
  return gzipText(ops.map((op) => JSON.stringify(op)).join('\n') + '\n');
}

export interface SegmentLineError {
  /** 1-based. */
  readonly line: number;
  readonly reason: string;
}

export interface DecodedSegment {
  readonly ops: OpEnvelope[];
  readonly errors: SegmentLineError[];
}

export interface DecodeSegmentOptions {
  /** When set, ops from any other device are rejected (a segment lives in its device's folder). */
  readonly device?: string;
  /** When set, ops outside the seq range in the file name are rejected. */
  readonly range?: { readonly firstSeq: number; readonly lastSeq: number };
}

/**
 * Decodes a segment. Throws `DecodeError` when the file as a whole is
 * unreadable (not gzip, too large, not UTF-8); bad lines go to `errors`.
 */
export async function decodeSegment(blob: Blob, options: DecodeSegmentOptions = {}): Promise<DecodedSegment> {
  const text = await gunzipText(blob, MAX_SEGMENT_BYTES);
  const ops: OpEnvelope[] = [];
  const errors: SegmentLineError[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    const report = (reason: string) => errors.push({ line: i + 1, reason });
    if (line.length > MAX_LINE_LENGTH) {
      report('line is too long');
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      report('line is not JSON');
      continue;
    }
    const env = validateEnvelope(parsed);
    if (typeof env === 'string') {
      report(env);
      continue;
    }
    if (options.device !== undefined && env.device !== options.device) {
      report('op is from another device than its folder');
      continue;
    }
    if (options.range && (env.seq < options.range.firstSeq || env.seq > options.range.lastSeq)) {
      report('seq is outside the segment range');
      continue;
    }
    ops.push(env);
  }
  return { ops, errors };
}
