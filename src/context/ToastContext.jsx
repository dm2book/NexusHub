import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const ICONS = { success: CheckCircle, error: AlertCircle, info: Info, warning: AlertCircle };
const COLORS = {
  success: 'text-emerald-400 border-emerald-500/40',
  error: 'text-red-400 border-red-500/40',
  info: 'text-indigo-400 border-indigo-500/40',
  warning: 'text-amber-400 border-amber-500/40',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const toast = {
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
    warning: (m) => push(m, 'warning'),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 w-80">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id}
              className={`card border ${COLORS[t.type]} px-4 py-3 flex items-start gap-3 animate-fade-up shadow-xl`}>
              <Icon size={18} className={COLORS[t.type].split(' ')[0]} />
              <span className="text-sm text-slate-200 flex-1">{t.message}</span>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <X size={14} className="text-slate-500 hover:text-white" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
