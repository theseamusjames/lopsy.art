/**
 * What an import says to a screen reader, without reading every file out:
 * when it starts, at each quarter of the way, and when it ends (polite);
 * failures once when the first one happens and again at the end
 * (assertive). Pure: the strip feeds it the numbers it shows. Its words
 * differ from the strip's own, which stay on screen to be read there.
 *
 * A clean end (`endedCleanly`) is not said here: the strip goes, and its
 * outcome is a toast, which the toasts' own live region says. Saying it
 * here as well would say it twice.
 */

import { endedCleanly, type ImportEnd } from '../../import/import-progress';
import { plural } from '../../import/import-summary';

export interface ImportFacts extends ImportEnd {
  readonly total: number;
  /** Items that have stopped moving, whatever the outcome. */
  readonly settled: number;
  /** 0..1, as the progress bar shows it. */
  readonly fraction: number;
  /** Photos added (a RAW+JPEG pair counts once). */
  readonly added: number;
  /** Files skipped as already in the library. */
  readonly skipped: number;
}

export interface Announced {
  /** The last quarter said (0 at the start, 4 at the end). */
  readonly quarter: number;
  readonly finished: boolean;
  readonly failed: number;
  readonly polite: string;
  readonly alert: string;
}

function quarterOf(fraction: number): number {
  return Math.max(0, Math.min(4, Math.floor(fraction * 4)));
}

function failures(n: number): string {
  return `Import problem: ${plural(n, 'photo')} failed`;
}

/** How the import ended, or '' for a clean end, which the toast says. */
function outcome(facts: ImportFacts): string {
  if (endedCleanly(facts)) return '';
  if (facts.paused > 0) return `Import paused with ${plural(facts.paused, 'photo')} to go`;
  const added = `Import done: ${plural(facts.added, 'photo')} added`;
  if (facts.waiting > 0) return `${added}, ${facts.waiting.toLocaleString('en-US')} to try again`;
  return facts.skipped > 0 ? `${added}, ${facts.skipped.toLocaleString('en-US')} skipped as already in the library` : added;
}

/** What to say now, given what was said before for this import (null: it just started). */
export function announceImport(before: Announced | null, facts: ImportFacts): Announced {
  const quarter = facts.finished ? 4 : quarterOf(facts.fraction);
  if (before === null) {
    return {
      quarter,
      finished: facts.finished,
      failed: facts.failed,
      polite: facts.finished ? outcome(facts) : `Import started: ${plural(facts.total, 'photo')}`,
      alert: facts.failed > 0 ? failures(facts.failed) : '',
    };
  }
  if (before.finished) return before;
  if (facts.finished) {
    return {
      quarter,
      finished: true,
      failed: facts.failed,
      polite: outcome(facts),
      alert: facts.failed > before.failed ? failures(facts.failed) : before.alert,
    };
  }
  const firstFailure = before.failed === 0 && facts.failed > 0;
  if (quarter <= before.quarter && !firstFailure) return before;
  return {
    quarter: Math.max(quarter, before.quarter),
    finished: false,
    failed: firstFailure ? facts.failed : before.failed,
    polite:
      quarter > before.quarter
        ? `Import ${quarter * 25} % done: ${facts.settled.toLocaleString('en-US')} of ${plural(facts.total, 'photo')}`
        : before.polite,
    alert: firstFailure ? failures(facts.failed) : before.alert,
  };
}
