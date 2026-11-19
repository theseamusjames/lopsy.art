// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../commands/ui/view';
import { invokeFromUi } from '../../../commands/invoke-from-ui';
import { useUIStore } from '../../ui-store';
import { createViewMenu } from './view-menu';
import type { MenuItem } from './types';

function choose(item: MenuItem | undefined): void {
  invokeFromUi(item!.command!.id, item!.command!.params);
}

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
    choose(unitsSubmenu()[2]);
    expect(useUIStore.getState().rulerUnit).toBe('in');
    expect(unitsSubmenu().map((i) => i.checked)).toEqual([false, false, true, false]);

    choose(unitsSubmenu()[3]);
    expect(useUIStore.getState().rulerUnit).toBe('mm');
    expect(unitsSubmenu().map((i) => i.checked)).toEqual([false, false, false, true]);
  });
});
