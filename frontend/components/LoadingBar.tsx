"use client";

import { motion } from "framer-motion";

interface LoadingBarProps {
  progress: number;
}

export default function LoadingBar({ progress }: LoadingBarProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-serif text-text-secondary">Processing</span>
        <span className="text-sm font-serif text-text-primary">{Math.round(progress)}%</span>
      </div>
      
      <div className="relative w-full h-3 bg-background rounded-full overflow-hidden border border-border-light">
        <motion.div
          className="absolute inset-y-0 left-0 bg-accent rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}
