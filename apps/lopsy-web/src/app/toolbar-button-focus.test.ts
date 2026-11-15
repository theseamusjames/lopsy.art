// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { releaseToolbarButtonFocus } from './toolbar-button-focus';

function mount(html: string): HTMLButtonElement {
  document.body.innerHTML = html;
  const button = document.querySelector('button')!;
  button.focus();
  expect(document.activeElement).toBe(button);
  return button;
}

function click(target: Element, detail: number): void {
  const e = new MouseEvent('click', { bubbles: true, detail });
  Object.defineProperty(e, 'target', { value: target });
  releaseToolbarButtonFocus(e);
}

describe('releaseToolbarButtonFocus (#817)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('blurs a toolbar button after a pointer click so Enter cannot re-trigger it', () => {
    const button = mount('<div role="toolbar"><button>Flip</button></div>');
    click(button, 1);
    expect(document.activeElement).toBe(document.body);
  });

  it('handles clicks on the icon inside the button', () => {
    const button = mount('<div role="toolbar"><button><svg></svg></button></div>');
    click(button.querySelector('svg')!, 1);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps focus for keyboard activation (click.detail === 0)', () => {
    const button = mount('<div role="toolbar"><button>Flip</button></div>');
    click(button, 0);
    expect(document.activeElement).toBe(button);
  });

  it('leaves buttons outside toolbars alone', () => {
    const button = mount('<div role="dialog"><button>OK</button></div>');
    click(button, 1);
    expect(document.activeElement).toBe(button);
  });
});
