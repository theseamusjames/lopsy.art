import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewAsset } from '@lopsy/photos-core/library/types';
import { versionItemId } from '../library/items';
import { selectOne } from '../library/selection';
import { openEdit, runCommand } from './commands';
import { FakeSession } from './fake/fake-session';
import { openInLopsy } from './lopsy-handoff';
import { useUi } from './store';

vi.mock('./lopsy-handoff', () => ({ openInLopsy: vi.fn() }));

const FACTS = {
  fileId: 'file',
  sha256: 'sha',
  byteSize: 1000,
  capturedAt: null,
  importedAt: '2026-01-01T00:00:00Z',
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

const photo = (fileName: string): NewAsset => ({ ...FACTS, kind: 'original', fileName, format: 'jpeg', mimeType: 'image/jpeg' });
const lopsyDocument = (fileName: string): NewAsset => ({ ...FACTS, kind: 'document', fileName, format: 'lopsy', mimeType: 'application/x-lopsy' });

let session: FakeSession;

beforeEach(() => {
  session = new FakeSession('memory', 'Test');
  useUi.getState().setConnection({ session, accountLabel: 'Test' });
});

afterEach(async () => {
  useUi.getState().setConnection(null);
  vi.mocked(openInLopsy).mockClear();
  await session.close();
});

describe('Edit (Enter, and Edit in the tile menu and Single view)', () => {
  it('opens the focused photo’s shown version in the Edit view', () => {
    const { assetId, versionId } = session.addAsset(photo('harbour.jpg'));
    useUi.getState().setSelection(selectOne(assetId));
    openEdit();
    expect(useUi.getState().editing).toEqual({ assetId, versionId });
    expect(openInLopsy).not.toHaveBeenCalled();
  });

  it('opens a version’s own tile as that version', () => {
    const { assetId } = session.addAsset(photo('harbour.jpg'));
    const second = session.createVersion(assetId, 'Version 2');
    useUi.getState().setSelection(selectOne(versionItemId(assetId, second)));
    runCommand('open-edit', [assetId, versionItemId(assetId, second)]);
    expect(useUi.getState().editing).toEqual({ assetId, versionId: second });
  });

  it('opens a Lopsy document with its flattened render in the Edit view', () => {
    const { assetId, versionId } = session.addAsset({ ...lopsyDocument('poster.lopsy'), renderFileId: 'render-poster' });
    useUi.getState().setSelection(selectOne(assetId));
    runCommand('open-edit', [assetId]);
    expect(useUi.getState().editing).toEqual({ assetId, versionId });
    expect(openInLopsy).not.toHaveBeenCalled();
  });

  it('sends a Lopsy document saved without a render to Lopsy instead, and leaves the Edit view closed', () => {
    const { assetId } = session.addAsset(lopsyDocument('poster.lopsy'));
    useUi.getState().setSelection(selectOne(assetId));
    runCommand('open-edit', [assetId]);
    expect(openInLopsy).toHaveBeenCalledTimes(1);
    expect(openInLopsy).toHaveBeenCalledWith(session, assetId);
    expect(useUi.getState().editing).toBeNull();
  });

  it('does nothing with nothing focused', () => {
    openEdit();
    expect(useUi.getState().editing).toBeNull();
    expect(openInLopsy).not.toHaveBeenCalled();
  });
});
