/**
 * The Google Picker, for adopting files the app cannot see under the
 * drive.file scope (spec 6.5). Browser only. Resolves with the picked
 * file IDs, or an empty list when the user cancels.
 */

import { loadScript, readGlobal } from '../../auth/load-script';
import { StorageError } from '../errors';

const GAPI_SCRIPT_URL = 'https://apis.google.com/js/api.js';
/** google.picker.Action.ERROR ("error"), compared by value: older loaders may not define it on the enum. */
const PICKER_ERROR = 'error';

export interface PickDriveFilesOptions {
  /** API key restricted to the app's origin. */
  readonly developerKey: string;
  /** The Cloud project number. */
  readonly appId: string;
  readonly oauthToken: string;
  /** Limit to these MIME types (comma-joined for the Picker). */
  readonly mimeTypes?: readonly string[];
  readonly multiselect?: boolean;
  readonly title?: string;
}

interface DocsView {
  setMimeTypes(mimeTypes: string): DocsView;
  setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled(enabled: boolean): DocsView;
}

interface Picker {
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface PickerResult {
  readonly action?: string;
  readonly docs?: readonly { readonly id?: string }[];
}

interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (result: PickerResult) => void): PickerBuilder;
  build(): Picker;
}

interface PickerNamespace {
  readonly DocsView: new (viewId?: string) => DocsView;
  readonly PickerBuilder: new () => PickerBuilder;
  readonly ViewId: { readonly DOCS: string };
  readonly Feature: { readonly MULTISELECT_ENABLED: string };
  readonly Action: { readonly PICKED: string; readonly CANCEL: string };
}

function isPickerNamespace(value: unknown): value is PickerNamespace {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'DocsView') === 'function' &&
    typeof Reflect.get(value, 'PickerBuilder') === 'function' &&
    typeof Reflect.get(value, 'ViewId') === 'object' &&
    typeof Reflect.get(value, 'Feature') === 'object' &&
    typeof Reflect.get(value, 'Action') === 'object'
  );
}

async function loadPicker(): Promise<PickerNamespace> {
  const existing = readGlobal('google.picker');
  if (isPickerNamespace(existing)) return existing;
  await loadScript(GAPI_SCRIPT_URL);
  const load = readGlobal('gapi.load');
  if (typeof load !== 'function') throw new StorageError('unknown', 'The Google API loader did not load');
  await new Promise<void>((resolve, reject) => {
    Reflect.apply(load, readGlobal('gapi'), ['picker', { callback: () => resolve(), onerror: () => reject(new Error('Picker failed to load')) }]);
  });
  const picker = readGlobal('google.picker');
  if (!isPickerNamespace(picker)) throw new StorageError('unknown', 'The Google Picker did not load');
  return picker;
}

export async function pickDriveFiles(options: PickDriveFilesOptions): Promise<string[]> {
  let api: PickerNamespace;
  try {
    api = await loadPicker();
  } catch (error) {
    throw new StorageError('network', 'Could not load the Google Picker', { cause: error });
  }
  const view = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
  if (options.mimeTypes && options.mimeTypes.length > 0) view.setMimeTypes(options.mimeTypes.join(','));
  return new Promise<string[]>((resolve, reject) => {
    let builder = new api.PickerBuilder()
      .addView(view)
      .setAppId(options.appId)
      .setOAuthToken(options.oauthToken)
      .setDeveloperKey(options.developerKey);
    if (options.multiselect ?? true) builder = builder.enableFeature(api.Feature.MULTISELECT_ENABLED);
    if (options.title) builder = builder.setTitle(options.title);
    const picker = builder
      .setCallback((result) => {
        if (result.action === api.Action.PICKED) {
          picker.dispose();
          resolve((result.docs ?? []).map((doc) => doc.id).filter((id): id is string => typeof id === 'string'));
        } else if (result.action === api.Action.CANCEL) {
          picker.dispose();
          resolve([]);
        } else if (result.action === PICKER_ERROR) {
          // Most often the API key's referrer list lacks https://docs.google.com/*, where the Picker's iframe runs.
          picker.dispose();
          reject(new StorageError('invalid', 'The Google Picker reported an error'));
        }
      })
      .build();
    picker.setVisible(true);
  });
}
