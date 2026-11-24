/**
 * The screen-only views (the clipping warning, the sharpening mask view and
 * the selected mask's red overlay) and the reads that must not see them.
 *
 * A read that draws or counts the frame (an export, a preview, a histogram
 * on the 8-bit fallback) holds the views off for as long as it is out.
 * Reads overlap: an export waits seconds for the full size while the pixel
 * readout samples every 100 ms. So the views come back only when the last
 * read ends, and a change asked for while any read is out is recorded and
 * sent then, never while a read could still draw a frame.
 */

export interface ScreenViewState {
  readonly shadows: boolean;
  readonly highlights: boolean;
  readonly detailMask: boolean;
}

export interface ScreenViewOutput {
  /** Sends the clipping warning and the sharpening mask view to the engine. */
  send(views: ScreenViewState): void;
  /** The views were just held off or let go: the overlay follows `isHeld()`. */
  holdChanged(): void;
}

const ALL_OFF: ScreenViewState = { shadows: false, highlights: false, detailMask: false };

function same(a: ScreenViewState, b: ScreenViewState): boolean {
  return a.shadows === b.shadows && a.highlights === b.highlights && a.detailMask === b.detailMask;
}

export class ScreenViews {
  private readonly output: ScreenViewOutput;
  private wantedViews: ScreenViewState = ALL_OFF;
  private sentViews: ScreenViewState = ALL_OFF;
  private openScopes = 0;

  constructor(output: ScreenViewOutput) {
    this.output = output;
  }

  /** Whether a read holds the views off now. */
  isHeld(): boolean {
    return this.openScopes > 0;
  }

  /** What the Edit view asked for, shown or not. */
  wanted(): ScreenViewState {
    return this.wantedViews;
  }

  /** Records what the Edit view asks for; it is sent at once unless a read holds the views off. */
  set(views: Partial<ScreenViewState>): void {
    this.wantedViews = { ...this.wantedViews, ...views };
    if (this.isHeld()) return;
    this.sentViews = this.wantedViews;
    this.output.send(this.wantedViews);
  }

  /** Runs `work` with every screen-only view off, and shows what is wanted once no read is out. */
  async hold<T>(work: () => Promise<T>): Promise<T> {
    this.openScopes += 1;
    if (this.openScopes === 1) {
      this.sendIfChanged(ALL_OFF);
      this.output.holdChanged();
    }
    try {
      return await work();
    } finally {
      this.openScopes -= 1;
      if (this.openScopes === 0) {
        this.sendIfChanged(this.wantedViews);
        this.output.holdChanged();
      }
    }
  }

  private sendIfChanged(views: ScreenViewState): void {
    if (same(views, this.sentViews)) return;
    this.sentViews = views;
    this.output.send(views);
  }
}
