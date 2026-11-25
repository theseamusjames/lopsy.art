// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECIPE, addArea, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { AreaFrame } from '../../engine/areas';
import { applyChanges } from '../edit-controls';
import { MaskPanel, type MaskPanelProps } from './MaskPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME: AreaFrame = { framing: { rotate: 0, flipH: false }, angle: 0, sourceWidth: 600, sourceHeight: 400, cropX: 0, cropY: 0 };

function radialRecipe(changes: Readonly<Record<string, number>> = {}): Recipe {
  const added = addArea(DEFAULT_RECIPE, 'radial', 'r1');
  if (!added) throw new Error('no mask');
  return applyChanges(DEFAULT_RECIPE, { ...added.values, ...changes });
}

function twoMasks(): Recipe {
  const one = radialRecipe();
  const added = addArea(one, 'linear', 'r2');
  if (!added) throw new Error('no mask');
  return applyChanges(one, added.values);
}

let root: Root | null = null;

/** The panel with one radial mask open, keeping the open mask in its own state. */
function Panel({ recipe = radialRecipe(), ...props }: Partial<MaskPanelProps>) {
  const [selectedId, setSelectedId] = useState<string | null>('r1');
  return (
    <MaskPanel
      recipe={recipe}
      selectedId={selectedId}
      isDisabled={false}
      onAdd={() => undefined}
      onDuplicate={() => undefined}
      onSelect={setSelectedId}
      onRename={() => undefined}
      onInvert={() => undefined}
      onDelete={() => undefined}
      onChange={() => undefined}
      onCommit={() => undefined}
      onDraftChanges={() => undefined}
      onCommitChanges={() => undefined}
      hiddenIds={new Set()}
      onToggleHidden={() => undefined}
      isHideDisabled={false}
      shapeFrame={{ frame: FRAME, doc: { width: 600, height: 400 } }}
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

function button(host: ParentNode, name: string): HTMLButtonElement {
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

/** Opens the menu of `trigger` and picks the item named `name`. */
function choose(trigger: HTMLElement, name: string): void {
  click(trigger);
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.startsWith(name));
  if (!item) throw new Error(`no ${name} item`);
  click(item);
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('MaskPanel', () => {
  it('leads with Amount and the seven adjustments, on every mask', () => {
    const host = mount(<Panel />);
    expect(sliderNames(host)).toEqual(['Amount', 'Exposure', 'Contrast', 'Highlights', 'Shadows', 'Temperature', 'Tint', 'Saturation']);
  });

  it('has Add adjustment at the bottom of the mask, with the Edit panel\'s other sections; one added has its controls and a button that takes it off', () => {
    const onCommitChanges = vi.fn();
    const host = mount(<Panel onCommitChanges={onCommitChanges} />);
    const section = host.querySelector<HTMLElement>('[data-mask="r1"]');
    if (!section) throw new Error('no mask');
    const grading = () => section.querySelector<HTMLElement>('[role="group"][aria-label="Mask 1 color grading"]');
    expect(grading()).toBeNull();
    const add = button(host, 'Add adjustment');
    expect([...section.querySelectorAll('button')].at(-1)).toBe(add);

    click(add);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      'Whites & blacks', 'Curves', 'Vibrance', 'Color by hue', 'Color grading', 'Local contrast', 'Sharpness & noise', 'Vignette & grain',
    ]);
    click(add);
    choose(add, 'Color grading');
    const block = grading();
    if (!block) throw new Error('no color grading');
    expect([...block.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Shadows', 'Midtones', 'Highlights', 'Global']);
    expect(block.querySelector('[role="slider"][aria-label="Shadows color"]')).not.toBeNull();
    expect(sliderNames(host)).toEqual([
      'Amount', 'Exposure', 'Contrast', 'Highlights', 'Shadows', 'Temperature', 'Tint', 'Saturation',
      'Hue', 'Saturation', 'Luminance', 'Blending', 'Balance',
    ]);
    // Focus is on its first tab, and the menu no longer lists it.
    expect(document.activeElement?.textContent).toBe('Shadows');
    click(add);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).not.toContain('Color grading');
    click(add);

    // Plain sliders and the curve editor are added the same way, each in the Edit panel's order whatever order they were added in.
    choose(add, 'Local contrast');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Large details');
    choose(add, 'Curves');
    choose(add, 'Whites & blacks');
    expect([...section.querySelectorAll('[data-extra]')].map((b) => b.getAttribute('data-extra'))).toEqual(['tone', 'curves', 'colorGrading', 'localContrast']);
    expect(section.querySelector('[data-extra="curves"] [role="tablist"]')?.getAttribute('aria-label')).toBe('Curve channel');
    expect(sliderNames(host).slice(8, 10)).toEqual(['Whites', 'Blacks']);
    expect(sliderNames(host).slice(-3)).toEqual(['Large details', 'Small details', 'Haze']);

    // Taken off while still neutral: nothing to undo, and Add adjustment is back, with focus.
    click(button(block, 'Remove Color grading'));
    expect(grading()).toBeNull();
    expect(onCommitChanges).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button(host, 'Add adjustment'));
  });

  it('shows the colour grading a mask already has, and taking it off puts it back to neutral as one step', () => {
    const onCommitChanges = vi.fn();
    const recipe = radialRecipe({
      'areas.r1.fx.colorGrading.shadows.hue': 220,
      'areas.r1.fx.colorGrading.shadows.saturation': 45,
      'areas.r1.fx.colorGrading.blending': 70,
      'areas.r1.fx.sharpness.amount': 80,
    });
    const host = mount(<Panel recipe={recipe} onCommitChanges={onCommitChanges} />);
    const block = host.querySelector<HTMLElement>('[role="group"][aria-label="Mask 1 color grading"]');
    if (!block) throw new Error('no color grading');
    expect(block.querySelector('[role="slider"][aria-label="Shadows color"]')?.getAttribute('aria-valuetext')).toBe('Hue 220°, saturation 45 %');
    // A mask is in use on the strength of its grade alone.
    expect(host.querySelector('h2')?.textContent).toContain('Mask 1, in use');

    click(button(block, 'Remove Color grading'));
    expect(onCommitChanges).toHaveBeenCalledWith(
      { 'areas.r1.fx.colorGrading.shadows.hue': 0, 'areas.r1.fx.colorGrading.shadows.saturation': 0, 'areas.r1.fx.colorGrading.blending': 50 },
      'Mask 1: remove color grading',
    );
    // Another it was using shows too, and is taken off on its own.
    const detail = host.querySelector<HTMLElement>('[data-extra="detail"]');
    if (!detail) throw new Error('no sharpness & noise');
    expect(detail.getAttribute('aria-label')).toBe('Mask 1 sharpness & noise');
    click(button(detail, 'Remove Sharpness & noise'));
    expect(onCommitChanges).toHaveBeenLastCalledWith({ 'areas.r1.fx.sharpness.amount': 0 }, 'Mask 1: remove sharpness & noise');
  });

  it('keeps the shape under a closed Position', () => {
    const host = mount(<Panel />);
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

  it('gives each mask a section: its name to open it, a pencil beside it, Delete and an eye; one is open at a time', () => {
    const onDelete = vi.fn();
    const onToggleHidden = vi.fn();
    const host = mount(<Panel recipe={twoMasks()} onDelete={onDelete} onToggleHidden={onToggleHidden} />);
    const first = button(host, 'Mask 1');
    const second = button(host, 'Mask 2');
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('false');
    // Beside the heading, not in it: the heading's name stays the mask's.
    expect(first.closest('h2')?.nextElementSibling).toBe(button(host, 'Rename Mask 1'));

    click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-mask="r2"]')?.textContent).toContain('Linear');
    click(second);
    expect(host.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);

    click(button(host, 'Hide Mask 2'));
    expect(onToggleHidden).toHaveBeenCalledWith('r2');
    click(button(host, 'Delete Mask 1'));
    expect(onDelete).toHaveBeenCalledWith('r1');
  });

  it('says a hidden mask is hidden, and holds its controls', () => {
    const host = mount(<Panel hiddenIds={new Set(['r1'])} />);
    expect(button(host, 'Hide Mask 1').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('h2')?.textContent).toContain('Mask 1, hidden');
    expect(button(host, 'Invert Mask 1').disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
  });

  it('renames a mask in place of its name', () => {
    const onRename = vi.fn();
    const host = mount(<Panel onRename={onRename} />);
    click(button(host, 'Rename Mask 1'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Mask name"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    const form = input?.closest('form');
    act(() => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onRename).toHaveBeenCalledWith('r1', '');
    expect(document.activeElement).toBe(button(host, 'Mask 1'));
  });

  it('has a bar at its foot: New mask with the two kinds, and Duplicate for the open mask', () => {
    const onAdd = vi.fn();
    const onDuplicate = vi.fn();
    const host = mount(<Panel onAdd={onAdd} onDuplicate={onDuplicate} />);
    const foot = host.querySelector<HTMLElement>('[role="group"][aria-label="Masks"]');
    if (!foot) throw new Error('no foot');
    choose(button(foot, 'New mask'), 'Radial');
    expect(onAdd).toHaveBeenCalledWith('radial');
    click(button(foot, 'Duplicate mask'));
    expect(onDuplicate).toHaveBeenCalledWith('r1');

    expect([...foot.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['New mask', 'Duplicate mask']);

    // With no mask open there is nothing to duplicate.
    click(button(host, 'Mask 1'));
    expect(button(foot, 'Duplicate mask').disabled).toBe(true);
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

  it('has one button in its middle while there is no mask: Add a mask, with the two kinds', () => {
    const onAdd = vi.fn();
    const host = mount(<Panel recipe={DEFAULT_RECIPE} onAdd={onAdd} />);
    const add = button(host, 'Add a mask');
    expect(add.closest('[data-empty]')).not.toBeNull();
    choose(add, 'Linear');
    expect(onAdd).toHaveBeenCalledWith('linear');
    expect(button(host, 'Duplicate mask').disabled).toBe(true);
    // It is gone once there is a mask; New mask stays at the foot.
    act(() => root?.render(<Panel recipe={radialRecipe()} />));
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add a mask')).toBe(false);
    expect(button(host, 'New mask')).toBeDefined();
  });
});
