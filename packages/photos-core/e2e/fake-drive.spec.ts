import { expect, test } from '@playwright/test';
import { gisStubInitScript, routeFakeDrive } from '../src/storage/google-drive/playwright-fake-drive';

const APP = 'https://photos.test/';

test('a page reaches the fake Drive and the GIS stub', async ({ page }) => {
  const drive = await routeFakeDrive(page);
  await page.route(APP, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fake Drive</title>' }));
  await page.addInitScript(gisStubInitScript('test-token'));
  await page.goto(APP);

  const result = await page.evaluate(async () => {
    const api = 'https://www.googleapis.com';
    const oauth2 = Reflect.get(Reflect.get(Reflect.get(window, 'google'), 'accounts'), 'oauth2');
    const token = await new Promise<string>((resolve) => {
      const client = oauth2.initTokenClient({
        client_id: 'client',
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response: { access_token: string }) => resolve(response.access_token),
      });
      client.requestAccessToken({ prompt: '' });
    });
    const auth = { Authorization: `Bearer ${token}` };
    const me = await (await fetch(`${api}/drive/v3/about?fields=user(permissionId)`, { headers: auth })).json();
    const whoAmI = await fetch(`${api}/oauth2/v3/userinfo`, { headers: auth });

    const init = await fetch(`${api}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'X-Upload-Content-Length': '10' },
      body: JSON.stringify({ name: 'hello.txt', mimeType: 'text/plain' }),
    });
    const session = init.headers.get('Location') ?? '';
    const partial = await fetch(session, { method: 'PUT', headers: { ...auth, 'Content-Range': 'bytes 0-4/10' }, body: 'hello' });
    const done = await fetch(session, { method: 'PUT', headers: { ...auth, 'Content-Range': 'bytes 5-9/10' }, body: 'world' });
    const file = await done.json();
    const media = await fetch(`${api}/drive/v3/files/${file.id}?alt=media&fields=id`, { headers: { ...auth, Range: 'bytes=3-6' } });
    const refused = await fetch(`${api}/drive/v3/about?fields=storageQuota`, { headers: { Authorization: 'Bearer wrong' } });
    return {
      token,
      account: me.user.permissionId,
      whoAmIStatus: whoAmI.status,
      sessionFound: session.includes('upload_id='),
      partialStatus: partial.status,
      partialRange: partial.headers.get('Range'),
      fileId: String(file.id),
      mediaStatus: media.status,
      mediaText: await media.text(),
      refusedStatus: refused.status,
    };
  });

  expect(result).toMatchObject({
    token: 'test-token',
    account: '01234567890123456789',
    whoAmIStatus: 401,
    sessionFound: true,
    partialStatus: 308,
    partialRange: 'bytes=0-4',
    mediaStatus: 206,
    mediaText: 'lowo',
    refusedStatus: 401,
  });
  expect(new TextDecoder().decode(drive.contentOf(result.fileId) ?? new Uint8Array())).toBe('helloworld');
});
