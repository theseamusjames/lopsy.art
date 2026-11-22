import { describe, expect, it } from 'vitest';
import { describeWhere } from './where-words';

describe('describeWhere', () => {
  it('names Google Drive', () => {
    expect(describeWhere('google-drive', 'Google Drive')).toBe('Google Drive');
  });

  it('keeps the name of local storage', () => {
    expect(describeWhere('browser', 'This browser')).toBe('This browser');
    expect(describeWhere('local-folder', 'Pictures')).toBe('Pictures');
  });
});
