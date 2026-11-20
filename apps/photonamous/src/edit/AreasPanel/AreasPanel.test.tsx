// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECIPE, addArea } from '@lopsy/photos-core/library/recipe';
import type { AreaFrame } from '../../engine/areas';
import { applyChanges } from '../edit-controls';
import { AreasPanel, type AreasPanelProps } from './AreasPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME: AreaFrame = { framing: { rotate: 0, flipH: false }, angle: 0, sourceWidth: 600, sourceHeight: 400, cropX: 0, cropY: 0 };

function radialRecipe() {
  const added = addArea(DEFAULT_RECIPE, 'radial', 'r1');
  if (!added) throw new Error('no mask');
  return applyChanges(DEFAULT_RECIPE, added.values);
}

let root: Root | null = null;

/** The panel with one radial mask selected, keeping Show mask in its own state. */
function Panel(props: Partial<AreasPanelProps>) {
  const [isMaskShown, setIsMaskShown] = useState(false);
  return (
    <AreasPanel
      recipe={radialRecipe()}
      selectedId="r1"
      isDisabled={false}
      onAdd={() => undefined}
      onSelect={() => undefined}
      onRename={() => undefined}
      onInvert={() => undefined}
      onDelete={() => undefined}
      onChange={() => undefined}
      onCommit={() => undefined}
      shapeFrame={{ frame: FRAME, doc: { width: 600, height: 400 } }}
      isMaskShown={isMaskShown}
      onShowMask={setIsMaskShown}
      {...props}
    />
  );
}

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host;
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name);
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

function sliderNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[type="range"]')].map((r) => r.getAttribute('aria-label') ?? '');
}

function click(target: HTMLElement): void {
  act(() => target.click());
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('AreasPanel', () => {
  it('leads with Amount and the adjustments; the shape waits under a closed Position', () => {
    const host = mount(<Panel />);
    expect(sliderNames(host)).toEqual(['Amount', 'Exposure', 'Contrast', 'Highlights', 'Shadows', 'Temperature', 'Tint', 'Saturation']);
    const position = button(host, 'Position');
    expect(position.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(position.getAttribute('aria-controls') ?? '');
    expect(body?.hidden).toBe(true);
    expect(body?.getAttribute('aria-label')).toBe('Mask 1 position');

    click(position);
    expect(position.getAttribute('aria-expanded')).toBe('true');
    expect(body?.hidden).toBe(false);
    expect(sliderNames(host).slice(8)).toEqual(['Center X', 'Center Y', 'Width', 'Height', 'Turn', 'Feather']);

    click(position);
    expect(body?.hidden).toBe(true);
    expect(sliderNames(host)).toHaveLength(8);
  });

  it('has Show mask in its header as a toggle, its key in the tooltip', () => {
    const host = mount(<Panel />);
    const show = button(host, 'Show mask');
    expect(host.querySelector('header')?.contains(show)).toBe(true);
    expect(show.getAttribute('aria-pressed')).toBe('false');
    expect(show.title).toBe('Show mask (O)');
    click(show);
    expect(show.getAttribute('aria-pressed')).toBe('true');
  });

  it('names Invert in words, says whether it is on, and turns it over', () => {
    const onInvert = vi.fn();
    const host = mount(<Panel onInvert={onInvert} />);
    const invert = button(host, 'Invert Mask 1');
    expect(invert.textContent).toBe('Invert');
    expect(invert.getAttribute('aria-pressed')).toBe('false');
    click(invert);
    expect(onInvert).toHaveBeenCalledWith('r1', true);
  });
});
