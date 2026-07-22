import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNavigatorScheduler } from './navigator-scheduler';

describe('createNavigatorScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads on each interval tick when no interaction is active', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    vi.advanceTimersByTime(200);
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(read).toHaveBeenCalledTimes(2);

    sched.stop();
  });

  it('skips ticks while an interaction is in progress', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setInteracting(true);
    vi.advanceTimersByTime(1000);
    expect(read).not.toHaveBeenCalled();

    sched.stop();
  });

  it('fires one catch-up read when the interaction ends', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setInteracting(true);
    vi.advanceTimersByTime(1000);
    expect(read).not.toHaveBeenCalled();

    sched.setInteracting(false);
    // Catch-up runs on the next macrotask (timeout 0).
    vi.advanceTimersByTime(0);
    expect(read).toHaveBeenCalledTimes(1);

    sched.stop();
  });

  it('resumes interval reads after the interaction ends', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setInteracting(true);
    vi.advanceTimersByTime(400);
    sched.setInteracting(false);
    vi.advanceTimersByTime(0); // catch-up
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(read).toHaveBeenCalledTimes(2);

    sched.stop();
  });

  it('does not fire a catch-up if an interaction restarts before it runs', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setInteracting(true);
    sched.setInteracting(false); // schedules catch-up
    sched.setInteracting(true); // re-enter interaction before catch-up runs
    vi.advanceTimersByTime(0);
    expect(read).not.toHaveBeenCalled();

    sched.stop();
  });

  it('ignores redundant setInteracting calls (no extra catch-up) — #682', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setInteracting(true);
    sched.setInteracting(true);
    sched.setInteracting(false);
    sched.setInteracting(false);
    vi.advanceTimersByTime(0);
    expect(read).toHaveBeenCalledTimes(1); // single catch-up

    sched.stop();
  });

  it('stop() halts both interval and pending catch-up', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setInteracting(true);
    sched.setInteracting(false); // catch-up scheduled
    sched.stop();
    vi.advanceTimersByTime(1000);
    expect(read).not.toHaveBeenCalled();
  });
});
