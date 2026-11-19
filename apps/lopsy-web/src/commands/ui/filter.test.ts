import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openLiquify: vi.fn(),
  beginTiltShiftSession: vi.fn(),
  isFilteringMask: vi.fn(() => false),
}));

vi.mock('../../app/MenuBar/liquify-actions', () => ({ openLiquify: mocks.openLiquify }));
vi.mock('../../app/MenuBar/tilt-shift-actions', () => ({ beginTiltShiftSession: mocks.beginTiltShiftSession }));
vi.mock('../../app/MenuBar/filter-target', () => ({ isFilteringMask: mocks.isFilteringMask }));

const { getCommand, runCommand } = await import('../registry');
await import('./filter');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFilteringMask.mockReturnValue(false);
});

describe('ui.filter.* commands', () => {
  it.each([
    ['ui.filter.liquify', () => mocks.openLiquify],
    ['ui.filter.tilt-shift', () => mocks.beginTiltShiftSession],
  ] as const)('%s starts its session in the synchronous part', async (id, wrapped) => {
    const pending = runCommand(id);
    expect(wrapped()).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toBeUndefined();
  });

  it.each(['ui.filter.liquify', 'ui.filter.tilt-shift'])('%s is disabled exactly while filters target a mask', (id) => {
    const command = getCommand(id)!;
    expect(command.enabled?.({})).toBe(true);
    mocks.isFilteringMask.mockReturnValue(true);
    expect(command.enabled?.({})).toBe(false);
  });
});
