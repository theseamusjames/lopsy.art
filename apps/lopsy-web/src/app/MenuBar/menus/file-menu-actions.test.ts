// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn<() => Promise<void>>(),
  notifyError: vi.fn(),
}));

vi.mock('../../../io/project-save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../io/project-save')>()),
  saveProject: mocks.saveProject,
}));
vi.mock('../../notifications-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../notifications-store')>()),
  notifyError: mocks.notifyError,
}));

const { useEditorStore } = await import('../../editor-store');
const { useUIStore } = await import('../../ui-store');
const { saveProjectFromMenu, startNewDocument } = await import('./file-menu');

beforeEach(() => {
  useUIStore.getState().setShowNewDocumentModal(false);
  mocks.saveProject.mockReset();
  mocks.notifyError.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('File > New (startNewDocument)', () => {
  it('opens the New Document modal without asking when nothing is unsaved', () => {
    const confirm = vi.spyOn(window, 'confirm');
    useEditorStore.setState({ isDirty: false });
    startNewDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(useUIStore.getState().modal?.kind === 'newDocument').toBe(true);
  });

  it('asks first with unsaved changes, and opens the modal only on OK', () => {
    useEditorStore.setState({ isDirty: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    startNewDocument();
    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Are you sure you want to continue?');
    expect(useUIStore.getState().modal?.kind === 'newDocument').toBe(false);

    confirm.mockReturnValue(true);
    startNewDocument();
    expect(useUIStore.getState().modal?.kind === 'newDocument').toBe(true);
  });
});

describe('File > Save Project (saveProjectFromMenu)', () => {
  it('starts the save in the caller\'s tick and toasts nothing when it succeeds', async () => {
    mocks.saveProject.mockResolvedValue(undefined);
    saveProjectFromMenu();
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('toasts "Save failed: ..." once when the save fails', async () => {
    mocks.saveProject.mockRejectedValue(new Error('disk full'));
    saveProjectFromMenu();
    await vi.waitFor(() => expect(mocks.notifyError).toHaveBeenCalledTimes(1));
    expect(mocks.notifyError.mock.calls[0]?.[0]).toMatch(/^Save failed: .*disk full/);
  });
});
