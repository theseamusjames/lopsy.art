import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useEditorStore } from './app/editor-store';
import { useUIStore } from './app/ui-store';
import './styles/tokens.css';
import './styles/reset.css';

// Expose stores for e2e tests
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__editorStore = useEditorStore;
  (window as unknown as Record<string, unknown>).__uiStore = useUIStore;
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
