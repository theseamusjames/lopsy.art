import { create } from 'zustand';
import { createViewportSlice } from './store/viewport-slice';
import { createSelectionSlice } from './store/selection-slice';
import { createPixelDataSlice } from './store/pixel-data-slice';
import { createHistorySlice } from './store/history-slice';
import { createClipboardSlice } from './store/clipboard-slice';
import { createDocumentSlice } from './store/document-slice';
import type { EditorState } from './store/types';

export type { EditorState };

export const useEditorStore = create<EditorState>((...a) => ({
  ...createViewportSlice(...a),
  ...createSelectionSlice(...a),
  ...createPixelDataSlice(...a),
  ...createHistorySlice(...a),
  ...createClipboardSlice(...a),
  ...createDocumentSlice(...a),
}));
