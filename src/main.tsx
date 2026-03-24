import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import App from './App';
import { OrbOverlay } from './OrbOverlay';
import './styles.css';

const windowLabel = getCurrentWebviewWindow().label;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {windowLabel === 'overlay' ? <OrbOverlay /> : <App />}
  </React.StrictMode>,
);
