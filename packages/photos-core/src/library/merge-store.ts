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
import { DEFAULT_RECIPE, recipeToPaths } from './recipe';
import type { EntityKind, Json, OpEnvelope, OpStep } from './types';
import { isBoundedJson, isEntityKind, isRecord, isSafePath, LIMITS } from './validate';

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

const DEFAULT_LEAVES: ReadonlyMap<string, unknown> = new Map(Object.entries(recipeToPaths(DEFAULT_RECIPE)));

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

/** Index into `SerializedStore.stamps`. */
export type StampRef = number;
/** The fields one op set on an entity, sharing that op's stamp. */
export type SerializedWrite = [stamp: StampRef, fields: Readonly<Record<string, Json>>];
export type SerializedMember = [member: string, present: boolean, stamp: StampRef];

export interface SerializedEntity {
  readonly kind: EntityKind;
  readonly id: string;
  readonly writes: readonly SerializedWrite[];
  readonly sets: readonly [set: string, members: readonly SerializedMember[]][];
}

export interface SerializedHistory {
  readonly versionId: string;
  readonly base: readonly SerializedWrite[];
  readonly entries: readonly [stamp: StampRef, step: OpStep | null, fields: Readonly<Record<string, Json>>][];
}

/**
 * The whole store as plain data: snapshots and the device's saved state.
 * Each op's stamp (`<hlc> <opId>`) is stored once and referenced by index,
 * and the fields one op wrote are grouped, which keeps a 50,000-photo
 * library to a size that can be written and parsed (spec 11).
 */
export interface SerializedStore {
  readonly format: 2;
  readonly maxHlc: string | null;
  readonly stamps: readonly string[];
  readonly entities: readonly SerializedEntity[];
  readonly history: readonly SerializedHistory[];
}

class StampTable {
  readonly stamps: string[] = [];
  private readonly index = new Map<string, number>();
  ref(hlc: string, opId: string): StampRef {
    let i = this.index.get(opId);
    if (i === undefined) {
      i = this.stamps.length;
      this.stamps.push(`${hlc} ${opId}`);
      this.index.set(opId, i);
    }
    return i;
  }
}

