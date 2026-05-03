import { describe, it, expect, beforeEach } from 'vitest';
import {
  createQuickMaskFromSelection,
  quickMaskToSelectionMask,
  getQuickMaskBuffer,
  setQuickMaskBuffer,
  clearQuickMaskBuffer,
  type QuickMaskBuffer,
} from './quick-mask-buffer';

describe('quick-mask-buffer', () => {
  beforeEach(() => {
    clearQuickMaskBuffer();
  });

  describe('createQuickMaskFromSelection', () => {
    it('creates an all-zero mask when no selection exists', () => {
      const buf = createQuickMaskFromSelection(null, 4, 4);
      expect(buf.width).toBe(4);
      expect(buf.height).toBe(4);
      expect(buf.data.length).toBe(16);
      for (let i = 0; i < buf.data.length; i++) {
        expect(buf.data[i]).toBe(0);
      }
    });

    it('copies the selection mask values into the buffer', () => {
      const sel = new Uint8ClampedArray([255, 0, 255, 0, 0, 255, 0, 255, 128, 64, 32, 0, 255, 255, 0, 0]);
      const buf = createQuickMaskFromSelection(sel, 4, 4);
      for (let i = 0; i < sel.length; i++) {
        expect(buf.data[i]).toBe(sel[i]);
      }
    });

    it('handles selection mask shorter than doc dimensions gracefully', () => {
      const sel = new Uint8ClampedArray([255, 128]);
      const buf = createQuickMaskFromSelection(sel, 4, 4);
      expect(buf.data[0]).toBe(255);
      expect(buf.data[1]).toBe(128);
      // Remaining bytes stay zero
      for (let i = 2; i < buf.data.length; i++) {
        expect(buf.data[i]).toBe(0);
      }
    });
  });

  describe('quickMaskToSelectionMask', () => {
    it('returns a new Uint8ClampedArray with the same values', () => {
      const buf: QuickMaskBuffer = {
        data: new Uint8ClampedArray([255, 128, 0, 64]),
        width: 2,
        height: 2,
      };
      const result = quickMaskToSelectionMask(buf);
      expect(result).toBeInstanceOf(Uint8ClampedArray);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(255);
      expect(result[1]).toBe(128);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(64);
    });

    it('returns a copy, not the original buffer data', () => {
      const buf: QuickMaskBuffer = {
        data: new Uint8ClampedArray([100, 200]),
        width: 1,
        height: 2,
      };
      const result = quickMaskToSelectionMask(buf);
      result[0] = 0;
      // Original buffer should be unchanged
      expect(buf.data[0]).toBe(100);
    });
  });

  describe('roundtrip: selection → quick mask → back to selection', () => {
    it('preserves the original selection mask values', () => {
      const original = new Uint8ClampedArray(100);
      // Set up a partial selection
      for (let i = 10; i < 50; i++) original[i] = 255;
      for (let i = 50; i < 60; i++) original[i] = 128;

      const buf = createQuickMaskFromSelection(original, 10, 10);
      const restored = quickMaskToSelectionMask(buf);

      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBe(original[i]);
      }
    });

    it('can enter/exit with no selection — produces empty selection', () => {
      const buf = createQuickMaskFromSelection(null, 8, 8);
      const mask = quickMaskToSelectionMask(buf);
      const hasAny = Array.from(mask).some((v) => v > 0);
      expect(hasAny).toBe(false);
    });
  });

  describe('buffer lifecycle', () => {
    it('starts null', () => {
      expect(getQuickMaskBuffer()).toBeNull();
    });

    it('set/get round-trips', () => {
      const buf: QuickMaskBuffer = {
        data: new Uint8ClampedArray(4),
        width: 2,
        height: 2,
      };
      setQuickMaskBuffer(buf);
      expect(getQuickMaskBuffer()).toBe(buf);
    });

    it('clearQuickMaskBuffer resets to null', () => {
      setQuickMaskBuffer({ data: new Uint8ClampedArray(1), width: 1, height: 1 });
      clearQuickMaskBuffer();
      expect(getQuickMaskBuffer()).toBeNull();
    });
  });
});
