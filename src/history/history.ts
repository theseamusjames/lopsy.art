import type { HistoryEntry } from '../types';

export class HistoryManager<T> {
  private states: { state: T; entry: HistoryEntry }[] = [];
  private currentIndex = 0;
  private maxEntries: number;
  private snapshots = new Map<string, T>();

  constructor(initialState: T, maxEntries = 50) {
    this.maxEntries = maxEntries;
    this.states = [
      {
        state: initialState,
        entry: {
          id: crypto.randomUUID(),
          label: 'Initial',
          timestamp: Date.now(),
        },
      },
    ];
    this.currentIndex = 0;
  }

  push(state: T, label: string): void {
    // Discard any forward history
    this.states = this.states.slice(0, this.currentIndex + 1);

    this.states.push({
      state,
      entry: {
        id: crypto.randomUUID(),
        label,
        timestamp: Date.now(),
      },
    });

    // Drop oldest if over limit
    if (this.states.length > this.maxEntries) {
      this.states = this.states.slice(this.states.length - this.maxEntries);
    }

    this.currentIndex = this.states.length - 1;
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.currentIndex--;
    return this.states[this.currentIndex]?.state ?? null;
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.currentIndex++;
    return this.states[this.currentIndex]?.state ?? null;
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.states.length - 1;
  }

  getEntries(): HistoryEntry[] {
    return this.states.map((s) => s.entry);
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentState(): T {
    const current = this.states[this.currentIndex];
    if (!current) throw new Error('History is empty');
    return current.state;
  }

  clear(initialState: T): void {
    this.states = [
      {
        state: initialState,
        entry: {
          id: crypto.randomUUID(),
          label: 'Initial',
          timestamp: Date.now(),
        },
      },
    ];
    this.currentIndex = 0;
    this.snapshots.clear();
  }

  createSnapshot(name: string): void {
    this.snapshots.set(name, this.getCurrentState());
  }

  restoreSnapshot(name: string): T | null {
    return this.snapshots.get(name) ?? null;
  }
}
