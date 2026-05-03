import { create } from 'zustand';
import type { Action, ActionStep } from '../../actions/action-types';
import { setRecorder } from '../../actions/recording-hook';
import {
  applyGenericFilter,
  applyInvert,
  applyDesaturate,
} from '../MenuBar/filter-actions';

const STORAGE_KEY = 'lopsy-actions';

function loadActionsFromStorage(): Action[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Action[];
  } catch {
    return [];
  }
}

function saveActionsToStorage(actions: Action[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // localStorage unavailable — ignore
  }
}

async function dispatchStep(step: ActionStep): Promise<void> {
  switch (step.type) {
    case 'filter': {
      const params = step.params as Record<string, number>;
      if (step.filter === 'invert') {
        applyInvert();
      } else if (step.filter === 'desaturate') {
        applyDesaturate();
      } else {
        applyGenericFilter(step.filter as Parameters<typeof applyGenericFilter>[0], params);
      }
      break;
    }
    case 'adjustment':
      // Adjustments are live-applied via group settings; playback is a no-op
      // for now since adjustments are document-persistent, not step-based.
      break;
    case 'selection':
      // Selection operations are context-dependent; playback is a no-op.
      break;
    case 'layer':
      // Layer operations are context-dependent; playback is a no-op.
      break;
  }
}

interface ActionStoreState {
  actions: Action[];
  isRecording: boolean;
  currentRecordingSteps: ActionStep[];

  startRecording: () => void;
  stopRecording: (name: string) => void;
  cancelRecording: () => void;
  addStep: (step: ActionStep) => void;
  playAction: (actionId: string) => Promise<void>;
  deleteAction: (actionId: string) => void;
}

export const useActionStore = create<ActionStoreState>((set, get) => {
  // Wire the recording hook so filter-actions can emit steps.
  setRecorder((step) => {
    if (get().isRecording) {
      set((s) => ({ currentRecordingSteps: [...s.currentRecordingSteps, step] }));
    }
  });

  return {
    actions: loadActionsFromStorage(),
    isRecording: false,
    currentRecordingSteps: [],

    startRecording: () => {
      set({ isRecording: true, currentRecordingSteps: [] });
    },

    stopRecording: (name: string) => {
      const { currentRecordingSteps, actions } = get();
      if (currentRecordingSteps.length === 0) {
        set({ isRecording: false, currentRecordingSteps: [] });
        return;
      }
      const newAction: Action = {
        id: crypto.randomUUID(),
        name: name.trim() || `Action ${actions.length + 1}`,
        steps: currentRecordingSteps,
      };
      const updated = [...actions, newAction];
      saveActionsToStorage(updated);
      set({ isRecording: false, currentRecordingSteps: [], actions: updated });
    },

    cancelRecording: () => {
      set({ isRecording: false, currentRecordingSteps: [] });
    },

    addStep: (step: ActionStep) => {
      if (!get().isRecording) return;
      set((s) => ({ currentRecordingSteps: [...s.currentRecordingSteps, step] }));
    },

    playAction: async (actionId: string) => {
      const action = get().actions.find((a) => a.id === actionId);
      if (!action) return;
      for (const step of action.steps) {
        await dispatchStep(step);
        // Small delay between steps so history/GPU state can settle.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    },

    deleteAction: (actionId: string) => {
      const updated = get().actions.filter((a) => a.id !== actionId);
      saveActionsToStorage(updated);
      set({ actions: updated });
    },
  };
});
