import { describe, expect, it } from 'vitest';
import { describeWhere } from './where-words';

describe('describeWhere', () => {
  it('names Google Drive, never the account', () => {
    expect(describeWhere('google-drive', 'someone@example.com')).toBe('Google Drive');
  });

  it('keeps the name of local storage', () => {
    expect(describeWhere('browser', 'This browser')).toBe('This browser');
    expect(describeWhere('local-folder', 'Pictures')).toBe('Pictures');
  });
});
