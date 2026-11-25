import { describe, expect, it } from 'vitest';
import { createReadbackQueue, EngineGoneError, type PendingReadback } from './readback-order';

interface FakeEngine {
  isFreed: boolean;
  /** What each parked task answers when resumed. */
  answers: Map<number, unknown>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const engine: FakeEngine = { isFreed: false, answers: new Map() };
  const queue = createReadbackQueue<FakeEngine>(
    (e, task) => e.answers.get(task),
    (e) => e.isFreed,
    (run) => queueMicrotask(run),
  );
  let nextTask = 1;
  const park = (answer: unknown): { pending: PendingReadback; answer: () => void } => {
    const ready = deferred();
    const task = nextTask++;
    engine.answers.set(task, answer);
    return { pending: { lopsyTask: task, ready: ready.promise }, answer: ready.resolve };
  };
  return { engine, queue, park };
}

describe('createReadbackQueue', () => {
  it('answers a read that does not park at once, as WebGL does', async () => {
    const { engine, queue } = setup();
    const read = queue.asyncReadback((_e: FakeEngine, x: number) => x * 2);
    expect(await read(engine, 21)).toBe(42);
    expect(queue.parkedCount()).toBe(0);
  });

  it('rejects when the read throws', async () => {
    const { engine, queue } = setup();
    const read = queue.asyncReadback((_e: FakeEngine): number => {
      throw new Error('no pixels');
    });
    await expect(read(engine)).rejects.toThrow('no pixels');
  });

  it('waits out a parked read and resumes it', async () => {
    const { engine, queue, park } = setup();
    const parked = park('pixels');
    const read = queue.asyncReadback((_e: FakeEngine): unknown => parked.pending);
    const answer = read(engine);
    expect(queue.parkedCount()).toBeGreaterThan(0);
    parked.answer();
    expect(await answer).toBe('pixels');
  });

  it('issues an in-turn read only after the one before has answered', async () => {
    const { engine, queue, park } = setup();
    const issued: string[] = [];
    const first = park('first');
    const readFirst = queue.asyncReadback((_e: FakeEngine): unknown => {
      issued.push('first');
      return first.pending;
    });
    const readSecond = queue.asyncReadback((_e: FakeEngine): unknown => {
      issued.push('second');
      return 'second';
    });
    const a = readFirst(engine);
    const b = readSecond(engine);
    await Promise.resolve();
    expect(issued).toEqual(['first']);
    first.answer();
    expect(await a).toBe('first');
    expect(await b).toBe('second');
    expect(issued).toEqual(['first', 'second']);
  });

  it('does not hold an any-time read behind an in-turn one', async () => {
    const { engine, queue, park } = setup();
    const first = park('first');
    const readFirst = queue.asyncReadback((_e: FakeEngine): unknown => first.pending);
    const sample = queue.asyncReadback((_e: FakeEngine): unknown => 'sample', 'any-time');
    const a = readFirst(engine);
    expect(await sample(engine)).toBe('sample');
    first.answer();
    expect(await a).toBe('first');
  });

  it('fails a parked read whose engine was freed meanwhile', async () => {
    const { engine, queue, park } = setup();
    const parked = park('pixels');
    const read = queue.asyncReadback((_e: FakeEngine): unknown => parked.pending);
    const answer = read(engine);
    engine.isFreed = true;
    parked.answer();
    await expect(answer).rejects.toBeInstanceOf(EngineGoneError);
  });
});
