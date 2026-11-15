// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../../ui-store';
import { createViewMenu } from './view-menu';

function unitsSubmenu() {
  const item = createViewMenu().items.find((i) => i.label === 'Units');
  expect(item?.submenu, 'View menu has a Units submenu').toBeDefined();
  return item!.submenu!;
}

describe('View → Units', () => {
  beforeEach(() => {
    useUIStore.setState({ rulerUnit: 'px' });
  });

  it('sits right after Show Rulers', () => {
    const labels = createViewMenu().items.map((i) => i.label);
    expect(labels.indexOf('Units')).toBe(labels.indexOf('Show Rulers') + 1);
  });

  it('lists the four units in order with only the current one checked', () => {
    expect(unitsSubmenu().map((i) => i.label)).toEqual(['Pixels', 'Points', 'Inches', 'Millimeters']);
    expect(unitsSubmenu().map((i) => i.checked)).toEqual([true, false, false, false]);
  });

  it('picking a unit updates the store and the checkmark follows on the next build', () => {
    unitsSubmenu()[2]!.action!();
    expect(useUIStore.getState().rulerUnit).toBe('in');
    expect(unitsSubmenu().map((i) => i.checked)).toEqual([false, false, true, false]);

    unitsSubmenu()[3]!.action!();
    expect(useUIStore.getState().rulerUnit).toBe('mm');
    expect(unitsSubmenu().map((i) => i.checked)).toEqual([false, false, false, true]);
  });
});
