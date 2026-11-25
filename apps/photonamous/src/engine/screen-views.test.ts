import { describe, expect, it } from 'vitest';
import { ScreenViews, type ScreenViewState } from './screen-views';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(): { views: ScreenViews; sent: ScreenViewState[]; engine: () => ScreenViewState; holdChanges: boolean[] } {
  const sent: ScreenViewState[] = [];
  const holdChanges: boolean[] = [];
  const views: ScreenViews = new ScreenViews({
    send: (state) => sent.push(state),
    holdChanged: () => holdChanges.push(views.isHeld()),
  });
  const engine = (): ScreenViewState => sent[sent.length - 1] ?? { shadows: false, highlights: false, detailMask: false };
  return { views, sent, engine, holdChanges };
}

describe('ScreenViews', () => {
  it('sends a change at once while no read is out', () => {
    const { views, engine } = setup();
    views.set({ shadows: true, highlights: true });
    expect(engine()).toEqual({ shadows: true, highlights: true, detailMask: false });
  });

  it('keeps the views off until the last of overlapping reads ends', async () => {
    const { views, engine } = setup();
    views.set({ shadows: true, highlights: true, detailMask: true });
    const exportRead = deferred();
    const sampleRead = deferred();
    const exporting = views.hold(() => exportRead.promise);
    expect(engine()).toEqual({ shadows: false, highlights: false, detailMask: false });
    const sampling = views.hold(() => sampleRead.promise);
    sampleRead.resolve();
    await sampling;
    // The export is still out: a sample that ended first must not turn the warning back on.
    expect(engine()).toEqual({ shadows: false, highlights: false, detailMask: false });
    expect(views.isHeld()).toBe(true);
    exportRead.resolve();
    await exporting;
    expect(engine()).toEqual({ shadows: true, highlights: true, detailMask: true });
    expect(views.isHeld()).toBe(false);
  });

  it('records a change asked for while a read is out and sends it when the last read ends', async () => {
    const { views, sent, engine } = setup();
    const read = deferred();
    const reading = views.hold(() => read.promise);
    const before = sent.length;
    views.set({ highlights: true });
    views.set({ detailMask: true });
    expect(sent.length).toBe(before);
    expect(views.wanted()).toEqual({ shadows: false, highlights: true, detailMask: true });
    read.resolve();
    await reading;
    expect(engine()).toEqual({ shadows: false, highlights: true, detailMask: true });
  });

  it('lets the views go when the read fails', async () => {
    const { views, engine } = setup();
    views.set({ shadows: true });
    await expect(views.hold(() => Promise.reject(new Error('lost')))).rejects.toThrow('lost');
    expect(engine()).toEqual({ shadows: true, highlights: false, detailMask: false });
    expect(views.isHeld()).toBe(false);
  });

  it('tells the overlay only when the first read starts and the last ends', async () => {
    const { views, holdChanges } = setup();
    const a = deferred();
    const b = deferred();
    const first = views.hold(() => a.promise);
    const second = views.hold(() => b.promise);
    a.resolve();
    await first;
    b.resolve();
    await second;
    expect(holdChanges).toEqual([true, false]);
  });

  it('sends nothing for a read while every view is off', async () => {
    const { views, sent } = setup();
    await views.hold(() => Promise.resolve());
    expect(sent).toEqual([]);
  });
});
