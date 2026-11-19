import { describe, expect, it } from 'vitest';
import { shareWarning } from './share-words';

describe('shareWarning', () => {
  it('says exactly what anyone with the link can see', () => {
    const text = shareWarning('2026-11-18 Web', 3);
    expect(text).toContain('Anyone who has the link');
    expect(text).toContain('3 photos in the export folder “2026-11-18 Web”');
    expect(text).toContain('anything added to that folder later');
    expect(text).toContain('without signing in');
    expect(text).toContain('stop sharing at any time');
    expect(shareWarning('x', 1)).toContain('the 1 photo in');
  });
});
