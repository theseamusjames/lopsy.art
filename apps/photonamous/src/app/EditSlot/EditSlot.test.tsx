// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetId, NewAsset, VersionId } from '@lopsy/photos-core/library/types';
import { DEFAULT_RECIPE, PIPELINE_VERSION } from '@lopsy/photos-core/library/recipe';
import type { EditViewProps } from '../../edit/EditView/EditView';
import { versionItemId } from '../../library/items';
import { setBackend } from '../backend-registry';
import { FakeBackend } from '../fake/fake-backend';
import { FakeSession } from '../fake/fake-session';
import { openInLopsy } from '../lopsy-handoff';
import { useUi } from '../store';
import { EditSlot } from './EditSlot';

// The Edit view needs the engine; here it only records what EditSlot hands it.
const rendered = vi.hoisted(() => ({ props: null as EditViewProps | null }));
vi.mock('../../edit/EditView/EditView', () => ({
  EditView: (props: EditViewProps) => {
    rendered.props = props;
    return <div data-testid="edit-view" />;
  },
}));
vi.mock('../lopsy-handoff', () => ({ openInLopsy: vi.fn() }));
vi.mock('../preview-cache', () => ({ peekPreviewUrl: () => undefined, loadPreviewUrl: () => new Promise<string>(() => undefined) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FACTS = {
  fileId: 'file',
  sha256: 'sha',
  byteSize: 1000,
  capturedAt: null,
  importId: 'import',
  width: 600,
  height: 400,
  orientation: 1,
  camera: null,
  lens: null,
  exposure: null,
  gps: null,
  pairedWith: null,
  source: null,
  renderFileId: null,
} as const;

/** Newest first in the grid: `day` orders them. */
const photo = (fileName: string, day: number): NewAsset => ({
  ...FACTS,
  kind: 'original',
  fileName,
  format: 'jpeg',
  mimeType: 'image/jpeg',
  importedAt: `2026-01-0${day}T00:00:00Z`,
});
const lopsyDocument = (fileName: string, day: number): NewAsset => ({
  ...photo(fileName, day),
  kind: 'document',
  format: 'lopsy',
  mimeType: 'application/x-lopsy',
});

let session: FakeSession;
let root: Root | null = null;
let host: HTMLElement;
const onClose = vi.fn();

function show(assetId: AssetId, versionId: VersionId): void {
  act(() => root?.render(<EditSlot assetId={assetId} versionId={versionId} onClose={onClose} />));
}

beforeEach(() => {
  setBackend(new FakeBackend(0));
  session = new FakeSession('memory', 'Test');
  act(() => {
    useUi.getState().setConnection({ session, accountLabel: 'Test' });
    useUi.setState({ expandedBursts: new Set() });
  });
  rendered.props = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => useUi.getState().setConnection(null));
  onClose.mockClear();
  vi.mocked(openInLopsy).mockClear();
  await session.close();
});

describe('the Edit view’s filmstrip', () => {
  it('leaves Lopsy documents out and shows a photo’s open versions as their own tiles', () => {
    const a = session.addAsset(photo('a.jpg', 3));
    const poster = session.addAsset(lopsyDocument('poster.lopsy', 2));
    const b = session.addAsset(photo('b.jpg', 1));
    const second = session.createVersion(a.assetId, 'Version 2');
    // The photo's stack is open in the grid: a, its Version 2, the document, b.
    act(() => useUi.getState().toggleBurst(a.assetId));
    show(a.assetId, a.versionId);

    const strip = rendered.props?.filmstrip;
    expect(strip?.items.map((i) => [i.id, i.label])).toEqual([
      [a.assetId, 'a.jpg'],
      [versionItemId(a.assetId, second), 'a.jpg (Version 2)'],
      [b.assetId, 'b.jpg'],
    ]);
    expect(strip?.items.some((i) => i.id === poster.assetId)).toBe(false);
    expect(strip?.currentId).toBe(a.assetId);

    // A version's tile opens that version, and is the one marked while it is open.
    act(() => strip?.onOpen(versionItemId(a.assetId, second)));
    expect(useUi.getState().editing).toEqual({ assetId: a.assetId, versionId: second });
    show(a.assetId, second);
    expect(rendered.props?.filmstrip?.currentId).toBe(versionItemId(a.assetId, second));
  });

  it('never opens a document, even when asked for one by id', () => {
    const a = session.addAsset(photo('a.jpg', 3));
    const poster = session.addAsset(lopsyDocument('poster.lopsy', 2));
    session.addAsset(photo('b.jpg', 1));
    show(a.assetId, a.versionId);
    act(() => rendered.props?.filmstrip?.onOpen(poster.assetId));
    expect(useUi.getState().editing).toBeNull();
  });
});

describe('a Lopsy document with its flattened render', () => {
  it('opens in the Edit view like a photo', () => {
    const poster = session.addAsset({ ...lopsyDocument('poster.lopsy', 2), renderFileId: 'render-poster' });
    show(poster.assetId, poster.versionId);
    expect(rendered.props?.asset.id).toBe(poster.assetId);
    expect(rendered.props?.version.id).toBe(poster.versionId);
  });
});

describe('a Lopsy document saved without a render, asked for in the Edit view', () => {
  function showPoster(): AssetId {
    const poster = session.addAsset(lopsyDocument('DSCF8534 (1).lopsy', 2));
    show(poster.assetId, poster.versionId);
    return poster.assetId;
  }

  it('says what it is instead of opening the Edit view, with focus on its name', () => {
    showPoster();
    expect(host.querySelector('[data-testid="edit-view"]')).toBeNull();
    expect(rendered.props).toBeNull();
    const heading = host.querySelector('h1');
    expect(heading?.textContent).toBe('DSCF8534 (1).lopsy');
    expect(document.activeElement).toBe(heading);
    expect(host.textContent).toContain('This Lopsy document was saved without a flattened picture to edit here.');
    expect(document.title).toBe('DSCF8534 (1).lopsy – Lopsy document – Photonamous');
  });

  it('opens it in Lopsy from the click, and goes back to the library', () => {
    const id = showPoster();
    const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Open in Lopsy');
    act(() => open?.click());
    expect(openInLopsy).toHaveBeenCalledWith(session, id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes back with its button or Escape', () => {
    showPoster();
    const back = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Back');
    act(() => back?.click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(openInLopsy).not.toHaveBeenCalled();
  });
});

describe('a version edited with a newer pipeline than this build’s', () => {
  function showNewer(): void {
    const { assetId } = session.addAsset(photo('DSCF0001.RAF', 1));
    const versionId = session.createVersion(assetId, 'Newer', { ...DEFAULT_RECIPE, pipeline: PIPELINE_VERSION + 1 });
    show(assetId, versionId);
  }

  it('is not opened in the Edit view: a plain message says the app needs updating', () => {
    showNewer();
    expect(rendered.props).toBeNull();
    expect(host.querySelector('[data-testid="edit-view"]')).toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('DSCF0001.RAF');
    expect(host.textContent).toContain('This version was edited with a newer version of Photonamous');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Reload', 'Back']);
  });

  it('goes back without changing the version', () => {
    showNewer();
    const before = session.getView();
    act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Back')?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(session.getView()).toBe(before);
  });

  it('opens a version of this build’s pipeline as before', () => {
    const { assetId, versionId } = session.addAsset(photo('DSCF0002.RAF', 2));
    show(assetId, versionId);
    expect(rendered.props?.version.id).toBe(versionId);
  });
});
