import { describe, expect, it } from 'vitest';
import {
  describeDevice,
  libraryStoreName,
  parseLastConnection,
  reconnectOffer,
  serializeLastConnection,
  uploadSessionStoreName,
} from './connection-memory';

describe('last connection', () => {
  it('round-trips and rejects junk', () => {
    const last = { kind: 'local-folder' as const, label: 'Pictures' };
    expect(parseLastConnection(serializeLastConnection(last))).toEqual(last);
    expect(parseLastConnection(null)).toBeNull();
    expect(parseLastConnection('{')).toBeNull();
    expect(parseLastConnection('{"kind":"ftp","label":"x"}')).toBeNull();
    expect(parseLastConnection('{"kind":"browser"}')).toBeNull();
  });
});

describe('reconnectOffer', () => {
  const all = ['google-drive', 'browser', 'local-folder'] as const;
  it('opens the browser storage automatically', () => {
    expect(reconnectOffer({ kind: 'browser', label: 'This browser' }, all, false)).toEqual({
      kind: 'browser',
      label: 'This browser',
      automatic: true,
    });
  });
  it('offers Drive with one click', () => {
    expect(reconnectOffer({ kind: 'google-drive', label: 'a@b.c' }, all, false)?.automatic).toBe(false);
  });
  it('needs the saved handle for a folder', () => {
    expect(reconnectOffer({ kind: 'local-folder', label: 'Pics' }, all, false)).toBeNull();
    expect(reconnectOffer({ kind: 'local-folder', label: 'Pics' }, all, true)?.label).toBe('Pics');
  });
  it('offers nothing this browser cannot open', () => {
    expect(reconnectOffer({ kind: 'google-drive', label: 'a@b.c' }, ['browser'], false)).toBeNull();
    expect(reconnectOffer(null, all, true)).toBeNull();
  });
});

describe('storage names', () => {
  it('names one database per storage and owner', () => {
    expect(libraryStoreName('google-drive', '1234567890')).toBe('lopsy-photos:google-drive:1234567890');
    expect(libraryStoreName('local-folder', 'My Photos/2026')).toBe('lopsy-photos:local-folder:My_Photos_2026');
    expect(libraryStoreName('browser', 'opfs')).toBe('lopsy-photos:browser:opfs');
    expect(uploadSessionStoreName('42')).toBe('lopsy-photos-uploads:42');
  });
});

describe('describeDevice', () => {
  it('names browser and system briefly', () => {
    expect(
      describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'),
    ).toBe('Chrome on macOS');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0')).toBe(
      'Edge on Windows',
    );
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Firefox on Linux');
    expect(describeDevice('curl')).toBe('A browser');
  });
});
