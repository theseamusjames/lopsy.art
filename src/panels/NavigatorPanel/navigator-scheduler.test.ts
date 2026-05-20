import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNavigatorScheduler } from './navigator-scheduler';

describe('createNavigatorScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads on each interval tick when no stroke is active', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    vi.advanceTimersByTime(200);
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(read).toHaveBeenCalledTimes(2);

    sched.stop();
  });

  it('skips ticks while stroking', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setStroking(true);
    vi.advanceTimersByTime(1000);
    expect(read).not.toHaveBeenCalled();

    sched.stop();
  });

  it('fires one catch-up read when stroke ends', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setStroking(true);
    vi.advanceTimersByTime(1000);
    expect(read).not.toHaveBeenCalled();

    sched.setStroking(false);
    // Catch-up runs on the next macrotask (timeout 0).
    vi.advanceTimersByTime(0);
    expect(read).toHaveBeenCalledTimes(1);

    sched.stop();
  });

  it('resumes interval reads after the stroke ends', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setStroking(true);
    vi.advanceTimersByTime(400);
    sched.setStroking(false);
    vi.advanceTimersByTime(0); // catch-up
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(read).toHaveBeenCalledTimes(2);

    sched.stop();
  });

  it('does not fire a catch-up if stroking turns true again before it runs', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setStroking(true);
    sched.setStroking(false); // schedules catch-up
    sched.setStroking(true); // re-enter stroke before catch-up runs
    vi.advanceTimersByTime(0);
    expect(read).not.toHaveBeenCalled();

    sched.stop();
  });

  it('ignores redundant setStroking calls (no extra catch-up)', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setStroking(true);
    sched.setStroking(true);
    sched.setStroking(false);
    sched.setStroking(false);
    vi.advanceTimersByTime(0);
    expect(read).toHaveBeenCalledTimes(1); // single catch-up

    sched.stop();
  });

  it('stop() halts both interval and pending catch-up', () => {
    const read = vi.fn();
    const sched = createNavigatorScheduler({ read, intervalMs: 200 });

    sched.setStroking(true);
    sched.setStroking(false); // catch-up scheduled
    sched.stop();
    vi.advanceTimersByTime(1000);
    expect(read).not.toHaveBeenCalled();
  });
});
