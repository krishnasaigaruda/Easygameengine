import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useEditor } from './state/editorStore';

// Dev-only handle for debugging from the browser console (stripped from production builds).
if (import.meta.env.DEV) (window as unknown as { __ege: unknown }).__ege = { useEditor };
// Tests drive the assistant's step runner without downloading a model.
if (import.meta.env.DEV) void Promise.all([import('./ai/execute'), import('./ai/model'), import('./ai/training'), import('./ai/pictures')]).then(([run, model, training, pictures]) => ((window as unknown as { __egeAI: unknown }).__egeAI = { ...run, ...model, ...training, ...pictures }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
