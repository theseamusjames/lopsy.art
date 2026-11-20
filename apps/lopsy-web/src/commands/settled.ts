import { CommandError, SettleTimeoutError } from './command';
import { engineStarted, isGpuContextLost } from '../engine-wasm/engine-state';
import { parkedReadbackCount } from '../engine-wasm/wasm-bridge';
import { isLoopRunning, nextLoopPass } from '../app/rendering/frame-clock';
import { pendingDeferredCropCount } from '../app/deferred-crop-on-switch';

export interface SettleDeps<TimerHandle> {
  engineStarted(): Promise<unknown>;
  isLoopRunning(): boolean;
  nextLoopPass(): Promise<boolean>;
  parkedReadbackCount(): number;
  /** Layer crops a layer switch scheduled for an idle moment that have not run yet. */
  pendingDeferredCropCount(): number;
  isGpuContextLost(): boolean;
  setTimer(callback: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  isDocumentHidden(): boolean;
  readonly timeoutMs?: number;
}

type SettleStage = 'engine' | 'loop' | 'idle';

const DEFAULT_TIMEOUT_MS = 10_000;
const LOOP_POLL_MS = 16;
/**
 * Passes in a row that rendered with nothing outstanding after which the
 * engine counts as settled: something (a pointer over the canvas) keeps
 * marking it dirty every frame, but every change made before the call has
 * been drawn long since.
 */
export const BUSY_PASS_LIMIT = 30;

const STAGE_DESCRIPTIONS: Record<SettleStage, string> = {
  engine: 'the engine to start',
  loop: 'the render loop to start (the canvas mounts once a document is open)',
  idle: 'the engine to go idle (every change rendered and no GPU readback outstanding)',
};

function timeoutError(stage: SettleStage, timeoutMs: number, isHidden: boolean): SettleTimeoutError {
  const hiddenHint = isHidden
    ? 'The page is a background tab, and browsers pause animation frames there: make it the visible tab.'
    : '';
  return new SettleTimeoutError(timeoutMs, STAGE_DESCRIPTIONS[stage], hiddenHint);
}

export function contextLostError(): CommandError {
  return new CommandError('unavailable', 'The graphics context is lost; the editor is restoring it. Try again once the canvas is back.');
}

/** Whether something the engine owes is still on its way: a parked readback or a deferred layer crop. */
function isOutstanding<T>(deps: SettleDeps<T>): boolean {
  return deps.parkedReadbackCount() > 0 || deps.pendingDeferredCropCount() > 0;
}

/**
 * Resolves once every change made before the call has been rendered and a
 * later pass of the render loop found nothing to render, no readback out
 * and no deferred layer crop pending; or once BUSY_PASS_LIMIT passes in a
 * row rendered with nothing outstanding. Rejects `unavailable` while the
 * graphics context is lost, where a pass that renders nothing proves
 * nothing. It only waits: finalizing a stroke, running a deferred crop or
 * anything else that changes the document is the command's job, not settle's.
 */
export function createSettle<TimerHandle>(deps: SettleDeps<TimerHandle>): () => Promise<void> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return () =>
    new Promise<void>((resolve, reject) => {
      let stage: SettleStage = 'engine';
      let isDone = false;
      let pollTimer: TimerHandle | null = null;

      const stop = (): boolean => {
        if (isDone) return false;
        isDone = true;
        deps.clearTimer(timeoutTimer);
        if (pollTimer !== null) deps.clearTimer(pollTimer);
        pollTimer = null;
        return true;
      };
      const succeed = (): void => {
        if (stop()) resolve();
      };
      const fail = (error: unknown): void => {
        if (stop()) reject(error);
      };

      const timeoutTimer = deps.setTimer(
        () => fail(timeoutError(stage, timeoutMs, deps.isDocumentHidden())),
        timeoutMs,
      );

      const waitForLoop = (): Promise<void> =>
        new Promise((loopRunning) => {
          const poll = (): void => {
            pollTimer = null;
            if (isDone || deps.isLoopRunning()) {
              loopRunning();
              return;
            }
            pollTimer = deps.setTimer(poll, LOOP_POLL_MS);
          };
          poll();
        });

      const settle = async (): Promise<void> => {
        await deps.engineStarted();
        if (isDone) return;
        if (!deps.isLoopRunning()) {
          stage = 'loop';
          await waitForLoop();
          if (isDone) return;
          // The canvas starts its engine as it mounts, after the first look found none.
          stage = 'engine';
          await deps.engineStarted();
        }
        stage = 'idle';
        await waitForIdle();
      };

      const waitForIdle = async (): Promise<void> => {
        let busyPasses = 0;
        while (!isDone) {
          if (deps.isGpuContextLost()) throw contextLostError();
          const rendered = await deps.nextLoopPass();
          if (isDone) return;
          if (deps.isGpuContextLost()) throw contextLostError();
          if (isOutstanding(deps)) {
            busyPasses = 0;
            continue;
          }
          if (!rendered) return;
          busyPasses++;
          if (busyPasses >= BUSY_PASS_LIMIT) return;
        }
      };

      settle().then(succeed, fail);
    });
}

export const settled = createSettle<ReturnType<typeof setTimeout>>({
  engineStarted,
  isLoopRunning,
  nextLoopPass,
  parkedReadbackCount,
  pendingDeferredCropCount,
  isGpuContextLost,
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle),
  isDocumentHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
});
