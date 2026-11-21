// @vitest-environment jsdom
import '../test/canvas-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ engine: null as object | null, isContextLost: false }));

vi.mock('../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine, isGpuContextLost: () => mocks.isContextLost };
});

const { CommandError } = await import('./command');
const { useUIStore } = await import('../app/ui-store');
const { setLivePreviewShowing } = await import('../app/live-preview');
const { createRegistry } = await import('./registry');
const { CANVAS_DRAG_MESSAGE, LIVE_PREVIEW_MESSAGE, apiPreflight, personActivityPreflight } = await import('./preflight');

function refusal(fn: () => void): { code: string; message: string } | null {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    const { code, message } = error as InstanceType<typeof CommandError>;
    return { code, message };
  }
  return null;
}

function setHeld(isHeld: boolean): void {
  useUIStore.getState().setIsInteracting(isHeld);
}

afterEach(() => {
  mocks.engine = null;
  mocks.isContextLost = false;
  setLivePreviewShowing(false);
  setHeld(false);
});

describe('personActivityPreflight', () => {
  it('lets a call through when the person is doing neither', () => {
    expect(refusal(personActivityPreflight)).toBeNull();
    expect(refusal(apiPreflight)).toBeNull();
  });

  it('refuses unavailable while a live preview is showing', () => {
    setLivePreviewShowing(true);
    expect(refusal(personActivityPreflight)).toEqual({ code: 'unavailable', message: LIVE_PREVIEW_MESSAGE });
    setLivePreviewShowing(false);
    expect(refusal(personActivityPreflight)).toBeNull();
  });

  it('refuses unavailable while a press on the canvas is held', () => {
    setHeld(true);
    expect(refusal(personActivityPreflight)).toEqual({ code: 'unavailable', message: CANVAS_DRAG_MESSAGE });
    setHeld(false);
    expect(refusal(personActivityPreflight)).toBeNull();
  });

  it('refuses with the preview\'s message when both are true', () => {
    setLivePreviewShowing(true);
    setHeld(true);
    expect(refusal(personActivityPreflight)).toEqual({ code: 'unavailable', message: LIVE_PREVIEW_MESSAGE });
  });

  it('says what the person is doing, that nothing was run, and that the call can be sent again', () => {
    expect(LIVE_PREVIEW_MESSAGE).toContain('live preview');
    expect(CANVAS_DRAG_MESSAGE).toContain('drag');
    for (const message of [LIVE_PREVIEW_MESSAGE, CANVAS_DRAG_MESSAGE]) {
      expect(message).toContain('Nothing was run');
      expect(message).toContain('Send the call again');
    }
  });
});

describe('apiPreflight', () => {
  it('still refuses a lost graphics context, ahead of what the person is doing', () => {
    mocks.engine = {};
    mocks.isContextLost = true;
    expect(refusal(apiPreflight)?.message).toContain('graphics context is lost');
    setLivePreviewShowing(true);
    setHeld(true);
    expect(refusal(apiPreflight)).toMatchObject({ code: 'unavailable', message: expect.stringContaining('graphics context is lost') });
  });

  it('refuses for the person once the context is back', () => {
    mocks.engine = {};
    setHeld(true);
    expect(refusal(apiPreflight)).toEqual({ code: 'unavailable', message: CANVAS_DRAG_MESSAGE });
  });
});

describe('apiPreflight in a registry', () => {
  function registryWithSteps(ran: string[]) {
    const registry = createRegistry();
    registry.setPreflight(apiPreflight);
    registry.define({
      id: 'layer.add',
      summary: 'Adds a layer.',
      surface: 'document',
      params: {},
      run: () => {
        ran.push('add');
        return ran.length;
      },
    });
    registry.define({
      id: 'paint.stroke',
      summary: 'Presses and releases, as runGesture does.',
      surface: 'document',
      params: {},
      run: () => {
        setHeld(true);
        ran.push('stroke');
        setHeld(false);
      },
    });
    registry.define({
      id: 'layer.grab',
      summary: 'Leaves the canvas held, as a person pressing during a batch.',
      surface: 'document',
      params: {},
      run: () => {
        ran.push('grab');
        setHeld(true);
      },
    });
    return registry;
  }

  it('does not refuse a batch\'s next step for the previous step\'s own released press', async () => {
    const ran: string[] = [];
    const registry = registryWithSteps(ran);
    await expect(registry.runAll([{ op: 'paint.stroke' }, { op: 'paint.stroke' }, { op: 'layer.add' }])).resolves.toEqual([undefined, undefined, 3]);
  });

  it('checks each batch step as it starts, and a refusal mid-batch carries completed and the index', async () => {
    const ran: string[] = [];
    const registry = registryWithSteps(ran);
    const error: unknown = await registry.runAll([{ op: 'layer.add' }, { op: 'layer.grab' }, { op: 'layer.add' }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({ code: 'unavailable', completed: [1, undefined], message: `[2] layer.add: ${CANVAS_DRAG_MESSAGE}` });
    expect(ran).toEqual(['add', 'grab']);
  });

  it('refuses run and runInvocation, never start, the UI path', async () => {
    const ran: string[] = [];
    const registry = registryWithSteps(ran);
    setLivePreviewShowing(true);
    await expect(registry.run('layer.add')).rejects.toMatchObject({ code: 'unavailable', message: LIVE_PREVIEW_MESSAGE });
    await expect(registry.runInvocation({ op: 'layer.add' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(ran).toEqual([]);
    await registry.start('layer.add', {}, { settle: false });
    expect(ran).toEqual(['add']);
  });
});
