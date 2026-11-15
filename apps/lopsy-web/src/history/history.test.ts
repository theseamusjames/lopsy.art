import { describe, it, expect } from 'vitest';
import { HistoryManager } from './history';

describe('HistoryManager', () => {
  it('starts with initial state', () => {
    const hm = new HistoryManager('initial');
    expect(hm.getCurrentState()).toBe('initial');
    expect(hm.canUndo()).toBe(false);
    expect(hm.canRedo()).toBe(false);
  });

  it('push/undo/redo cycle works', () => {
    const hm = new HistoryManager('a');
    hm.push('b', 'step 1');
    hm.push('c', 'step 2');

    expect(hm.getCurrentState()).toBe('c');
    expect(hm.canUndo()).toBe(true);

    const undone = hm.undo();
    expect(undone).toBe('b');
    expect(hm.getCurrentState()).toBe('b');
    expect(hm.canRedo()).toBe(true);

    const redone = hm.redo();
    expect(redone).toBe('c');
    expect(hm.getCurrentState()).toBe('c');
  });

  it('push after undo discards forward history', () => {
    const hm = new HistoryManager('a');
    hm.push('b', 'step 1');
    hm.push('c', 'step 2');

    hm.undo(); // back to 'b'
    hm.push('d', 'step 3'); // replaces 'c'

    expect(hm.getCurrentState()).toBe('d');
    expect(hm.canRedo()).toBe(false);
  });

  it('respects max entries', () => {
    const hm = new HistoryManager(0, 5);
    for (let i = 1; i <= 10; i++) {
      hm.push(i, `step ${i}`);
    }
    // Should only have 5 entries
    expect(hm.getEntries().length).toBe(5);
    // Can undo 4 times (5 entries, current is last)
    let count = 0;
    while (hm.canUndo()) {
      hm.undo();
      count++;
    }
    expect(count).toBe(4);
  });

  it('undo returns null when at beginning', () => {
    const hm = new HistoryManager('x');
    expect(hm.undo()).toBe(null);
  });

  it('redo returns null when at end', () => {
    const hm = new HistoryManager('x');
    expect(hm.redo()).toBe(null);
  });

  it('clear resets everything', () => {
    const hm = new HistoryManager('a');
    hm.push('b', 'step');
    hm.push('c', 'step');
    hm.clear('fresh');

    expect(hm.getCurrentState()).toBe('fresh');
    expect(hm.canUndo()).toBe(false);
    expect(hm.canRedo()).toBe(false);
    expect(hm.getEntries().length).toBe(1);
  });

  it('snapshots save and restore', () => {
    const hm = new HistoryManager('a');
    hm.push('b', 'step');
    hm.createSnapshot('my-snapshot');
    hm.push('c', 'step');

    expect(hm.restoreSnapshot('my-snapshot')).toBe('b');
    expect(hm.restoreSnapshot('nonexistent')).toBe(null);
  });
});
