import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyWhenReady } from './copy-when-ready';

/** A ClipboardItem that keeps what it was given, as the browser's does until the write. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
}

/** What the write was handed as plain text. */
function plainText(items: ClipboardItem[]): Promise<Blob> | Blob {
  const first: unknown = items[0];
  const text = first instanceof FakeClipboardItem ? first.items['text/plain'] : undefined;
  if (text === undefined) throw new Error('nothing was handed to the clipboard as plain text');
  return text;
}

function install(clipboard: Partial<Clipboard> | undefined, withItem = true): void {
  vi.stubGlobal('navigator', clipboard === undefined ? {} : { clipboard });
  if (withItem) vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  else vi.stubGlobal('ClipboardItem', undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyWhenReady', () => {
  it('starts the write at once, with the text still to come', async () => {
    const order: string[] = [];
    let written = '';
    const write = vi.fn(async (items: ClipboardItem[]) => {
      order.push('write started');
      written = await (await plainText(items)).text();
    });
    install({ write, writeText: vi.fn() });

    let deliver: (value: string) => void = () => {};
    const text = new Promise<string>((resolve) => (deliver = resolve));
    const copied = copyWhenReady(text);
    // Before the text exists: this is what keeps the write inside the click.
    expect(order).toEqual(['write started']);
    deliver('https://example.test/link');
    expect(await copied).toBe(true);
    expect(written).toBe('https://example.test/link');
  });

  it('falls back to the plain write where a promise is not taken', async () => {
    const writeText = vi.fn(async () => undefined);
    install({ write: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))), writeText });
    expect(await copyWhenReady(Promise.resolve('link'))).toBe(true);
    expect(writeText).toHaveBeenCalledWith('link');

    const older = vi.fn(async () => undefined);
    install({ writeText: older }, false);
    expect(await copyWhenReady(Promise.resolve('link'))).toBe(true);
    expect(older).toHaveBeenCalledWith('link');
  });

  it('says so when nothing was copied, and never rejects', async () => {
    install({ write: vi.fn(async () => Promise.reject(new Error('no'))), writeText: vi.fn(async () => Promise.reject(new Error('no'))) });
    expect(await copyWhenReady(Promise.resolve('link'))).toBe(false);

    // The text never came: the caller reports that from its own promise.
    install({
      write: vi.fn(async (items: ClipboardItem[]) => {
        await plainText(items);
      }),
      writeText: vi.fn(),
    });
    expect(await copyWhenReady(Promise.reject(new Error('sharing failed')))).toBe(false);

    install(undefined);
    expect(await copyWhenReady(Promise.resolve('link'))).toBe(false);
  });
});
