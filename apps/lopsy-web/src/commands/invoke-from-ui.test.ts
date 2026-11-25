import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../app/notifications-store', () => toasts);

const frameClock = vi.hoisted(() => ({
  isLoopRunning: () => true,
  nextLoopPass: vi.fn(() => new Promise<boolean>(() => undefined)),
}));

vi.mock('../app/rendering/frame-clock', () => frameClock);
vi.mock('../engine-wasm/engine-state', () => ({
  engineStarted: () => Promise.resolve(null),
  isGpuContextLost: () => false,
}));

const { CommandError } = await import('./command');
const { defineCommand, runCommand, setPreflight, setSettle } = await import('./registry');
const { settled } = await import('./settled');
const { invokeFromUi, startFromUi } = await import('./invoke-from-ui');

const log: string[] = [];
let nextOutcome: () => unknown = () => undefined;

defineCommand({
  id: 'test.ui-sync',
  summary: 'Records that it ran.',
  surface: 'ui',
  params: { tag: { type: 'string', default: 'ran' } },
  run({ tag }) {
    log.push(tag);
    return nextOutcome();
  },
});

function refusal(notice: 'info' | 'error' | null): InstanceType<typeof CommandError> {
  return new CommandError('refused', `refused with ${String(notice)}`, { notice });
}

function throwing(error: unknown): () => never {
  return () => {
    throw error;
  };
}

beforeEach(() => {
  log.length = 0;
  nextOutcome = () => undefined;
  toasts.notifyInfo.mockClear();
  toasts.notifyError.mockClear();
  setSettle(() => Promise.resolve());
});

afterEach(() => {
  setSettle(() => Promise.resolve());
});

describe('invokeFromUi', () => {
  it('runs the command in the caller\'s tick, with its params', () => {
    invokeFromUi('test.ui-sync', { tag: 'clicked' });
    expect(log).toEqual(['clicked']);
  });

  it('returns nothing to await and leaves no unhandled rejection on success', async () => {
    expect(invokeFromUi('test.ui-sync')).toBeUndefined();
    await expect(startFromUi('test.ui-sync')).resolves.toBeUndefined();
  });

  it('shows an info refusal thrown before run returns as one info toast, in the same tick', () => {
    nextOutcome = throwing(refusal('info'));
    invokeFromUi('test.ui-sync');
    expect(toasts.notifyInfo.mock.calls).toEqual([['refused with info']]);
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });

  it('shows an error refusal as one error toast', () => {
    nextOutcome = throwing(refusal('error'));
    invokeFromUi('test.ui-sync');
    expect(toasts.notifyError.mock.calls).toEqual([['refused with error']]);
    expect(toasts.notifyInfo).not.toHaveBeenCalled();
  });

  it('keeps a refusal with notice null silent', async () => {
    nextOutcome = throwing(refusal(null));
    await expect(startFromUi('test.ui-sync')).resolves.toBeUndefined();
    expect(toasts.notifyInfo).not.toHaveBeenCalled();
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });

  it('shows a refusal the command rejects with after an await, once', async () => {
    nextOutcome = () => Promise.reject(refusal('info'));
    await startFromUi('test.ui-sync');
    expect(toasts.notifyInfo.mock.calls).toEqual([['refused with info']]);
  });

  it('keeps an unknown id silent: not-found carries no notice', () => {
    expect(() => invokeFromUi('test.no-such-command')).not.toThrow();
    expect(toasts.notifyInfo).not.toHaveBeenCalled();
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });

  it('throws a bug in the synchronous part to the caller, as a menu action\'s own throw was', () => {
    const bug = new TypeError('broken');
    nextOutcome = throwing(bug);
    expect(() => invokeFromUi('test.ui-sync')).toThrow(bug);
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });

  it('leaves a bug after an await rejected, as a menu action\'s un-awaited promise was', async () => {
    const bug = new Error('late');
    nextOutcome = () => Promise.reject(bug);
    await expect(startFromUi('test.ui-sync')).rejects.toBe(bug);
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });

  it('never waits for the engine to settle', async () => {
    const settle = vi.fn(() => Promise.reject(new CommandError('unavailable', 'Timed out')));
    setSettle(settle);
    await expect(startFromUi('test.ui-sync')).resolves.toBeUndefined();
    expect(log).toEqual(['ran']);
    expect(settle).not.toHaveBeenCalled();
    expect(toasts.notifyInfo).not.toHaveBeenCalled();
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });
});

describe('invokeFromUi with a preflight that refuses', () => {
  afterEach(() => {
    setPreflight(() => undefined);
  });

  it('still runs the command, as the menu ran its function while the context was lost', async () => {
    setPreflight(() => {
      throw new CommandError('unavailable', 'The graphics context is lost');
    });
    invokeFromUi('test.ui-sync', { tag: 'pressed' });
    expect(log).toEqual(['pressed']);
    await expect(runCommand('test.ui-sync')).rejects.toMatchObject({ code: 'unavailable' });
    expect(log).toEqual(['pressed']);
  });
});

describe('invokeFromUi with the real settle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSettle(settled);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts no settle timer and no render-loop waiter, where an API run does', async () => {
    invokeFromUi('test.ui-sync');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(frameClock.nextLoopPass).not.toHaveBeenCalled();

    const apiRun = runCommand('test.ui-sync').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await apiRun;
  });
});
