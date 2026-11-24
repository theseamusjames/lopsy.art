import { describe, expect, it } from 'vitest';
import { drivePickRedirectUri, isDrivePickReturn } from './drive-pick-return';

describe('the page Google sends the Picker back to', () => {
  it('is drive-picked under the app, on whatever origin the app is', () => {
    expect(drivePickRedirectUri({ origin: 'https://photonamous.com', pathname: '/' }, '/')).toBe('https://photonamous.com/drive-picked');
    expect(drivePickRedirectUri({ origin: 'http://localhost:5174', pathname: '/anything' }, '/')).toBe('http://localhost:5174/drive-picked');
    expect(drivePickRedirectUri({ origin: 'https://example.com', pathname: '/' }, '/photos/')).toBe('https://example.com/photos/drive-picked');
  });

  it('is recognised by its path alone', () => {
    expect(isDrivePickReturn({ origin: 'https://photonamous.com', pathname: '/drive-picked' }, '/')).toBe(true);
    expect(isDrivePickReturn({ origin: 'https://photonamous.com', pathname: '/' }, '/')).toBe(false);
    expect(isDrivePickReturn({ origin: 'https://photonamous.com', pathname: '/drive-picked/more' }, '/')).toBe(false);
  });
});
