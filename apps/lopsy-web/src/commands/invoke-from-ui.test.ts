import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../app/notifications-store', () => toasts);

const { CommandError } = await import('./command');
const { defineCommand, setSettle } = await import('./registry');
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

  it('swallows a settle that times out, with no toast', async () => {
    setSettle(() => Promise.reject(new CommandError('unavailable', 'Timed out')));
    await expect(startFromUi('test.ui-sync')).resolves.toBeUndefined();
    expect(log).toEqual(['ran']);
    expect(toasts.notifyInfo).not.toHaveBeenCalled();
    expect(toasts.notifyError).not.toHaveBeenCalled();
  });
});
