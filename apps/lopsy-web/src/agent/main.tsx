import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentApp } from './AgentApp';
import { createLopsyApi, type LopsyApi } from './lopsy-api';
import { describeCommands, runInvocation, runInvocations } from '../commands';
import { initWasm } from '../engine-wasm/wasm-bridge';
import { useUIStore } from '../app/ui-store';
import { installDevHooks } from '../dev-hooks';
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/reset.css';

declare global {
  interface Window {
    /** The command API, on the agent page only, in every build. */
    lopsy?: LopsyApi;
  }
}

// The same test hooks as the editor (dev builds only), so the API specs run on both pages.
installDevHooks();

window.lopsy = createLopsyApi({ describe: describeCommands, runInvocation, runAll: runInvocations });

// The rulers are editor chrome drawn over the canvas; this page shows the image alone. Nothing a
// document command does or returns reads them (view.render and doc.export never include them).
useUIStore.setState({ showRulers: false });

initWasm().catch(() => {});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <AgentApp />
  </StrictMode>,
);
