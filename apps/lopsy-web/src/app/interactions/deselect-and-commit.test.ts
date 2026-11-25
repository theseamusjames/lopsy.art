import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('./gesture-session', () => ({ clearPersistentTransform: () => calls.push('clearPersistentTransform') }));
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => ({ clearSelection: () => calls.push('clearSelection') }) },
}));
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => ({ setTransform: (t: unknown) => calls.push(`setTransform(${String(t)})`) }) },
}));

const { deselectAndCommit } = await import('./deselect-and-commit');

describe('deselectAndCommit', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('runs the Cmd+D / Escape sequence in order', () => {
    deselectAndCommit();
    expect(calls).toEqual(['clearSelection', 'setTransform(null)', 'clearPersistentTransform']);
  });
});
