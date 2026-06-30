import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { queryClient } from './lib/query-client';
import { I18nProvider } from './lib/i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
);
