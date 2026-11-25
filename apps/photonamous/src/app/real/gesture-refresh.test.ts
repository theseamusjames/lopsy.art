// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isSpareClick, renewOnClicks } from './gesture-refresh';

function element(html: string, selector: string): Element {
  document.body.innerHTML = html;
  const found = document.querySelector(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isSpareClick', () => {
  it('takes clicks on the page itself and on ordinary controls', () => {
    expect(isSpareClick(element('<main><button id="b">Fit</button></main>', '#b'))).toBe(true);
    expect(isSpareClick(element('<main><input id="s" type="range" /></main>', '#s'))).toBe(true);
    expect(isSpareClick(element('<main><div id="d"></div></main>', '#d'))).toBe(true);
  });

  it('leaves clicks whose own handler needs the browser’s leave', () => {
    expect(isSpareClick(element('<div role="menu"><button id="b" role="menuitem">Choose photos…</button></div>', '#b'))).toBe(false);
    expect(isSpareClick(element('<div role="dialog"><button id="b">Export</button></div>', '#b'))).toBe(false);
    expect(isSpareClick(element('<a id="a" href="/privacy"><span id="s">Privacy</span></a>', '#s'))).toBe(false);
    expect(isSpareClick(element('<input id="f" type="file" />', '#f'))).toBe(false);
    expect(isSpareClick(element('<div data-keeps-gesture><button id="b">Copy link</button></div>', '#b'))).toBe(false);
  });

  it('leaves a click with no element behind it', () => {
    expect(isSpareClick(null)).toBe(false);
    expect(isSpareClick(document)).toBe(false);
  });
});

describe('renewOnClicks', () => {
  it('offers spare clicks to the token source, and stops when told to', () => {
    let offered = 0;
    const source = {
      refreshOnGesture: (): Promise<boolean> => {
        offered += 1;
        return Promise.resolve(false);
      },
    };
    const stop = renewOnClicks(source);
    const button = element('<main><button id="b">Fit</button><div role="menu"><button id="m">Item</button></div></main>', '#b');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offered).toBe(1);

    document.querySelector('#m')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offered).toBe(1);

    stop();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(offered).toBe(1);
  });

  it('is not troubled by a renewal that fails', async () => {
    const source = { refreshOnGesture: (): Promise<boolean> => Promise.reject(new Error('no')) };
    const stop = renewOnClicks(source);
    element('<button id="b">Fit</button>', '#b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    stop();
  });
});
