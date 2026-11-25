import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileMenu = vi.hoisted(() => ({
  startNewDocument: vi.fn(),
  openFileFromDisk: vi.fn(),
  openProjectFromDisk: vi.fn(),
  saveProjectFromMenu: vi.fn(),
  exportCanvas: vi.fn(),
  exportPsdFile: vi.fn(() => new Promise<void>(() => {})),
}));

vi.mock('../../app/MenuBar/menus/file-menu', () => fileMenu);

const { runCommand } = await import('../registry');
await import('./file');

beforeEach(() => {
  for (const mock of Object.values(fileMenu)) mock.mockClear();
});

describe('ui.file.* commands', () => {
  it.each([
    ['ui.file.new', 'startNewDocument', []],
    ['ui.file.open', 'openFileFromDisk', []],
    ['ui.file.open-project', 'openProjectFromDisk', []],
    ['ui.file.save-project', 'saveProjectFromMenu', []],
    ['ui.file.quick-export-png', 'exportCanvas', ['png']],
  ] as const)('%s calls %s in the synchronous part', async (id, name, args) => {
    const pending = runCommand(id);
    expect(fileMenu[name].mock.calls).toEqual([args]);
    const others = Object.entries(fileMenu).filter(([key]) => key !== name);
    for (const [, mock] of others) expect(mock).not.toHaveBeenCalled();
    await expect(pending).resolves.toBeUndefined();
  });

  it('ui.file.export-psd starts a 16-bit PSD export and, as the menu, does not wait for it', async () => {
    const pending = runCommand('ui.file.export-psd');
    expect(fileMenu.exportPsdFile.mock.calls).toEqual([[16]]);
    await expect(pending).resolves.toBeUndefined();
  });
});
