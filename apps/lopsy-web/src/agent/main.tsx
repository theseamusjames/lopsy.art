import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentApp } from './AgentApp';
import { createLopsyApi } from '../commands/lopsy-api';
import { dropNotifications } from './drop-notifications';
import { checkWebGL2Support } from '../components/WebGL2Warning/WebGL2Warning';
import { describeCommands, runInvocation, runInvocations } from '../commands';
import { initWasm } from '../engine-wasm/wasm-bridge';
import { useUIStore } from '../app/ui-store';
import { installDevHooks } from '../dev-hooks';
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/reset.css';

// The same test hooks as the editor (dev builds only), so the API specs run on both pages.
installDevHooks();

// One answer for the page and the API: without WebGL2 the page shows its warning, no engine ever
// starts, and every call is answered 'unavailable' at once instead of waiting for one.
const hasWebGL2 = checkWebGL2Support();

window.lopsy = createLopsyApi(
  { describe: describeCommands, runInvocation, runAll: runInvocations },
  { hasWebGL2: () => hasWebGL2 },
);

// The page mounts no Toasts, so nothing would ever dismiss a notification; a refusal's reason
// reaches the caller in the error instead.
dropNotifications();

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
    <AgentApp hasWebGL2={hasWebGL2} />
  </StrictMode>,
);
