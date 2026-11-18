/**
 * The generic merge store (spec 6.6). Entities are bags of last-writer-wins
 * field registers plus last-writer-wins set members, keyed by kind and ID.
 * A register is replaced only by a write with a greater (hlc, opId), so
 * applying ops is idempotent and gives the same state in any order.
 *
 * It also keeps each version's recipe writes, grouped by history step, for
 * undo and the history list. That log is not part of the merged view.
 */

import { isHlc } from './hlc';
import type { EntityKind, Json, OpEnvelope, OpStep } from './types';
import { isBoundedJson, isEntityKind, isRecord, LIMITS } from './validate';

export interface Register {
  readonly value: Json;
  readonly hlc: string;
  readonly opId: string;
}

export interface MemberRegister {
  readonly present: boolean;
  readonly hlc: string;
  readonly opId: string;
}

export interface EntityRecord {
  readonly fields: ReadonlyMap<string, Register>;
  readonly sets: ReadonlyMap<string, ReadonlyMap<string, MemberRegister>>;
}

interface MutableRecord {
  readonly fields: Map<string, Register>;
  readonly sets: Map<string, Map<string, MemberRegister>>;
}

/** One write to a version's recipe, as history sees it. */
export interface RecipeWrite {
  readonly opId: string;
  readonly hlc: string;
  readonly step: OpStep | null;
  /** Recipe paths without the `recipe.` prefix. */
  readonly fields: Readonly<Record<string, Json>>;
}

interface VersionHistory {
  /** Writes folded away from the log, merged last-writer-wins per path. */
  readonly base: Map<string, Register>;
  /** Sorted by (hlc, opId). */
  entries: RecipeWrite[];
  readonly opIds: Set<string>;
}

export interface ChangedEntity {
  readonly kind: EntityKind;
  readonly id: string;
}

export const RECIPE_PREFIX = 'recipe.';

/** The log keeps at least this many writes per version (spec: the last 200 steps). */
const HISTORY_KEEP = 200;
const HISTORY_FOLD_AT = 250;

/** Whether the write (aHlc, aOp) beats (bHlc, bOp). Op IDs break ties so every device agrees. */
export function wins(aHlc: string, aOp: string, bHlc: string, bOp: string): boolean {
  if (aHlc !== bHlc) return aHlc > bHlc;
  return aOp > bOp;
}

function writeOrder(a: RecipeWrite, b: RecipeWrite): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  return a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
}

export type SerializedField = [path: string, value: Json, hlc: string, opId: string];
export type SerializedMember = [member: string, present: boolean, hlc: string, opId: string];

export interface SerializedEntity {
  readonly kind: EntityKind;
  readonly id: string;
  readonly fields: readonly SerializedField[];
  readonly sets: readonly [set: string, members: readonly SerializedMember[]][];
}

export interface SerializedHistory {
  readonly versionId: string;
  readonly base: readonly SerializedField[];
  readonly entries: readonly RecipeWrite[];
}

/** The whole store as plain data: snapshots and the device's saved state. */
export interface SerializedStore {
  readonly format: 1;
  readonly maxHlc: string | null;
  readonly entities: readonly SerializedEntity[];
  readonly history: readonly SerializedHistory[];
}

export class MergeStore {
  private readonly records = new Map<EntityKind, Map<string, MutableRecord>>();
  private readonly histories = new Map<string, VersionHistory>();
  private latest: string | null = null;

  /** The greatest HLC applied so far; the device clock moves past it. */
  get maxHlc(): string | null {
    return this.latest;
  }

