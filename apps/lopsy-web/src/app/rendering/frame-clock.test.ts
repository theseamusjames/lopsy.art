import { afterEach, describe, expect, it } from 'vitest';
import { isLoopRunning, loopStarted, loopStopped, nextLoopPass, notifyLoopPass } from './frame-clock';

function flush(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

describe('frame clock', () => {
  afterEach(() => {
    while (isLoopRunning()) loopStopped();
    notifyLoopPass(false);
  });

  it('resolves a waiter at the next pass with its rendered value', async () => {
    const pass = nextLoopPass();
    notifyLoopPass(true);
    await expect(pass).resolves.toBe(true);
  });

  it('resolves nothing before a pass', async () => {
    let isResolved = false;
    void nextLoopPass().then(() => {
      isResolved = true;
    });
    await flush();
    expect(isResolved).toBe(false);
    notifyLoopPass(false);
    await flush();
    expect(isResolved).toBe(true);
  });

  it('resolves every waiter of a pass, and only waiters added before it', async () => {
    const first = nextLoopPass();
    const second = nextLoopPass();
    notifyLoopPass(false);
    const later = nextLoopPass();
    notifyLoopPass(true);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    await expect(later).resolves.toBe(true);
  });

  it('does nothing when nobody waits', () => {
    expect(() => notifyLoopPass(true)).not.toThrow();
  });

  it('counts running loops, so an overlapping StrictMode remount stays running', () => {
    expect(isLoopRunning()).toBe(false);
    loopStarted();
    expect(isLoopRunning()).toBe(true);
    loopStarted();
    loopStopped();
    expect(isLoopRunning()).toBe(true);
    loopStopped();
    expect(isLoopRunning()).toBe(false);
    loopStopped();
    expect(isLoopRunning()).toBe(false);
  });
});
