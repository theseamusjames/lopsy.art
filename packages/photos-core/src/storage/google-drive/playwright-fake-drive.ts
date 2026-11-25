/**
 * Browser e2e harness: serves the fake Drive to a page through Playwright
 * routing and stubs Google Identity Services, so the real GoogleDriveAdapter
 * and GoogleTokenSource run in the browser without touching Google.
 *
 * Runs in the Playwright (Node) process. Imports Playwright's types only,
 * so photos-core has no runtime dependency on it.
 *
 *   const drive = await routeFakeDrive(page);
 *   await routeDrivePicker(context, () => ({ fileIds: [id] })); // Add from Google Drive
 *   await page.addInitScript(gisStubInitScript());
 *   await page.goto(appUrl);
 *   // ...drive the UI, then inspect drive.requests or drive.contentOf(id)
 */

import type { BrowserContext, Page, Route } from '@playwright/test';
import { createFakeDrive, type FakeDrive } from './fake-drive';

/** Every Google API host the adapter, the token source and sign-out talk to. */
export const GOOGLE_API_URL = /^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//;

type FulfillBody = NonNullable<Parameters<Route['fulfill']>[0]>['body'];

/** Hop-by-hop and browser-managed headers a fetch Request should not be built with. */
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'origin', 'referer']);

/**
 * Routes googleapis.com (the Drive API and uploads) to `drive`, and
 * answers token revocation at oauth2.googleapis.com. Returns the drive so
 * a test can inspect it or inject failures.
 */
export async function routeFakeDrive(target: BrowserContext | Page, drive: FakeDrive = createFakeDrive({ cors: true })): Promise<FakeDrive> {
  await target.route(GOOGLE_API_URL, (route) => serve(route, drive));
  return drive;
}

async function serve(route: Route, drive: FakeDrive): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  if (url.hostname === 'oauth2.googleapis.com') {
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
    return;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(await request.allHeaders())) {
    if (!name.startsWith(':') && !DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  const raw = request.postDataBuffer();
  const body = raw && method !== 'GET' && method !== 'HEAD' ? new Uint8Array(raw) : null;
  let response: Response;
  try {
    response = await drive.handle(new Request(url, { method, headers, body }));
  } catch {
    // The fake throws TypeError to simulate a dropped connection.
    await route.abort('connectionreset');
    return;
  }
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name] = value;
  });
  await route.fulfill({
    status: response.status,
    headers: responseHeaders,
    body: toNodeBuffer(new Uint8Array(await response.arrayBuffer())),
  });
}

/**
 * A script for page.addInitScript that stands in for Google's Picker in
 * the page (picker.ts): `google.picker`, so the real script is never
 * loaded. Showing it adds `#fake-google-picker` to the page and nothing
 * more, which is also what a Picker stuck on Google's sign-in page looks
 * like from outside. A test answers for the user through
 * `window.__lopsyPickerStub`: `pick(ids)` or `cancel()`; `shown` and
 * `disposed` count.
 */
export function pickerStubInitScript(): string {
  return `(() => {
  const stub = {
    shown: 0,
    disposed: 0,
    callback: null,
    pick(ids) { if (stub.callback) stub.callback({ action: 'picked', docs: ids.map((id) => ({ id })) }); },
    cancel() { if (stub.callback) stub.callback({ action: 'cancel' }); },
  };
  window.__lopsyPickerStub = stub;
  class DocsView {
    setMimeTypes() { return this; }
    setIncludeFolders() { return this; }
    setSelectFolderEnabled() { return this; }
  }
  class PickerBuilder {
    addView() { return this; }
    enableFeature() { return this; }
    setAppId() { return this; }
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setTitle() { return this; }
    setCallback(callback) { stub.callback = callback; return this; }
    build() {
      return {
        setVisible(visible) {
          if (!visible) return;
          stub.shown++;
          const frame = document.createElement('div');
          frame.id = 'fake-google-picker';
          frame.setAttribute('role', 'dialog');
          frame.setAttribute('aria-label', 'Google Picker');
          frame.textContent = 'Sign in to your Google Account';
          document.body.appendChild(frame);
        },
        dispose() {
          stub.disposed++;
          const frame = document.getElementById('fake-google-picker');
          if (frame) frame.remove();
        },
      };
    }
  }
  const picker = { DocsView, PickerBuilder, ViewId: { DOCS: 'all' }, Feature: { MULTISELECT_ENABLED: 'multiselectEnabled' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } };
  window.google = Object.assign(window.google || {}, { picker });
})();`;
}

