// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ActionStep } from '../../actions/action-types';

// Mock filter-actions so the store can import without a DOM/WASM environment.
vi.mock('../MenuBar/filter-actions', () => ({
  applyGenericFilter: vi.fn(),
  applyInvert: vi.fn(),
  applyDesaturate: vi.fn(),
}));

// Import after mocking.
import { useActionStore } from './action-store';

function resetStore() {
  useActionStore.setState({
    actions: [],
    isRecording: false,
    currentRecordingSteps: [],
  });
}

describe('action-store', () => {
  beforeEach(() => {
    resetStore();
    // Clear localStorage between tests.
    localStorage.clear();
  });

  it('starts with no actions and not recording', () => {
    const { actions, isRecording, currentRecordingSteps } = useActionStore.getState();
    expect(actions).toHaveLength(0);
    expect(isRecording).toBe(false);
    expect(currentRecordingSteps).toHaveLength(0);
  });

  it('startRecording sets isRecording to true and clears current steps', () => {
    useActionStore.getState().startRecording();
    expect(useActionStore.getState().isRecording).toBe(true);
    expect(useActionStore.getState().currentRecordingSteps).toHaveLength(0);
  });

  it('addStep appends a step when recording', () => {
    useActionStore.getState().startRecording();
    const step: ActionStep = { type: 'filter', filter: 'invert', params: {} };
    useActionStore.getState().addStep(step);
    expect(useActionStore.getState().currentRecordingSteps).toHaveLength(1);
    expect(useActionStore.getState().currentRecordingSteps[0]).toEqual(step);
  });

  it('addStep is a no-op when not recording', () => {
    const step: ActionStep = { type: 'filter', filter: 'invert', params: {} };
    useActionStore.getState().addStep(step);
    expect(useActionStore.getState().currentRecordingSteps).toHaveLength(0);
  });

  it('addStep records multiple steps in order', () => {
    useActionStore.getState().startRecording();
    const steps: ActionStep[] = [
      { type: 'filter', filter: 'invert', params: {} },
      { type: 'filter', filter: 'gaussian-blur', params: { radius: 5 } },
      { type: 'filter', filter: 'desaturate', params: {} },
    ];
    for (const step of steps) {
      useActionStore.getState().addStep(step);
    }
    const recorded = useActionStore.getState().currentRecordingSteps;
    expect(recorded).toHaveLength(3);
    expect(recorded[0]).toEqual(steps[0]);
    expect(recorded[1]).toEqual(steps[1]);
    expect(recorded[2]).toEqual(steps[2]);
  });

  it('stopRecording saves an action with the given name', () => {
    useActionStore.getState().startRecording();
    useActionStore.getState().addStep({ type: 'filter', filter: 'invert', params: {} });
    useActionStore.getState().stopRecording('My Action');

    const { actions, isRecording, currentRecordingSteps } = useActionStore.getState();
    expect(isRecording).toBe(false);
    expect(currentRecordingSteps).toHaveLength(0);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.name).toBe('My Action');
    expect(actions[0]!.steps).toHaveLength(1);
  });

  it('stopRecording with empty name auto-generates a name', () => {
    useActionStore.getState().startRecording();
    useActionStore.getState().addStep({ type: 'filter', filter: 'invert', params: {} });
    useActionStore.getState().stopRecording('');

    const { actions } = useActionStore.getState();
    expect(actions[0]!.name).toMatch(/^Action \d+$/);
  });

  it('stopRecording with no steps does not create an action', () => {
    useActionStore.getState().startRecording();
    useActionStore.getState().stopRecording('Empty');

    expect(useActionStore.getState().actions).toHaveLength(0);
    expect(useActionStore.getState().isRecording).toBe(false);
  });

  it('cancelRecording discards steps without saving', () => {
    useActionStore.getState().startRecording();
    useActionStore.getState().addStep({ type: 'filter', filter: 'invert', params: {} });
    useActionStore.getState().cancelRecording();

    expect(useActionStore.getState().isRecording).toBe(false);
    expect(useActionStore.getState().currentRecordingSteps).toHaveLength(0);
    expect(useActionStore.getState().actions).toHaveLength(0);
  });

  it('deleteAction removes the action by id', () => {
    useActionStore.getState().startRecording();
    useActionStore.getState().addStep({ type: 'filter', filter: 'invert', params: {} });
    useActionStore.getState().stopRecording('To Delete');

    const id = useActionStore.getState().actions[0]!.id;
    useActionStore.getState().deleteAction(id);

    expect(useActionStore.getState().actions).toHaveLength(0);
  });

  it('playAction dispatches filter steps via applyInvert', async () => {
    const { applyInvert } = await import('../MenuBar/filter-actions');
    const mockInvert = vi.mocked(applyInvert);
    mockInvert.mockClear();

    useActionStore.getState().startRecording();
    useActionStore.getState().addStep({ type: 'filter', filter: 'invert', params: {} });
    useActionStore.getState().stopRecording('Invert Action');

    const id = useActionStore.getState().actions[0]!.id;
    await useActionStore.getState().playAction(id);

    expect(mockInvert).toHaveBeenCalledOnce();
  });

  it('playAction dispatches generic filter steps via applyGenericFilter', async () => {
    const { applyGenericFilter } = await import('../MenuBar/filter-actions');
    const mockGeneric = vi.mocked(applyGenericFilter);
    mockGeneric.mockClear();

    useActionStore.getState().startRecording();
    useActionStore.getState().addStep({ type: 'filter', filter: 'gaussian-blur', params: { radius: 10 } });
    useActionStore.getState().stopRecording('Blur Action');

    const id = useActionStore.getState().actions[0]!.id;
    await useActionStore.getState().playAction(id);

    expect(mockGeneric).toHaveBeenCalledWith('gaussian-blur', { radius: 10 });
  });

  it('playAction is a no-op for unknown action id', async () => {
    await expect(useActionStore.getState().playAction('nonexistent-id')).resolves.toBeUndefined();
  });
});
