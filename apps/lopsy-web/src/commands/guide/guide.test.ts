// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./guide');

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function guides() {
  return useUIStore.getState().guides;
}

beforeEach(() => {
  useEditorStore.getState().createDocument(200, 150, false);
  useUIStore.getState().clearGuides();
});

describe('guide commands', () => {
  it('guide.add adds the guide in the synchronous part, with no history, and returns it', async () => {
    const history = useEditorStore.getState().undoStack.length;
    const pending = runCommand('guide.add', { orientation: 'vertical', position: 60.5 });
    expect(guides()).toHaveLength(1);
    const [guide] = guides();
    expect(await pending).toEqual({ id: guide!.id, orientation: 'vertical', position: 60.5 });
    expect(useEditorStore.getState().undoStack.length).toBe(history);
  });

  it('guide.list lists the guides in the order they were added', async () => {
    await runCommand('guide.add', { orientation: 'vertical', position: 10 });
    await runCommand('guide.add', { orientation: 'horizontal', position: 20 });
    const result = (await runCommand('guide.list')) as { guides: Array<{ orientation: string; position: number }> };
    expect(result.guides.map(({ orientation, position }) => [orientation, position])).toEqual([['vertical', 10], ['horizontal', 20]]);
  });

  it('guide.remove takes an id, or an orientation and exact position', async () => {
    const a = (await runCommand('guide.add', { orientation: 'vertical', position: 10 })) as { id: string };
    await runCommand('guide.add', { orientation: 'horizontal', position: 20 });
    expect(await runCommand('guide.remove', { guide: a.id })).toMatchObject({ id: a.id });
    expect(await runCommand('guide.remove', { orientation: 'horizontal', position: 20 })).toMatchObject({ position: 20 });
    expect(guides()).toEqual([]);
  });

  it('guide.remove reports a missing guide and a bad mix of params', async () => {
    await runCommand('guide.add', { orientation: 'vertical', position: 10 });
    expect((await failure(runCommand('guide.remove', { guide: 'nope' }))).code).toBe('not-found');
    expect(await failure(runCommand('guide.remove', { orientation: 'horizontal', position: 10 }))).toMatchObject({
      code: 'not-found', message: 'No horizontal guide is at 10.',
    });
    expect((await failure(runCommand('guide.remove', { orientation: 'vertical' }))).code).toBe('invalid');
    expect((await failure(runCommand('guide.remove', { guide: 'x', position: 10 }))).code).toBe('invalid');
    expect(guides()).toHaveLength(1);
  });

  it('guide.clear removes every guide and refuses when there are none', async () => {
    await runCommand('guide.add', { orientation: 'vertical', position: 10 });
    await runCommand('guide.add', { orientation: 'vertical', position: 30 });
    expect(await runCommand('guide.clear')).toEqual({ removed: 2 });
    expect(guides()).toEqual([]);
    expect(await failure(runCommand('guide.clear'))).toMatchObject({ code: 'refused', message: 'There are no guides to clear.' });
  });

  it('needs a document', async () => {
    useEditorStore.setState({ documentReady: false });
    expect((await failure(runCommand('guide.add', { orientation: 'vertical', position: 1 }))).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: true });
  });
});