function groupByStamp(table: StampTable, registers: Iterable<[string, Register]>): SerializedWrite[] {
  const groups = new Map<StampRef, Record<string, Json>>();
  for (const [path, r] of registers) {
    const ref = table.ref(r.hlc, r.opId);
    let fields = groups.get(ref);
    if (!fields) {
      fields = {};
      groups.set(ref, fields);
    }
    fields[path] = r.value;
  }
  return [...groups];
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
    const table = new StampTable();
    const entities: SerializedEntity[] = [];
    for (const [kind, byId] of this.records) {
      for (const [id, record] of byId) {
        entities.push({
          kind,
          id,
          writes: groupByStamp(table, record.fields),
          sets: [...record.sets].map(([set, members]) => [
            set,
            [...members].map(([member, r]): SerializedMember => [member, r.present, table.ref(r.hlc, r.opId)]),
          ]),
        });
      }
    }
    const history: SerializedHistory[] = [];
    for (const [versionId, h] of this.histories) {
      history.push({
        versionId,
        base: groupByStamp(table, h.base),
        entries: h.entries.map((w) => [table.ref(w.hlc, w.opId), w.step, w.fields]),
      });
    }
    return { format: 2, maxHlc: this.latest, stamps: table.stamps, entities, history };
  }

  /** Rebuilds a store from `serialize()` output; throws on anything malformed. */
  static deserialize(data: unknown): MergeStore {
    if (!isRecord(data) || data.format !== 2) throw new Error('Store data has an unknown format');
    const store = new MergeStore();
    if (data.maxHlc !== null && !isHlc(data.maxHlc)) throw new Error('Store data has an invalid maxHlc');
    store.latest = data.maxHlc;
    if (!Array.isArray(data.stamps) || !Array.isArray(data.entities) || !Array.isArray(data.history)) {
      throw new Error('Store data is incomplete');
    }
    const stamps: { hlc: string; opId: string }[] = [];
    for (const text of data.stamps as unknown[]) {
      const space = typeof text === 'string' ? text.indexOf(' ') : -1;
      const hlc = space > 0 ? (text as string).slice(0, space) : '';
      const opId = space > 0 ? (text as string).slice(space + 1) : '';
      if (!isHlc(hlc) || !isId(opId)) throw new Error('Store data has an invalid stamp');
      stamps.push({ hlc, opId });
    }
    const stamp = (ref: unknown) => {
      const s = typeof ref === 'number' ? stamps[ref] : undefined;
      if (!s) throw new Error('Store data has an invalid stamp reference');
      return s;
    };
    const writes = (raw: unknown, into: Map<string, Register>) => {
      if (!Array.isArray(raw)) throw new Error('Store data has invalid fields');
      for (const w of raw as unknown[]) {
        if (!Array.isArray(w) || w.length !== 2 || !isRecord(w[1])) throw new Error('Store data has invalid fields');
        const { hlc, opId } = stamp(w[0]);
        for (const [path, value] of Object.entries(w[1])) {
          if (!isFieldPath(path) || !isBoundedJson(value)) throw new Error('Store data has an invalid field');
          into.set(path, { value, hlc, opId });
        }
      }
    };
    for (const raw of data.entities as unknown[]) {
      if (!isRecord(raw) || !isEntityKind(raw.kind) || !isId(raw.id) || !Array.isArray(raw.sets)) {
        throw new Error('Store data has an invalid entity');
      }
      const record = store.record(raw.kind, raw.id);
      writes(raw.writes, record.fields);
      for (const s of raw.sets as unknown[]) {
        if (!Array.isArray(s) || s.length !== 2 || !isId(s[0], LIMITS.setNameLength) || !Array.isArray(s[1])) {
          throw new Error('Store data has an invalid set');
        }
        const members = new Map<string, MemberRegister>();
        for (const m of s[1] as unknown[]) {
          if (!Array.isArray(m) || m.length !== 3) throw new Error('Store data has an invalid member');
          const [member, present, ref] = m as unknown[];
          if (!isId(member, LIMITS.memberLength) || typeof present !== 'boolean') {
            throw new Error('Store data has an invalid member');
          }
          const { hlc, opId } = stamp(ref);
          members.set(member, { present, hlc, opId });
        }
        record.sets.set(s[0], members);
      }
    }
    for (const raw of data.history as unknown[]) {
      if (!isRecord(raw) || !isId(raw.versionId) || !Array.isArray(raw.entries)) {
        throw new Error('Store data has an invalid history');
      }
      const h = store.history(raw.versionId);
      writes(raw.base, h.base);
      for (const e of raw.entries as unknown[]) {
        if (!Array.isArray(e) || e.length !== 3) throw new Error('Store data has an invalid history entry');
        const { hlc, opId } = stamp(e[0]);
        const write = parseWrite(hlc, opId, e[1], e[2]);
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
      if (!path.startsWith(RECIPE_PREFIX)) continue;
      const leaf = path.slice(RECIPE_PREFIX.length);
      // A write outside any step (creating a version) only matters to undo where it differs from the
      // default, which undo falls back to; skipping the rest keeps 50,000 fresh versions' logs empty.
      if (!env.step && DEFAULT_LEAVES.get(leaf) === value) continue;
      recipe[leaf] = value;
      any = true;
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

function isFieldPath(value: unknown): value is string {
  return isId(value, LIMITS.fieldPathLength) && isSafePath(value);
}

function parseWrite(hlc: string, opId: string, rawStep: unknown, rawFields: unknown): RecipeWrite {
  if (!isRecord(rawFields)) throw new Error('Store data has an invalid history entry');
  const fields: Record<string, Json> = {};
  for (const [path, v] of Object.entries(rawFields)) {
    if (!isFieldPath(path) || !isBoundedJson(v)) throw new Error('Store data has an invalid history entry');
    fields[path] = v;
  }
  let step: OpStep | null = null;
  if (rawStep !== null) {
    const s = rawStep;
    if (!isRecord(s) || !isId(s.id) || typeof s.label !== 'string') throw new Error('Store data has an invalid step');
    const parsed: { id: string; label: string; undoes?: string; redoes?: string } = { id: s.id, label: s.label };
    if (isId(s.undoes)) parsed.undoes = s.undoes;
    if (isId(s.redoes)) parsed.redoes = s.redoes;
    step = parsed;
  }
  return { opId, hlc, step, fields };
}
