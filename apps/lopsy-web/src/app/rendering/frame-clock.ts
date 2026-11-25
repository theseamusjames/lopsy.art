type PassWaiter = (rendered: boolean) => void;

// A count, not a flag: StrictMode mounts the canvas twice, and the cleanup of
// the first loop can land after the second has started.
let runningLoops = 0;
let waiters: PassWaiter[] = [];
// Swapped with `waiters` on each notify, so a pass with waiters allocates no
// new array and a waiter added while others resolve waits for the next pass.
let resolving: PassWaiter[] = [];

export function loopStarted(): void {
  runningLoops++;
}

export function loopStopped(): void {
  runningLoops = Math.max(0, runningLoops - 1);
}

export function isLoopRunning(): boolean {
  return runningLoops > 0;
}

/** Called at the end of every pass of the render loop; `rendered` is true when that pass ran the GPU frame. */
export function notifyLoopPass(rendered: boolean): void {
  if (waiters.length === 0) return;
  const due = waiters;
  waiters = resolving;
  resolving = due;
  for (const waiter of due) waiter(rendered);
  due.length = 0;
}

/** Resolves at the next `notifyLoopPass`, with that pass's `rendered`. */
export function nextLoopPass(): Promise<boolean> {
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}
