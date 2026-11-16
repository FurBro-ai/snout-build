import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useChordStore } from '../stores/useChordStore.ts';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useChordStore();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-2xl ${
              t.type === 'error'
                ? 'border-rose-500/40 bg-[#181216] text-rose-100'
                : t.type === 'success'
                ? 'border-emerald-500/40 bg-[#111917] text-emerald-100'
                : 'border-white/10 bg-[#12151A] text-slate-100'
            }`}
          >
            {t.type === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            ) : t.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#818CF8]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white">{t.title}</div>
              {t.description && (
                <div className="mt-0.5 text-xs text-slate-300 line-clamp-2">{t.description}</div>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(t.id)}
              className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