  /** Applies envelopes and returns the entities whose merged state changed. */
  applyOps(envelopes: Iterable<OpEnvelope>): ChangedEntity[] {
    const changed = new Map<string, ChangedEntity>();
    for (const env of envelopes) {
      if (this.latest === null || env.hlc > this.latest) this.latest = env.hlc;
      const { op } = env;
      const record = this.record(op.kind, op.id);
      let didChange = false;
      if (op.t === 'set') {
        for (const [path, value] of Object.entries(op.fields)) {
          const current = record.fields.get(path);
          if (!current || wins(env.hlc, env.id, current.hlc, current.opId)) {
            record.fields.set(path, { value, hlc: env.hlc, opId: env.id });
            didChange = true;
          }
        }
        if (op.kind === 'version') this.recordHistory(op.id, env, op.fields);
      } else {
        let members = record.sets.get(op.set);
        if (!members) {
          members = new Map();
          record.sets.set(op.set, members);
        }
        const current = members.get(op.member);
        if (!current || wins(env.hlc, env.id, current.hlc, current.opId)) {
          members.set(op.member, { present: op.present, hlc: env.hlc, opId: env.id });
          didChange = true;
        }
      }
      if (didChange) changed.set(`${op.kind}/${op.id}`, { kind: op.kind, id: op.id });
    }
    return [...changed.values()];
  }

  get(kind: EntityKind, id: string): EntityRecord | undefined {
    return this.records.get(kind)?.get(id);
  }

  ids(kind: EntityKind): IterableIterator<string> {
    return (this.records.get(kind) ?? new Map<string, MutableRecord>()).keys();
  }

  /** The version's recipe writes still in the log, oldest first. */
  recipeWrites(versionId: string): readonly RecipeWrite[] {
    return this.histories.get(versionId)?.entries ?? [];
  }

  /** The value a recipe path had from writes folded out of the log, if any. */
  foldedRecipeValue(versionId: string, path: string): Json | undefined {
    return this.histories.get(versionId)?.base.get(path)?.value;
  }

  serialize(): SerializedStore {
    const entities: SerializedEntity[] = [];
    for (const [kind, byId] of this.records) {
      for (const [id, record] of byId) {
        entities.push({
          kind,
          id,
          fields: [...record.fields].map(([path, r]) => [path, r.value, r.hlc, r.opId]),
          sets: [...record.sets].map(([set, members]) => [
            set,
            [...members].map(([member, r]) => [member, r.present, r.hlc, r.opId]),
          ]),
        });
      }
    }
    const history: SerializedHistory[] = [];
    for (const [versionId, h] of this.histories) {
      history.push({
        versionId,
        base: [...h.base].map(([path, r]) => [path, r.value, r.hlc, r.opId]),
        entries: h.entries,
      });
    }
    return { format: 1, maxHlc: this.latest, entities, history };
  }

  /** Rebuilds a store from `serialize()` output; throws on anything malformed. */
  static deserialize(data: unknown): MergeStore {
    if (!isRecord(data) || data.format !== 1) throw new Error('Store data has an unknown format');
    const store = new MergeStore();
    if (data.maxHlc !== null && !isHlc(data.maxHlc)) throw new Error('Store data has an invalid maxHlc');
    store.latest = data.maxHlc;
    if (!Array.isArray(data.entities) || !Array.isArray(data.history)) throw new Error('Store data is incomplete');
    for (const raw of data.entities) {
      if (!isRecord(raw) || !isEntityKind(raw.kind) || !isId(raw.id)) throw new Error('Store data has an invalid entity');
      if (!Array.isArray(raw.fields) || !Array.isArray(raw.sets)) throw new Error('Store data has an invalid entity');
      const record = store.record(raw.kind, raw.id);
      for (const f of raw.fields) {
        const [path, register] = parseField(f);
        record.fields.set(path, register);
      }
      for (const s of raw.sets) {
        if (!Array.isArray(s) || s.length !== 2 || !isId(s[0]) || !Array.isArray(s[1])) {
          throw new Error('Store data has an invalid set');
        }
        const members = new Map<string, MemberRegister>();
        for (const m of s[1] as unknown[]) {
          if (!Array.isArray(m) || m.length !== 4) throw new Error('Store data has an invalid member');
          const [member, present, hlc, opId] = m as unknown[];
          if (!isId(member, LIMITS.memberLength) || typeof present !== 'boolean' || !isHlc(hlc) || !isId(opId)) {
            throw new Error('Store data has an invalid member');
          }
          members.set(member, { present, hlc, opId });
        }
        record.sets.set(s[0], members);
      }
    }
    for (const raw of data.history) {
      if (!isRecord(raw) || !isId(raw.versionId) || !Array.isArray(raw.base) || !Array.isArray(raw.entries)) {
        throw new Error('Store data has an invalid history');
      }
      const h = store.history(raw.versionId);
      for (const f of raw.base) {
        const [path, register] = parseField(f);
        h.base.set(path, register);
      }
      for (const e of raw.entries) {
        const write = parseWrite(e);
        h.entries.push(write);
        h.opIds.add(write.opId);
      }
      h.entries.sort(writeOrder);
    }
    return store;
  }

