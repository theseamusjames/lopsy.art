import { describe, it, expect } from 'vitest';
import { defaultEraserSettings } from './eraser';

describe('defaultEraserSettings', () => {
  it('returns valid defaults', () => {
    const s = defaultEraserSettings();
    expect(s.size).toBeGreaterThan(0);
  });
});
