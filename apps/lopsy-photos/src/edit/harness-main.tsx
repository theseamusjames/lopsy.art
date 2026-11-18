import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditHarness } from './EditHarness/EditHarness';
import '../styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No #root element');

createRoot(rootElement).render(
  <StrictMode>
    <EditHarness />
  </StrictMode>,
);
