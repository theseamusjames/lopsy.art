import { describe, it, expect } from 'vitest';
import { runInOrder } from './run-in-order';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve: () => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('runInOrder', () => {
  it('starts a task at once when nothing is running', () => {
    const run = runInOrder();
    let started = false;
    void run(async () => {
      started = true;
    });
    expect(started).toBe(true);
  });

  it('starts the second task only when the first has settled', async () => {
    const run = runInOrder();
    const first = deferred();
    const log: string[] = [];
    const a = run(async () => {
      log.push('a starts');
      await first.promise;
      log.push('a ends');
    });
    const b = run(async () => {
      log.push('b starts');
      return 'b';
    });
    await Promise.resolve();
    expect(log).toEqual(['a starts']);
    first.resolve();
    await a;
    expect(await b).toBe('b');
    expect(log).toEqual(['a starts', 'a ends', 'b starts']);
  });

  it('carries on after a task that rejects, and hands the rejection to its caller', async () => {
    const run = runInOrder();
    const first = deferred();
    const a = run(() => first.promise);
    const b = run(async () => 'b');
    first.reject(new Error('a failed'));
    await expect(a).rejects.toThrow('a failed');
    expect(await b).toBe('b');
  });

  it('starts at once again when the queue has emptied', async () => {
    const run = runInOrder();
    await run(async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let started = false;
    void run(async () => {
      started = true;
    });
    expect(started).toBe(true);
  });
});
