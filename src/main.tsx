import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/heebo';
import '@fontsource-variable/outfit';
import './styles/index.css';
import { App } from './app/App';
import { restoreRedirect } from './utils/redirect';
import { installViewport } from './ui/viewport';

restoreRedirect();
installViewport();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
