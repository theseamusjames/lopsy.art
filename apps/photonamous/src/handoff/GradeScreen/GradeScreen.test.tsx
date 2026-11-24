// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { GradeSession } from '@lopsy/handoff/grade';
import type { GradeLayer } from '@lopsy/handoff/messages';
import { useToasts } from '../../app/toasts';
import { GradeScreen } from './GradeScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeEditViewProps {
  readonly version: { readonly recipe: Recipe };
  readonly onClose: () => void;
  readonly onDone: (renderPng16: () => Promise<ArrayBuffer>, recipe: Recipe) => void;
}

/** What the fake Edit view's Done renders with; each test sets it. */
let render: () => Promise<ArrayBuffer> = () => Promise.resolve(new ArrayBuffer(8));

vi.mock('../../edit/EditView/EditView', () => ({
  EditView: ({ version, onClose, onDone }: FakeEditViewProps) => (
    <div data-testid="edit-view">
      <button type="button" onClick={() => onDone(render, version.recipe)}>
        Done
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  ),
}));

const layer: GradeLayer = { name: 'Layer 1', width: 1, height: 1, pixels: new ArrayBuffer(8) } as unknown as GradeLayer;

function fakeSession(done: GradeSession['done']): GradeSession & { cancels: number; fails: string[] } {
  const session = {
    id: 'g1',
    layer: Promise.resolve(layer),
    cancels: 0,
    fails: [] as string[],
    done,
    cancel: () => {
      session.cancels += 1;
    },
    fail: (error: string) => {
      session.fails.push(error);
    },
  };
  return session;
}

let root: Root | null = null;
let host: HTMLElement;

async function mount(session: GradeSession, onFinished: () => void): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<GradeScreen session={session} onFinished={onFinished} />);
    await session.layer;
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

beforeEach(() => {
  act(() => useToasts.setState({ toasts: [] }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe('GradeScreen', () => {
  it('Cancel while Done renders keeps the Edit view until the render answers, then sends nothing', async () => {
    let answer: (png: ArrayBuffer) => void = () => undefined;
    render = () =>
      new Promise<ArrayBuffer>((resolve) => {
        answer = resolve;
      });
    const done = vi.fn(() => true);
    const session = fakeSession(done);
    const onFinished = vi.fn();
    await mount(session, onFinished);
    act(() => button('Done').click());
    act(() => button('Cancel').click());
    // The render is still out: its engine must not be freed under it.
    expect(host.querySelector('[data-testid="edit-view"]')).not.toBeNull();
    expect(onFinished).not.toHaveBeenCalled();
    await act(async () => {
      answer(new ArrayBuffer(8));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(done).not.toHaveBeenCalled();
    expect(session.cancels).toBe(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Cancelled');
  });

  it('a throw while sending clears the busy state and shows the error toast', async () => {
    render = () => Promise.resolve(new ArrayBuffer(8));
    const done = vi.fn((): boolean => {
      throw new Error('the port is closed');
    });
    const session = fakeSession(done);
    const onFinished = vi.fn();
    await mount(session, onFinished);
    await act(async () => {
      button('Done').click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(useToasts.getState().toasts.map((t) => t.message).join(' ')).toContain('the port is closed');
    expect(onFinished).not.toHaveBeenCalled();
    // Not busy any more: Done can be tried again.
    await act(async () => {
      button('Done').click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(done).toHaveBeenCalledTimes(2);
  });
});
