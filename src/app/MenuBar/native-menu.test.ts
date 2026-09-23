import { describe, it, expect, vi } from 'vitest';
import { buildNativeMenu, shortcutToTinyKey } from './native-menu';
import type { MenuDef } from './menus/types';

describe('shortcutToTinyKey', () => {
  it('maps plain command shortcuts to the lowercase key', () => {
    expect(shortcutToTinyKey('⌘Z')).toBe('z');
    expect(shortcutToTinyKey('⌘=')).toBe('=');
    expect(shortcutToTinyKey('⌘0')).toBe('0');
  });

  it('carries shift on a letter as uppercase, regardless of glyph order', () => {
    expect(shortcutToTinyKey('⇧⌘Z')).toBe('Z');
    expect(shortcutToTinyKey('⌘⇧X')).toBe('X');
    expect(shortcutToTinyKey('⌥⇧⌘E')).toBe('alt+E');
  });

  it('spells shift as a prefix on non-letters', () => {
    expect(shortcutToTinyKey('⇧⌘=')).toBe('shift+=');
  });

  it('returns null for shortcuts a menu accelerator cannot carry', () => {
    expect(shortcutToTinyKey('⇧F5')).toBeNull();
    expect(shortcutToTinyKey('⌘F5')).toBeNull();
    expect(shortcutToTinyKey('')).toBeNull();
  });
});

const CANVAS = { isTextFocused: false };
const TEXT_FIELD = { isTextFocused: true };

describe('buildNativeMenu', () => {
  it('converts items, flags and submenus and maps ids back to actions', () => {
    const rulers = vi.fn();
    const sub = vi.fn();
    const menus: MenuDef[] = [
      {
        label: 'View',
        items: [
          { label: 'Zoom In', shortcut: '⌘=', action: vi.fn() },
          { separator: true, label: '' },
          { label: 'Crop', action: vi.fn(), disabled: true },
          { label: 'Rulers', checked: false, action: rulers },
          { label: 'Mode', submenu: [{ label: 'RGB', checked: true, action: sub }] },
        ],
      },
    ];

    const { spec, actions } = buildNativeMenu(menus, CANVAS);

    expect(spec).toEqual([
      {
        title: 'View',
        items: [
          { id: 'm0.0', label: 'Zoom In', key: '=' },
          { separator: true },
          { id: 'm0.2', label: 'Crop', enabled: false },
          { id: 'm0.3', label: 'Rulers', checked: false },
          {
            id: 'm0.4',
            label: 'Mode',
            submenu: [{ id: 'm0.4.0', label: 'RGB', checked: true }],
          },
        ],
      },
    ]);

    actions.get('m0.3')?.();
    actions.get('m0.4.0')?.();
    expect(rulers).toHaveBeenCalledOnce();
    expect(sub).toHaveBeenCalledOnce();
  });

  const editMenu = (): MenuDef => ({
    label: 'Edit',
    items: [
      { label: 'Undo', nativeRole: 'undo', shortcut: '⌘Z', action: vi.fn() },
      { label: 'Copy', nativeRole: 'copy', shortcut: '⌘C', action: vi.fn() },
      { label: 'Copy Merged', shortcut: '⇧⌘C', action: vi.fn() },
      { label: 'Paste', nativeRole: 'paste', shortcut: '⌘V', action: vi.fn() },
      { separator: true, label: '' },
      { label: 'Fill', shortcut: '⇧F5', action: vi.fn() },
    ],
  });

  it('declares Edit as the role: edit block, never a second Edit menu', () => {
    const { spec } = buildNativeMenu([editMenu()], CANVAS);
    expect(spec[0]).not.toHaveProperty('title');
    expect(spec[0]?.role).toBe('edit');
  });

  it('uses Lopsy clipboard items on the canvas but keeps Paste stock', () => {
    const { spec } = buildNativeMenu([editMenu()], CANVAS);
    expect(spec[0]?.items).toEqual([
      { id: 'm0.0', label: 'Undo', key: 'z' },
      { id: 'm0.1', label: 'Copy', key: 'c' },
      { id: 'm0.2', label: 'Copy Merged', key: 'C' },
      { role: 'paste' },
      { separator: true },
      { id: 'm0.5', label: 'Fill' },
    ]);
  });

  it('swaps in stock editing items while a text field has focus', () => {
    const { spec, actions } = buildNativeMenu([editMenu()], TEXT_FIELD);
    expect(spec[0]?.items).toEqual([
      { role: 'undo' },
      { role: 'copy' },
      { id: 'm0.2', label: 'Copy Merged', key: 'C' },
      { role: 'paste' },
      { separator: true },
      { id: 'm0.5', label: 'Fill' },
    ]);
    expect(actions.has('m0.0')).toBe(false);
  });
});
