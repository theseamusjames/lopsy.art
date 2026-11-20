import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initWasm } from './engine-wasm/wasm-bridge';
import { prefetchFontPreviewsBlob } from './utils/font-loader';
import { installDevHooks } from './dev-hooks';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/reset.css';

installDevHooks();

// Prevent browser zoom so Ctrl+wheel and pinch gestures only affect the canvas.
// Register at window + capture phase so nothing can stop propagation first.
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false, capture: true });
window.addEventListener('gesturestart', (e) => e.preventDefault(), { capture: true });
window.addEventListener('gesturechange', (e) => e.preventDefault(), { capture: true });
window.addEventListener('gestureend', (e) => e.preventDefault(), { capture: true });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
    e.preventDefault();
  }
}, { capture: true });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

initWasm().catch(() => {});

// Kick off the font-preview blob download after the app is interactive so the
// FontPicker's first open finds it ready.
const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  ?? ((cb: () => void) => setTimeout(cb, 0));
idle(() => prefetchFontPreviewsBlob());

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
