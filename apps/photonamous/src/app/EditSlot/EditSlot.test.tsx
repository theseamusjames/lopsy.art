// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetId, NewAsset, VersionId } from '@lopsy/photos-core/library/types';
import type { EditViewProps } from '../../edit/EditView/EditView';
import { versionItemId } from '../../library/items';
import { setBackend } from '../backend-registry';
import { FakeBackend } from '../fake/fake-backend';
import { FakeSession } from '../fake/fake-session';
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
  await session.close();
});

describe('the Edit view’s filmstrip', () => {
  it('shows a photo’s open versions as their own tiles', () => {
    const a = session.addAsset(photo('a.jpg', 3));
    const b = session.addAsset(photo('b.jpg', 1));
    const second = session.createVersion(a.assetId, 'Version 2');
    // The photo's stack is open in the grid: a, its Version 2, b.
    act(() => useUi.getState().toggleBurst(a.assetId));
    show(a.assetId, a.versionId);

    const strip = rendered.props?.filmstrip;
    expect(strip?.items.map((i) => [i.id, i.label])).toEqual([
      [a.assetId, 'a.jpg'],
      [versionItemId(a.assetId, second), 'a.jpg (Version 2)'],
      [b.assetId, 'b.jpg'],
    ]);
    expect(strip?.currentId).toBe(a.assetId);

    // A version's tile opens that version, and is the one marked while it is open.
    act(() => strip?.onOpen(versionItemId(a.assetId, second)));
    expect(useUi.getState().editing).toEqual({ assetId: a.assetId, versionId: second });
    show(a.assetId, second);
    expect(rendered.props?.filmstrip?.currentId).toBe(versionItemId(a.assetId, second));
  });
});

