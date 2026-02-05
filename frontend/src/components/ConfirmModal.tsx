"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Button from "./Button";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "neutral";
  loading?: boolean;
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "neutral",
  loading = false,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-card pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-modal-title"
              aria-describedby="confirm-modal-desc"
            >
              <div className="p-6">
                <h2
                  id="confirm-modal-title"
                  className="text-xl font-serif font-medium text-text-primary mb-2"
                >
                  {title}
                </h2>
                <p
                  id="confirm-modal-desc"
                  className="text-sm font-serif text-text-secondary leading-relaxed mb-6"
                >
                  {message}
                </p>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onClose}
                    disabled={loading}
                  >
                    {cancelLabel}
                  </Button>
                  <Button
                    type="button"
                    variant={variant === "danger" ? "primary" : "primary"}
                    size="sm"
                    onClick={handleConfirm}
                    disabled={loading}
                    className={variant === "danger" ? "bg-error hover:bg-error/90 text-white border-0" : undefined}
                  >
                    {loading ? "…" : confirmLabel}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
