/**
 * Schema checks for data read back from storage. Journal segments and
 * snapshots can be written by any device (or by hand), so nothing decoded
 * from them is trusted until it passes these.
 */

import { isHlc, parseHlc } from './hlc';
import { isDeviceId } from './ids';
import type { EntityKind, Json, Op, OpEnvelope, OpStep } from './types';

/** The op schema this app writes and reads. */
export const OP_SCHEMA_VERSION = 1;

export const LIMITS = {
  idLength: 128,
  fieldPathLength: 128,
  fieldsPerOp: 200,
  setNameLength: 64,
  memberLength: 256,
  stepLabelLength: 200,
  jsonDepth: 8,
  jsonNodes: 2000,
  stringLength: 10_000,
} as const;

const KINDS: ReadonlySet<string> = new Set<EntityKind>(['asset', 'version', 'album', 'setting']);

const UNSAFE_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Field paths become object keys when records are built, so prototype-touching names are refused. */
export function isSafePath(path: string): boolean {
  return path.split('.').every((segment) => !UNSAFE_SEGMENTS.has(segment));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && KINDS.has(value);
}

/** Whether `value` is JSON within the depth, size and string-length caps. */
export function isBoundedJson(value: unknown): value is Json {
  let nodes = 0;
  const walk = (v: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > LIMITS.jsonNodes || depth > LIMITS.jsonDepth) return false;
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string') return v.length <= LIMITS.stringLength;
    if (Array.isArray(v)) return v.every((item) => walk(item, depth + 1));
    if (isRecord(v)) {
      return Object.entries(v).every(([k, item]) => k.length <= LIMITS.fieldPathLength && walk(item, depth + 1));
    }
    return false;
  };
  return walk(value, 0);
}

function validateStep(value: unknown): OpStep | string {
  if (!isRecord(value)) return 'step is not an object';
  const { id, label, undoes, redoes } = value;
  if (!isBoundedString(id, LIMITS.idLength)) return 'step.id is invalid';
  if (typeof label !== 'string' || label.length > LIMITS.stepLabelLength) return 'step.label is invalid';
  if (undoes !== undefined && !isBoundedString(undoes, LIMITS.idLength)) return 'step.undoes is invalid';
  if (redoes !== undefined && !isBoundedString(redoes, LIMITS.idLength)) return 'step.redoes is invalid';
  const step: { id: string; label: string; undoes?: string; redoes?: string } = { id, label };
  if (undoes !== undefined) step.undoes = undoes;
  if (redoes !== undefined) step.redoes = redoes;
  return step;
}

function validateOp(value: unknown): Op | string {
  if (!isRecord(value)) return 'op is not an object';
  const { t, kind, id } = value;
  if (!isEntityKind(kind)) return 'op.kind is invalid';
  if (!isBoundedString(id, LIMITS.idLength)) return 'op.id is invalid';
  if (t === 'set') {
    const fields = value.fields;
    if (!isRecord(fields)) return 'op.fields is not an object';
    const entries = Object.entries(fields);
    if (entries.length === 0 || entries.length > LIMITS.fieldsPerOp) return 'op.fields has a bad size';
    const out: Record<string, Json> = {};
    for (const [path, v] of entries) {
      if (!isBoundedString(path, LIMITS.fieldPathLength) || !isSafePath(path)) return 'op.fields has an invalid path';
      if (!isBoundedJson(v)) return `op.fields.${path} is not bounded JSON`;
      out[path] = v;
    }
    return { t, kind, id, fields: out };
  }
  if (t === 'member') {
    const { set, member, present } = value;
    if (!isBoundedString(set, LIMITS.setNameLength)) return 'op.set is invalid';
    if (!isBoundedString(member, LIMITS.memberLength)) return 'op.member is invalid';
    if (typeof present !== 'boolean') return 'op.present is not a boolean';
    return { t, kind, id, set, member, present };
  }
  return 'op.t is unknown';
}

/** A checked envelope, or a reason it was rejected. */
export function validateEnvelope(value: unknown): OpEnvelope | string {
  if (!isRecord(value)) return 'envelope is not an object';
  const { id, device, seq, hlc, v, step, op } = value;
  if (!isDeviceId(device)) return 'device is invalid';
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return 'seq is invalid';
  if (id !== `${device}:${seq}`) return 'id does not match device and seq';
  if (!isHlc(hlc)) return 'hlc is invalid';
  if (parseHlc(hlc)?.device !== device) return 'hlc names another device';
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return 'v is invalid';
  if (v > OP_SCHEMA_VERSION) return `v ${v} is newer than this app reads`;
  const checkedOp = validateOp(op);
  if (typeof checkedOp === 'string') return checkedOp;
  if (step === undefined) return { id, device, seq, hlc, v, op: checkedOp };
  const checkedStep = validateStep(step);
  if (typeof checkedStep === 'string') return checkedStep;
  return { id, device, seq, hlc, v, step: checkedStep, op: checkedOp };
}