/** Google's authorization page. With `trigger_onepick` it is the Picker in a window (picker-window.ts). */
export const GOOGLE_PICKER_URL = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

/**
 * Stands in for Google's Picker page. The pop-up is sent straight back to
 * the redirect URI the app named, as Google sends it once the user has
 * picked: with the app's `state`, and the file IDs `answer` returns or its
 * error (`access_denied` is what a refusal looks like). Route it on the
 * context, since the pop-up is a page of its own. Returns the URLs the
 * app opened, as they arrive.
 */
export async function routeDrivePicker(
  target: BrowserContext | Page,
  answer: () => { readonly fileIds?: readonly string[]; readonly error?: string },
): Promise<string[]> {
  const opened: string[] = [];
  await target.route(GOOGLE_PICKER_URL, async (route) => {
    const asked = new URL(route.request().url());
    opened.push(asked.href);
    const back = new URL(asked.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('state', asked.searchParams.get('state') ?? '');
    const { fileIds, error } = answer();
    if (error) {
      back.searchParams.set('error', error);
    } else {
      back.searchParams.set('picked_file_ids', (fileIds ?? []).join(','));
      back.searchParams.set('code', '4/fake-authorization-code');
      back.searchParams.set('scope', asked.searchParams.get('scope') ?? '');
    }
    await route.fulfill({ status: 302, headers: { Location: back.href } });
  });
  return opened;
}

/** Playwright wants a Node Buffer for binary bodies; photos-core has no Node types, so reach it at runtime. */
function toNodeBuffer(bytes: Uint8Array): FulfillBody {
  const buffer: unknown = Reflect.get(globalThis, 'Buffer');
  const from: unknown = typeof buffer === 'function' ? Reflect.get(buffer, 'from') : undefined;
  if (typeof from !== 'function') throw new Error('routeFakeDrive must run in Node');
  return Reflect.apply(from, buffer, [bytes]);
}

/**
 * A script for page.addInitScript that installs a minimal
 * `window.google.accounts.oauth2`: initTokenClient's requestAccessToken
 * calls back with `token`, hasGrantedAllScopes is true, revoke succeeds.
 * GoogleTokenSource then skips loading the real GIS script. The stub also
 * exposes `window.__lopsyGisStub` ({ token, scope, requests }) for tests:
 * `scope` is what the app asked Google for.
 */
export function gisStubInitScript(token = 'test-token'): string {
  return `(() => {
  const stub = { token: ${JSON.stringify(token)}, scope: null, requests: [] };
  window.__lopsyGisStub = stub;
  const oauth2 = {
    initTokenClient(config) {
      stub.scope = config.scope;
      return {
        requestAccessToken(overrides) {
          stub.requests.push(overrides || {});
          setTimeout(() => config.callback({
            access_token: stub.token,
            token_type: 'Bearer',
            expires_in: 3599,
            scope: config.scope,
          }), 0);
        },
      };
    },
    hasGrantedAllScopes() { return true; },
    hasGrantedAnyScope() { return true; },
    revoke(_token, done) { if (done) setTimeout(() => done({ successful: true }), 0); },
  };
  window.google = Object.assign(window.google || {}, { accounts: Object.assign((window.google && window.google.accounts) || {}, { oauth2 }) });
})();`;
}
