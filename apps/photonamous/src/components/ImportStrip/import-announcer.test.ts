import { describe, expect, it } from 'vitest';
import { announceImport, type Announced, type ImportFacts } from './import-announcer';

const NONE = { failed: 0, added: 0, skipped: 0, waiting: 0, paused: 0, needsSignIn: false };

const running = (settled: number, fraction: number, failed = 0): ImportFacts => ({
  ...NONE,
  total: 120,
  settled,
  fraction,
  finished: false,
  failed,
});

const ended = (facts: Partial<ImportFacts>): ImportFacts => ({ ...NONE, total: 120, settled: 120, fraction: 1, finished: true, ...facts });

/** Feeds progress updates in order and lists what was said politely and assertively, without repeats. */
function said(updates: readonly ImportFacts[]): { polite: string[]; alert: string[] } {
  let state: Announced | null = null;
  const polite: string[] = [];
  const alert: string[] = [];
  for (const facts of updates) {
    state = announceImport(state, facts);
    if (state.polite !== '' && polite[polite.length - 1] !== state.polite) polite.push(state.polite);
    if (state.alert !== '' && alert[alert.length - 1] !== state.alert) alert.push(state.alert);
  }
  return { polite, alert };
}

describe('announceImport', () => {
  it('says the start and each quarter, not every file', () => {
    const updates: ImportFacts[] = [];
    for (let i = 0; i <= 119; i++) updates.push(running(i, i / 120));
    expect(said(updates).polite).toEqual([
      'Import started: 120 photos',
      'Import 25 % done: 30 of 120 photos',
      'Import 50 % done: 60 of 120 photos',
      'Import 75 % done: 90 of 120 photos',
    ]);
    expect(said(updates).alert).toEqual([]);
  });

  it('leaves a clean end to the toast that shows it, so it is heard once', () => {
    let state: Announced | null = null;
    for (let i = 0; i <= 119; i++) state = announceImport(state, running(i, i / 120));
    const end = announceImport(state, ended({ added: 118, skipped: 2 }));
    expect(end).toMatchObject({ finished: true, polite: '', alert: '' });
    // Every photo already in the library is a clean end too.
    expect(announceImport(state, ended({ skipped: 120 })).polite).toBe('');
  });

  it('says a failure at once, then only again at the end if more failed', () => {
    const updates = [running(0, 0), running(10, 0.1, 1), running(20, 0.2, 2), running(40, 0.3, 3), ended({ failed: 4, added: 116 })];
    const out = said(updates);
    expect(out.alert).toEqual(['Import problem: 1 photo failed', 'Import problem: 4 photos failed']);
    expect(out.polite).toEqual(['Import started: 120 photos', 'Import 25 % done: 40 of 120 photos', 'Import done: 116 photos added']);
  });

  it('says a pause, and photos left to try again', () => {
    expect(said([running(0, 0), ended({ paused: 30, added: 90 })]).polite).toEqual([
      'Import started: 120 photos',
      'Import paused with 30 photos to go',
    ]);
    expect(said([running(0, 0), ended({ waiting: 1, added: 119 })]).polite.at(-1)).toBe('Import done: 119 photos added, 1 to try again');
  });

  it('says only the outcome of an import that is already over, unless it ended cleanly', () => {
    const failed = ended({ total: 3, settled: 3, added: 2, failed: 1 });
    expect(said([failed, failed])).toEqual({ polite: ['Import done: 2 photos added'], alert: ['Import problem: 1 photo failed'] });
    const clean = ended({ total: 3, settled: 3, added: 3 });
    expect(said([clean, clean])).toEqual({ polite: [], alert: [] });
  });

  it('keeps quiet when the bytes go back a little', () => {
    expect(said([running(0, 0), running(40, 0.3), running(41, 0.24), running(42, 0.31)]).polite).toEqual([
      'Import started: 120 photos',
      'Import 25 % done: 40 of 120 photos',
    ]);
  });

  it('says a wait for sign-in once, and once that it is over', () => {
    const waiting = (settled: number): ImportFacts => ({ ...running(settled, settled / 120), needsSignIn: true });
    expect(said([running(0, 0), running(20, 0.17), waiting(20), waiting(20), waiting(20), running(21, 0.18), running(40, 0.34)]).polite).toEqual([
      'Import started: 120 photos',
      'Import paused: reconnect to Google Drive to continue',
      'Import continuing',
      'Import 25 % done: 40 of 120 photos',
    ]);
  });
});
