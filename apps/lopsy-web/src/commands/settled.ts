import { CommandError } from './command';
import { engineStarted } from '../engine-wasm/engine-state';
import { parkedReadbackCount } from '../engine-wasm/wasm-bridge';
import { isLoopRunning, nextLoopPass } from '../app/rendering/frame-clock';

export interface SettleDeps<TimerHandle> {
  engineStarted(): Promise<unknown>;
  isLoopRunning(): boolean;
  nextLoopPass(): Promise<boolean>;
  parkedReadbackCount(): number;
  setTimer(callback: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  isDocumentHidden(): boolean;
  readonly timeoutMs?: number;
}

type SettleStage = 'engine' | 'loop' | 'idle';

const DEFAULT_TIMEOUT_MS = 10_000;
const LOOP_POLL_MS = 16;

const STAGE_DESCRIPTIONS: Record<SettleStage, string> = {
  engine: 'the engine to start',
  loop: 'the render loop to start (the canvas mounts once a document is open)',
  idle: 'the engine to go idle (every change rendered and no GPU readback outstanding)',
};

function timeoutError(stage: SettleStage, timeoutMs: number, isHidden: boolean): CommandError {
  const hiddenHint = isHidden
    ? ' The page is a background tab, and browsers pause animation frames there: make it the visible tab.'
    : '';
  return new CommandError(
    'unavailable',
    `Timed out after ${timeoutMs} ms waiting for ${STAGE_DESCRIPTIONS[stage]}.${hiddenHint}`,
  );
}

/**
 * Resolves once every change made before the call has been rendered and a
 * later pass of the render loop found nothing to render and no readback out.
 * It only waits: finalizing a stroke or anything else that changes the
 * document is the command's job, not settle's.
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
        while (!isDone) {
          const rendered = await deps.nextLoopPass();
          if (!rendered && deps.parkedReadbackCount() === 0) return;
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
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle),
  isDocumentHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
});
