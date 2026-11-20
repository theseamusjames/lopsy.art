import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../app/notifications-store', () => ({
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
}));

const { refusalError, announceRefusal } = await import('./refusal');
const { CommandError } = await import('./command');
const { notifyInfo, notifyError } = await import('../app/notifications-store');

beforeEach(() => {
  vi.mocked(notifyInfo).mockReset();
  vi.mocked(notifyError).mockReset();
});

describe('refusalError', () => {
  it('builds a refused CommandError carrying the reason and notice', () => {
    const error = refusalError({ reason: 'Nope.', notice: 'info' });
    expect(error).toBeInstanceOf(CommandError);
    expect(error.code).toBe('refused');
    expect(error.message).toBe('Nope.');
    expect(error.notice).toBe('info');
  });

  it('keeps error and silent notices', () => {
    expect(refusalError({ reason: 'Bad.', notice: 'error' }).notice).toBe('error');
    expect(refusalError({ reason: 'Quiet.', notice: null }).notice).toBeNull();
  });

  it('does not toast', () => {
    refusalError({ reason: 'Nope.', notice: 'info' });
    expect(notifyInfo).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

describe('announceRefusal', () => {
  it('shows an info toast for an info notice', () => {
    announceRefusal({ reason: 'Nope.', notice: 'info' });
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith('Nope.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('shows an error toast for an error notice', () => {
    announceRefusal({ reason: 'Bad.', notice: 'error' });
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith('Bad.');
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it('stays silent for a null notice', () => {
    announceRefusal({ reason: 'Quiet.', notice: null });
    expect(notifyInfo).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
