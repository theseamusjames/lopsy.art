/**
 * Hybrid logical clock (spec 6.6). A stamp is wall time in milliseconds, a
 * counter and the device ID, encoded fixed-width so that plain string
 * comparison orders stamps: `<15-digit wall>-<5-digit counter>-<device>`.
 */

import { isDeviceId } from './ids';

const WALL_DIGITS = 15;
const COUNTER_DIGITS = 5;
const MAX_WALL = 10 ** WALL_DIGITS - 1;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;
const PREFIX_LENGTH = WALL_DIGITS + 1 + COUNTER_DIGITS + 1;

export interface HlcStamp {
  readonly wall: number;
  readonly counter: number;
  readonly device: string;
}

export function encodeHlc(stamp: HlcStamp): string {
  return `${String(stamp.wall).padStart(WALL_DIGITS, '0')}-${String(stamp.counter).padStart(COUNTER_DIGITS, '0')}-${stamp.device}`;
}

/** null when the text is not a well-formed stamp. */
export function parseHlc(text: unknown): HlcStamp | null {
  if (typeof text !== 'string' || text.length <= PREFIX_LENGTH) return null;
  if (text[WALL_DIGITS] !== '-' || text[PREFIX_LENGTH - 1] !== '-') return null;
  const wallText = text.slice(0, WALL_DIGITS);
  const counterText = text.slice(WALL_DIGITS + 1, WALL_DIGITS + 1 + COUNTER_DIGITS);
  if (!/^\d+$/.test(wallText) || !/^\d+$/.test(counterText)) return null;
  const device = text.slice(PREFIX_LENGTH);
  if (!isDeviceId(device)) return null;
  return { wall: Number(wallText), counter: Number(counterText), device };
}

export function isHlc(text: unknown): text is string {
  return parseHlc(text) !== null;
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One device's clock. `now()` is strictly greater than every stamp it has
 * issued or received, even when the wall clock stalls or moves backwards.
 */
export class HybridClock {
  readonly device: string;
  private readonly physical: () => number;
  private wall = 0;
  private counter = 0;

  constructor(device: string, physical: () => number = Date.now) {
    if (!isDeviceId(device)) throw new Error(`Invalid device ID: ${device}`);
    this.device = device;
    this.physical = physical;
  }

  now(): string {
    const pt = Math.min(MAX_WALL, Math.max(0, Math.floor(this.physical())));
    if (pt > this.wall) {
      this.wall = pt;
      this.counter = 0;
    } else {
      this.bump();
    }
    return encodeHlc({ wall: this.wall, counter: this.counter, device: this.device });
  }

  /** Moves past a stamp seen from elsewhere; invalid stamps are ignored. */
  receive(remote: string): void {
    const r = parseHlc(remote);
    if (!r) return;
    if (r.wall > this.wall || (r.wall === this.wall && r.counter > this.counter)) {
      this.wall = r.wall;
      this.counter = r.counter;
    }
  }

  private bump(): void {
    if (this.counter < MAX_COUNTER) {
      this.counter += 1;
    } else {
      // The counter is fixed-width; borrowing a millisecond keeps stamps increasing.
      this.wall = Math.min(MAX_WALL, this.wall + 1);
      this.counter = 0;
    }
  }
}
