import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/mona-sans';
import './tokens.css';
import './styles/base.css';
import { AppProviders } from './providers/AppProviders';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
