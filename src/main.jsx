import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { LanguageProvider } from './lib/i18n.jsx';
import './index.css';

/**
 * Take down the pre-React shell.
 *
 * Removed on the frame AFTER React has painted, not before it renders: doing it
 * synchronously here swaps the shell for an empty root and produces a flash of
 * white that is worse than the thing it replaced.
 */
const dropShell = () => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById('fm-shell')?.remove();
  }));
};

/**
 * Wait for the app stylesheet before mounting.
 *
 * The stylesheet is loaded without blocking the first paint (see the
 * `fm-async-app-css` plugin in vite.config.js) so the pre-React shell can be on
 * screen in frame one. The price of that is a window in which React could
 * render before its CSS applies, and an unstyled storefront is a worse thing to
 * show than a shell.
 *
 * In practice the sheet lands around 830 ms and React is not ready until about
 * 1400 ms, so this resolves immediately — but "in practice" is not a guarantee
 * on somebody else's connection, and this is the one place the guarantee can be
 * made. The timeout is the other half of it: a stylesheet that never arrives
 * must not mean a shop that never opens.
 */
const styleReady = () => new Promise((resolve) => {
  const link = document.querySelector('link[data-app-css]');
  if (!link || link.sheet) return resolve();
  const done = () => resolve();
  link.addEventListener('load', done, { once: true });
  link.addEventListener('error', done, { once: true });
  setTimeout(done, 3000);
});

const mount = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <ToastProvider>
          <AuthProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </AuthProvider>
        </ToastProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);

styleReady().then(() => { mount(); dropShell(); });
