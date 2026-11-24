/**
 * Readbacks as Promises, in order. Lopsy's bridge (`wasm-bridge.ts`) and
 * Photonamous' (`apps/photonamous/src/engine/wasm.ts`) both read through
 * this, so the two apps keep the same guarantees on the wgpu build. Pure:
 * the engine's `resumeTask` and a test for a freed engine are passed in.
 */

/**
 * What a wgpu export answers with while its readback is still out: the
 * command is parked in the engine under `lopsyTask` until `ready` resolves.
 */
export interface PendingReadback {
  lopsyTask: number;
  ready: Promise<void>;
}

export function isPendingReadback(value: unknown): value is PendingReadback {
  return typeof value === 'object' && value !== null && 'lopsyTask' in value;
}

/**
 * A readback whose engine was destroyed while it was out: after a lost
 * WebGPU device, or when the canvas unmounts. Its pixels no longer exist.
 */
export class EngineGoneError extends Error {
  constructor() {
    super('The engine was destroyed while a readback was out');
    this.name = 'EngineGoneError';
  }
}

/**
 * `'in-turn'`: waits for every in-turn read issued before it, and for its
 * caller to act on it. `'any-time'`: for reads nothing is changed by.
 */
export type ReadbackOrder = 'in-turn' | 'any-time';

export interface ReadbackQueue<E> {
  /**
   * Makes a function that reads pixels back from the GPU answer with a
   * Promise. WebGPU cannot read back synchronously: there the engine
   * answers with a parked command, which this waits out. On WebGL the read
   * has already happened and the Promise is resolved (or rejected, if the
   * read threw) on return.
   *
   * `order` matters only while a readback is out, so only on wgpu. A
   * caller usually changes the document with what it read: the crop of a
   * layer left behind, a flip, a fill. On WebGL nothing can come between
   * such a read and the change that follows it. So an `'in-turn'` read
   * issued while another is out waits for that one to answer and for its
   * caller to act on it, and then reads what that left. `'any-time'` is
   * for reads nothing is changed by, which need not wait and are not
   * waited for: thumbnails, the eyedropper.
   */
  asyncReadback<Args extends [E, ...unknown[]], Result>(
    read: (...args: Args) => Result,
    order?: ReadbackOrder,
  ): (...args: Args) => Promise<Result>;
  /**
   * How many readbacks are out: commands the engine has parked until their
   * pixels arrive, plus one while in-turn reads are waiting their turn or
   * a caller has yet to act on one that just answered. Always 0 on WebGL.
   */
  parkedCount(): number;
}

/** The task scheduler the turn passes on; a test replaces it. */
export type NextTask = (run: () => void) => void;

const nextTask: NextTask = (run) => {
  setTimeout(run, 0);
};

function noop(): void {}

export function createReadbackQueue<E>(
  resume: (engine: E, task: number) => unknown,
  isGone: (engine: E) => boolean,
  schedule: NextTask = nextTask,
): ReadbackQueue<E> {
  let parked = 0;
  /**
   * Settles when every in-turn readback issued so far has answered and
   * what awaited it has run; null when none is out.
   */
  let turn: Promise<unknown> | null = null;

  /**
   * Wait for a parked command's readback, resume it, and repeat until it
   * answers with its value. A command with several readbacks parks once
   * for each.
   */
  async function finish<Result>(engine: E, pending: PendingReadback): Promise<Result> {
    parked++;
    try {
      let step: unknown = pending;
      while (isPendingReadback(step)) {
        await step.ready;
        if (isGone(engine)) throw new EngineGoneError();
        step = resume(engine, step.lopsyTask);
      }
      return step as Result;
    } finally {
      parked--;
    }
  }

  /**
   * The turn passes a task after `until` settles, not in the same one: the
   * caller that awaited the readback acts on it some microtasks later, and
   * the next read must come after that.
   */
  function holdTurn(until: Promise<unknown>): void {
    const mine: Promise<void> = until
      .then(noop, noop)
      .then(() => new Promise<void>((resolve) => schedule(resolve)))
      .then(() => {
        if (turn === mine) turn = null;
      });
    turn = mine;
  }

  return {
    asyncReadback<Args extends [E, ...unknown[]], Result>(
      read: (...args: Args) => Result,
      order: ReadbackOrder = 'in-turn',
    ): (...args: Args) => Promise<Result> {
      return (...args: Args): Promise<Result> => {
        const issue = (): { answer: Promise<Result>; isParked: boolean } => {
          try {
            const value: unknown = read(...args);
            if (isPendingReadback(value)) return { answer: finish<Result>(args[0], value), isParked: true };
            return { answer: Promise.resolve(value as Result), isParked: false };
          } catch (err) {
            return { answer: Promise.reject(err), isParked: false };
          }
        };
        if (order === 'any-time') return issue().answer;
        if (turn === null) {
          const issued = issue();
          if (issued.isParked) holdTurn(issued.answer);
          return issued.answer;
        }
        const answer = turn.then(() => issue().answer);
        holdTurn(answer);
        return answer;
      };
    },
    parkedCount(): number {
      return parked + (turn === null ? 0 : 1);
    },
  };
}
