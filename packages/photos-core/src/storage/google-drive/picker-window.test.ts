import { describe, expect, it } from 'vitest';
import { isStorageError } from '../errors';
import { announceDrivePick, drivePickUrl, pickDriveFilesInWindow, readDrivePick, type PickChannel } from './picker-window';

const STATE = 'abcdefghijklmnopqrstuvwxyz012345';
const OTHER_STATE = 'zyxwvutsrqponmlkjihgfedcba543210';
const FILE_A = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-012';
const FILE_B = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa_-987';

/** Channels that hear each other, as BroadcastChannels of one name do. */
function airwaves(): { channel(): PickChannel; open: number } {
  const listeners = new Set<(event: { data: unknown }) => void>();
  const air = {
    open: 0,
    channel(): PickChannel {
      air.open++;
      const mine: ((event: { data: unknown }) => void)[] = [];
      return {
        postMessage: (message) => listeners.forEach((listener) => !mine.includes(listener) && listener({ data: message })),
        addEventListener: (_type, listener) => {
          mine.push(listener);
          listeners.add(listener);
        },
        close: () => {
          air.open--;
          mine.forEach((listener) => listeners.delete(listener));
        },
      };
    },
  };
  return air;
}

function pick(air: ReturnType<typeof airwaves>, state = STATE, opened: string[] = []): Promise<string[]> {
  return pickDriveFilesInWindow({
    clientId: 'client.apps.googleusercontent.com',
    redirectUri: 'https://photos.example/drive-picked',
    open: (url) => {
      opened.push(url);
      return {};
    },
    channel: air.channel,
    newState: () => state,
  });
}

describe('drivePickUrl', () => {
  it("is Google's authorization page asking for drive.file alone, with the Picker on", () => {
    const url = new URL(
      drivePickUrl({ clientId: 'client.apps.googleusercontent.com', redirectUri: 'https://photos.example/drive-picked', mimeTypes: ['image/jpeg', 'image/png'] }, STATE),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client.apps.googleusercontent.com',
      redirect_uri: 'https://photos.example/drive-picked',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      prompt: 'consent',
      trigger_onepick: 'true',
      allow_multiple: 'true',
      mimetypes: 'image/jpeg,image/png',
      state: STATE,
    });
  });

  it('asks for one file when multiselect is off, and any type when none is named', () => {
    const url = new URL(drivePickUrl({ clientId: 'c', redirectUri: 'https://photos.example/drive-picked', multiselect: false }, STATE));
    expect(url.searchParams.has('allow_multiple')).toBe(false);
    expect(url.searchParams.has('mimetypes')).toBe(false);
  });
});

describe('readDrivePick', () => {
  it("reads the picked files and the state off Google's answer", () => {
    expect(readDrivePick(`?state=${STATE}&picked_file_ids=${FILE_A},${FILE_B}&code=4/secret&scope=x`)).toEqual({ state: STATE, fileIds: [FILE_A, FILE_B], error: null });
  });

  it('drops anything that is not a file ID', () => {
    expect(readDrivePick(`?state=${STATE}&picked_file_ids=${FILE_A},<script>,,../x`)?.fileIds).toEqual([FILE_A]);
  });

  it('reads a refusal', () => {
    expect(readDrivePick(`?state=${STATE}&error=access_denied`)).toEqual({ state: STATE, fileIds: [], error: 'access_denied' });
  });

  it('is null without a state that could be ours', () => {
    expect(readDrivePick('')).toBeNull();
    expect(readDrivePick(`?picked_file_ids=${FILE_A}`)).toBeNull();
    expect(readDrivePick('?state=short')).toBeNull();
    expect(readDrivePick('?state=<img src=x onerror=alert(1)>')).toBeNull();
  });
});

describe('pickDriveFilesInWindow', () => {
  it("opens Google's page and resolves with what the return page announces", async () => {
    const air = airwaves();
    const opened: string[] = [];
    const picked = pick(air, STATE, opened);
    expect(new URL(opened[0] ?? '').searchParams.get('state')).toBe(STATE);
    expect(announceDrivePick(`?state=${STATE}&picked_file_ids=${FILE_A},${FILE_B}&code=4/x`, air.channel())).toBe(true);
    await expect(picked).resolves.toEqual([FILE_A, FILE_B]);
    expect(air.open).toBe(0);
  });

  it('ignores an answer to another pick, and a message that is no answer', async () => {
    const air = airwaves();
    const picked = pick(air);
    announceDrivePick(`?state=${OTHER_STATE}&picked_file_ids=${FILE_B}`, air.channel());
    const stranger = air.channel();
    stranger.postMessage({ state: STATE, fileIds: ['<script>'], error: null });
    stranger.postMessage('hello');
    stranger.close();
    announceDrivePick(`?state=${STATE}&picked_file_ids=${FILE_A}`, air.channel());
    await expect(picked).resolves.toEqual([FILE_A]);
  });

  it('resolves with nothing when the user refuses or closes Google\'s page', async () => {
    const air = airwaves();
    const picked = pick(air);
    announceDrivePick(`?state=${STATE}&error=access_denied`, air.channel());
    await expect(picked).resolves.toEqual([]);
  });

  it("rejects with Google's error otherwise", async () => {
    const air = airwaves();
    const picked = pick(air);
    announceDrivePick(`?state=${STATE}&error=redirect_uri_mismatch`, air.channel());
    await expect(picked).rejects.toSatisfy((error) => isStorageError(error) && error.code === 'auth' && /redirect_uri_mismatch/.test(error.message));
  });

  it('rejects when the browser blocks the pop-up', async () => {
    const air = airwaves();
    const picked = pickDriveFilesInWindow({ clientId: 'c', redirectUri: 'https://photos.example/drive-picked', open: () => null, channel: air.channel });
    await expect(picked).rejects.toSatisfy((error) => isStorageError(error) && /pop-ups/.test(error.message));
    expect(air.open).toBe(0);
  });

  it('ends a pick that never answered when the next one starts', async () => {
    const air = airwaves();
    const abandoned = pick(air);
    const next = pick(air, OTHER_STATE);
    await expect(abandoned).resolves.toEqual([]);
    announceDrivePick(`?state=${OTHER_STATE}&picked_file_ids=${FILE_B}`, air.channel());
    await expect(next).resolves.toEqual([FILE_B]);
    expect(air.open).toBe(0);
  });
});
