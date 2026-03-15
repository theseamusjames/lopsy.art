/**
 * RAF-based render scheduler with dirty flags.
 *
 * Replaces React useEffect rendering — subscribes directly to Zustand
 * stores and only redraws when state actually changes. The compositor
 * and overlay renderer are called from requestAnimationFrame, not from
 * React's commit phase.
 */

import type { GpuCompositor, CompositeFrameInput } from './gpu-compositor';

export class RenderScheduler {
  private compositor: GpuCompositor;
  private rafId: number | null = null;
  private compositeDirty = true;
  private disposed = false;

  // Frame input builder — set by the store subscriber
  private getFrameInput: (() => CompositeFrameInput) | null = null;

  constructor(compositor: GpuCompositor) {
    this.compositor = compositor;
  }

  /** Set the function that builds a CompositeFrameInput from current store state. */
  setFrameInputProvider(fn: () => CompositeFrameInput): void {
    this.getFrameInput = fn;
  }

  /** Mark the composite as needing a redraw on the next frame. */
  markCompositeDirty(): void {
    this.compositeDirty = true;
  }

  /** Start the RAF loop. */
  start(): void {
    if (this.disposed) return;
    this.tick();
  }

  /** Stop the RAF loop. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private tick = (): void => {
    if (this.disposed) return;

    if (this.compositeDirty && this.getFrameInput) {
      this.compositeDirty = false;
      try {
        const input = this.getFrameInput();
        this.compositor.renderComposite(input);
      } catch (err) {
        console.error('[Lopsy] GPU render error:', err);
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
