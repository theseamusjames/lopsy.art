import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readGradeId, receiveGrade } from '@lopsy/handoff/grade';
import { App } from './App';
import { finishDrivePick, isDrivePickReturn } from './app/real/drive-pick-return';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { GradeScreen } from './handoff/GradeScreen/GradeScreen';
import { lopsyUrl } from './handoff/send-to-lopsy';
import { startTagManager } from './analytics/tag-manager';
import { installCharacterKeyGuard } from './shortcuts/character-keys';
import { registerServiceWorker } from './sw/register';
import './styles/index.css';

function start(): void {
  // Ahead of every other key handler, so turning single-key shortcuts off covers all of them.
  installCharacterKeyGuard(window);

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('No #root element');

  // Grade in Photonamous (spec 6.12): a page Lopsy opened with `?grade=<id>`
  // is the Edit view on that one layer, before and without any library.
  const gradeId = readGradeId(window.location.search);

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        {gradeId ? (
          <GradeScreen session={receiveGrade({ lopsyUrl: lopsyUrl(), id: gradeId })} onFinished={() => window.close()} />
        ) : (
          <App />
        )}
      </ErrorBoundary>
    </StrictMode>,
  );

  registerServiceWorker();
  // Usage statistics, in a build the deploy gave a container ID; never in development or tests.
  startTagManager(import.meta.env.VITE_TAG_MANAGER_ID);
  // The build this page runs is chosen at start-up, so the worker keeps its wasm even if no photo is opened before going offline.
  if (import.meta.env.PROD) {
    import('./engine/develop-engine')
      .then((engine) => engine.prepareEngineForOffline())
      .catch((err: unknown) => console.warn('Photonamous: the engine could not be prepared for offline use', err));
  }
}

// The pop-up of Add from Google Drive, back from Google: it reports what was picked and closes. No app in it.
if (isDrivePickReturn()) finishDrivePick();
else start();
