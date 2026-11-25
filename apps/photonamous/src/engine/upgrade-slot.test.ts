import { describe, expect, it } from 'vitest';
import { UpgradeSlot } from './upgrade-slot';

class AbortedError extends Error {}

/** A load that ends when told to, or rejects once aborted and told to end (as a decode notices its abort late). */
function controlledLoad(): { run: (signal: AbortSignal) => Promise<void>; finish: () => void; started: () => number } {
  let finish: () => void = () => undefined;
  let starts = 0;
  return {
    run: (signal) => {
      starts += 1;
      return new Promise<void>((resolve, reject) => {
        finish = () => (signal.aborted ? reject(new AbortedError()) : resolve());
      });
    },
    finish: () => finish(),
    started: () => starts,
  };
}

describe('UpgradeSlot', () => {
  it('shares the load under way', async () => {
    const slot = new UpgradeSlot();
    const load = controlledLoad();
    const first = slot.start(load.run, () => undefined);
    const second = slot.start(load.run, () => undefined);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(load.started()).toBe(1);
    load.finish();
    await first;
    expect(slot.isRunning()).toBe(false);
  });

  it('after a cancel, starts a new load instead of handing back the aborted one', async () => {
    const slot = new UpgradeSlot();
    const old = controlledLoad();
    const aborted = slot.start(old.run, () => undefined);
    aborted.catch(() => undefined);
    await Promise.resolve();
    slot.cancel();
    expect(slot.isRunning()).toBe(false);

    const fresh = controlledLoad();
    const next = slot.start(fresh.run, () => undefined);
    expect(next).not.toBe(aborted);
    // The aborted load ends late: it must not empty the slot the new one holds.
    old.finish();
    await expect(aborted).rejects.toBeInstanceOf(AbortedError);
    expect(slot.isRunning()).toBe(true);
    expect(slot.start(fresh.run, () => undefined)).toBe(next);
    fresh.finish();
    await expect(next).resolves.toBeUndefined();
    expect(slot.isRunning()).toBe(false);
  });

  it('empties the slot when a load throws before its first await', async () => {
    const slot = new UpgradeSlot();
    let settled = 0;
    const failing = slot.start(() => {
      throw new Error('no source');
    }, () => {
      settled += 1;
    });
    await expect(failing).rejects.toThrow('no source');
    expect(slot.isRunning()).toBe(false);
    expect(settled).toBe(1);
  });
});
