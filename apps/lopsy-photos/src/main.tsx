import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readGradeId, receiveGrade } from '@lopsy/handoff/grade';
import { App } from './App';
import { GradeScreen } from './handoff/GradeScreen/GradeScreen';
import { lopsyUrl } from './handoff/send-to-lopsy';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No #root element');

// Grade in Lopsy Photos (spec 6.12): a page Lopsy opened with `?grade=<id>`
// is the Edit view on that one layer, before and without any library.
const gradeId = readGradeId(window.location.search);

createRoot(rootElement).render(
  <StrictMode>
    {gradeId ? (
      <GradeScreen session={receiveGrade({ lopsyUrl: lopsyUrl(), id: gradeId })} onFinished={() => window.close()} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
