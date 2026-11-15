/**
 * Makes a function that runs async tasks one at a time, in the order they
 * were given. A task given while nothing is running starts at once, in the
 * caller's own turn; one given while another runs starts when that one has
 * settled, whether it resolved or rejected.
 *
 * For an action that reads state, awaits, and then writes it: two of them
 * started together would both read the state as it was before either
 * wrote.
 */
export function runInOrder(): <T>(task: () => Promise<T>) => Promise<T> {
  let running: Promise<void> | null = null;
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = running ? running.then(task) : task();
    const settled: Promise<void> = result.then(noop, noop).then(() => {
      if (running === settled) running = null;
    });
    running = settled;
    return result;
  };
}

function noop(): void {}
