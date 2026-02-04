"use client";

import { motion } from "framer-motion";
import { FileText, X, Archive } from "lucide-react";
import { formatFileSize } from "@/lib/utils";

interface FileLike {
  name: string;
  size: number;
}

interface FileCardProps {
  file: File | FileLike;
  onRemove: () => void;
}

export default function FileCard({ file, onRemove }: FileCardProps) {
  const isCompressed = file.name.toLowerCase().endsWith(".gz");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex items-center bg-surface rounded-xl p-6 shadow-card border border-border hover:shadow-card-hover transition-all duration-200 group"
    >
      {/* File Icon */}
      <div className="w-10 h-10 bg-background rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
        {isCompressed ? (
          <Archive className="w-5 h-5 text-text-secondary" strokeWidth={1.5} />
        ) : (
          <FileText className="w-5 h-5 text-text-secondary" strokeWidth={1.5} />
        )}
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-serif text-text-primary truncate">{file.name}</h4>
        <p className="text-sm text-text-secondary">{formatFileSize(file.size)}</p>
      </div>

      {/* Delete Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={onRemove}
        className="ml-4 p-2 rounded-lg hover:bg-background text-text-secondary hover:text-red-500 transition-colors duration-200"
      >
        <X className="w-5 h-5" strokeWidth={1.5} />
      </motion.button>
    </motion.div>
  );
}
