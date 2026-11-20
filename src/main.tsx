import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';
import { I18nProvider } from '@lingui/react';
import { i18n, loadCatalog, getInitialLocale } from './lib/i18n';
import App from './App';
import { convex } from './lib/convexClient';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from './lib/authClient';
import { AuthDebugLogger } from './lib/AuthDebug';
import { BrandMark } from './components/BrandMark';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const initialLocale = getInitialLocale();
const root = ReactDOM.createRoot(rootElement);

const renderApp = () => {
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <ConvexBetterAuthProvider client={convex} authClient={authClient as any}>
          <AuthDebugLogger />
          <App />
        </ConvexBetterAuthProvider>
      </I18nProvider>
    </React.StrictMode>
  );
};

const renderBootstrapError = () => {
  root.render(
    <main className="g-desk th">
      <div className="th__top"><BrandMark logoClassName="bar__logo" /></div>
      <div className="grid place-items-center px-(--gutter) pb-[72px]">
        <div className="authsheet stock stock--lift">
          <div>
            <h1 className="th__h">Tavio could not start</h1>
            <p className="mt-1.5 text-md text-muted">The language files could not be loaded. Check your connection and try again.</p>
          </div>
          <button type="button" onClick={() => window.location.reload()} className="btn btn--ink btn--wide">
            Try again
          </button>
        </div>
      </div>
    </main>
  );
};

root.render(
  <main className="g-desk th" aria-busy="true">
    <div className="th__top"><BrandMark logoClassName="bar__logo" /></div>
    <div className="grid place-items-center pb-[72px]">
      <p role="status" className="flex items-center gap-2 text-sm text-muted"><span className="spin" aria-hidden="true" />Loading Tavio...</p>
    </div>
  </main>
);

loadCatalog(initialLocale)
  .then(renderApp)
  .catch((error) => {
    console.error('[i18n] Failed to load the initial catalog', error);
    renderBootstrapError();
  });
