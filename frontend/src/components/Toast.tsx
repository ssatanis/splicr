"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useEffect } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, type, onClose, duration = 5000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const config = {
    success: {
      icon: CheckCircle2,
      bg: "bg-success/10",
      text: "text-success",
      border: "border-success/20",
    },
    error: {
      icon: AlertCircle,
      bg: "bg-error/10",
      text: "text-error",
      border: "border-error/20",
    },
    info: {
      icon: Info,
      bg: "bg-info/10",
      text: "text-info",
      border: "border-info/20",
    },
  };

  const cfg = config[type];
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={`flex items-center gap-4 px-6 py-4 bg-surface rounded-xl shadow-elevated border ${cfg.border} min-w-[320px]`}
    >
      <div className={`p-2 rounded-lg ${cfg.bg}`}>
        <Icon className={`w-5 h-5 ${cfg.text}`} strokeWidth={1.5} />
      </div>
      <p className="flex-1 text-sm font-serif text-text-primary">{message}</p>
      <button
        onClick={onClose}
        className="p-1 hover:bg-background rounded-lg transition-colors"
      >
        <X className="w-4 h-4 text-text-tertiary" strokeWidth={1.5} />
      </button>
    </motion.div>
  );
}

interface ToastContainerProps {
  toasts: Array<{ id: string; message: string; type: ToastType }>;
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-8 right-8 z-50 space-y-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => onRemove(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
