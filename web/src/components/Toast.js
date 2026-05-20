import { useState, useCallback, createContext, useContext } from 'react';
import { X, Bell, AlertCircle, CheckCircle2, Info, ArrowRight, ExternalLink } from 'lucide-react';

// Context
const ToastContext = createContext(null);

// Toast types with enhanced styling
const TOAST_TYPES = {
  info: { 
    icon: Info, 
    bg: 'bg-[var(--t-surface)]',
    border: 'border-border',
    iconColor: 'text-signal',
    glow: ''
  },
  success: { 
    icon: CheckCircle2, 
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    iconColor: 'text-emerald-400',
    glow: 'shadow-lg'
  },
  warning: { 
    icon: Bell, 
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    iconColor: 'text-amber-400',
    glow: 'shadow-lg'
  },
  error: { 
    icon: AlertCircle, 
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    iconColor: 'text-red-400',
    glow: 'shadow-lg'
  },
};

// Toast Provider
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', options = {}) => {
    const id = Date.now() + Math.random();
    const { 
      duration = 5000, 
      description, 
      action,
      actionLabel,
      onAction 
    } = typeof options === 'number' ? { duration: options } : options;

    const newToast = { 
      id, 
      message, 
      type, 
      description,
      action,
      actionLabel,
      onAction
    };

    setToasts(prev => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Shorthand methods
  const toast = {
    info: (message, options) => addToast(message, 'info', options),
    success: (message, options) => addToast(message, 'success', options),
    warning: (message, options) => addToast(message, 'warning', options),
    error: (message, options) => addToast(message, 'error', options),
  };

  return (
    <ToastContext.Provider value={{ addToast, removeToast, toast }}>
      {children}
      {/* Toast Container - Top Right */}
      <div className="fixed top-20 right-6 z-[100] space-y-3 max-w-md pointer-events-none">
        {toasts.map((toast, index) => (
          <ToastItem 
            key={toast.id} 
            toast={toast} 
            onClose={() => removeToast(toast.id)}
            index={index}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Toast Item Component with Action Support
function ToastItem({ toast, onClose, index }) {
  const config = TOAST_TYPES[toast.type] || TOAST_TYPES.info;
  const Icon = config.icon;

  const handleAction = () => {
    if (toast.onAction) {
      toast.onAction();
    }
    onClose();
  };

  return (
    <div 
      className={`
        flex flex-col gap-2 p-4 rounded-xl border backdrop-blur-xl 
        ${config.bg} ${config.border} ${config.glow}
        pointer-events-auto animate-slide-in-right
      `}
      style={{ 
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'backwards'
      }}
      data-testid="toast"
    >
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${config.iconColor}`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{toast.message}</p>
          {toast.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
          )}
        </div>

        <button 
          onClick={onClose}
          className="text-muted-foreground hover:text-white transition-colors p-1 hover:bg-muted rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Action Button */}
      {(toast.action || toast.onAction) && (
        <button
          onClick={handleAction}
          className="flex items-center justify-center gap-2 w-full py-2 mt-1 text-xs font-medium text-muted-foreground hover:text-white bg-muted hover:bg-muted rounded-lg transition-all group"
        >
          {toast.actionLabel || 'Open'}
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Return no-op if not in provider (for initial render)
    return { 
      addToast: () => {}, 
      removeToast: () => {},
      toast: {
        info: () => {},
        success: () => {},
        warning: () => {},
        error: () => {},
      }
    };
  }
  return context;
}

export default ToastProvider;
