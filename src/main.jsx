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

ReactDOM.createRoot(document.getElementById('root')).render(
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

dropShell();
