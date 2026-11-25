import { describe, expect, it } from 'vitest';
import { editPageTitle } from './edit-page';

describe('editPageTitle', () => {
  it('names the photo, the view and the app', () => {
    expect(editPageTitle('photo-1.jpg')).toBe('photo-1.jpg – Edit – Photonamous');
  });
});
