// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { panelCollapseKey, readPanelCollapse, writePanelCollapse } from './usePanelCollapse';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('panel collapse storage', () => {
  it('uses a namespaced key per id so panels do not collide', () => {
    expect(panelCollapseKey('color')).toBe('panel:color:collapsed');
    expect(panelCollapseKey('layers')).toBe('panel:layers:collapsed');
    expect(panelCollapseKey('color')).not.toBe(panelCollapseKey('layers'));
  });

  it('returns the fallback when no value is stored', () => {
    expect(readPanelCollapse('missing', false)).toBe(false);
    expect(readPanelCollapse('missing', true)).toBe(true);
  });

  it('round-trips collapsed state through storage', () => {
    writePanelCollapse('color', true);
    expect(readPanelCollapse('color', false)).toBe(true);
    writePanelCollapse('color', false);
    expect(readPanelCollapse('color', true)).toBe(false);
  });

  it('keeps state isolated across ids', () => {
    writePanelCollapse('a', true);
    writePanelCollapse('b', false);
    expect(readPanelCollapse('a', false)).toBe(true);
    expect(readPanelCollapse('b', true)).toBe(false);
  });

  it('falls back to the default when localStorage throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(readPanelCollapse('color', true)).toBe(true);
    expect(readPanelCollapse('color', false)).toBe(false);
  });

  it('swallows write failures rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => writePanelCollapse('color', true)).not.toThrow();
  });
});