  private record(kind: EntityKind, id: string): MutableRecord {
    let byId = this.records.get(kind);
    if (!byId) {
      byId = new Map();
      this.records.set(kind, byId);
    }
    let record = byId.get(id);
    if (!record) {
      record = { fields: new Map(), sets: new Map() };
      byId.set(id, record);
    }
    return record;
  }

  private history(versionId: string): VersionHistory {
    let h = this.histories.get(versionId);
    if (!h) {
      h = { base: new Map(), entries: [], opIds: new Set() };
      this.histories.set(versionId, h);
    }
    return h;
  }

  private recordHistory(versionId: string, env: OpEnvelope, fields: Readonly<Record<string, Json>>): void {
    const recipe: Record<string, Json> = {};
    let any = false;
    for (const [path, value] of Object.entries(fields)) {
      if (path.startsWith(RECIPE_PREFIX)) {
        recipe[path.slice(RECIPE_PREFIX.length)] = value;
        any = true;
      }
    }
    if (!any) return;
    const h = this.history(versionId);
    if (h.opIds.has(env.id)) return;
    h.opIds.add(env.id);
    const write: RecipeWrite = { opId: env.id, hlc: env.hlc, step: env.step ?? null, fields: recipe };
    let i = h.entries.length;
    while (i > 0 && writeOrder(h.entries[i - 1] as RecipeWrite, write) > 0) i -= 1;
    h.entries.splice(i, 0, write);
    if (h.entries.length > HISTORY_FOLD_AT) this.fold(h);
  }

  private fold(h: VersionHistory): void {
    const drop = h.entries.splice(0, h.entries.length - HISTORY_KEEP);
    for (const write of drop) {
      h.opIds.delete(write.opId);
      for (const [path, value] of Object.entries(write.fields)) {
        const current = h.base.get(path);
        if (!current || wins(write.hlc, write.opId, current.hlc, current.opId)) {
          h.base.set(path, { value, hlc: write.hlc, opId: write.opId });
        }
      }
    }
  }
}

function isId(value: unknown, max: number = LIMITS.idLength): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseField(value: unknown): [string, Register] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('Store data has an invalid field');
  const [path, v, hlc, opId] = value as unknown[];
  if (!isId(path, LIMITS.fieldPathLength) || !isBoundedJson(v) || !isHlc(hlc) || !isId(opId)) {
    throw new Error('Store data has an invalid field');
  }
  return [path, { value: v, hlc, opId }];
}

function parseWrite(value: unknown): RecipeWrite {
  if (!isRecord(value) || !isId(value.opId) || !isHlc(value.hlc) || !isRecord(value.fields)) {
    throw new Error('Store data has an invalid history entry');
  }
  const fields: Record<string, Json> = {};
  for (const [path, v] of Object.entries(value.fields)) {
    if (!isId(path, LIMITS.fieldPathLength) || !isBoundedJson(v)) throw new Error('Store data has an invalid history entry');
    fields[path] = v;
  }
  let step: OpStep | null = null;
  if (value.step !== null) {
    const s = value.step;
    if (!isRecord(s) || !isId(s.id) || typeof s.label !== 'string') throw new Error('Store data has an invalid step');
    const parsed: { id: string; label: string; undoes?: string; redoes?: string } = { id: s.id, label: s.label };
    if (isId(s.undoes)) parsed.undoes = s.undoes;
    if (isId(s.redoes)) parsed.redoes = s.redoes;
    step = parsed;
  }
  return { opId: value.opId, hlc: value.hlc, step, fields };
}
