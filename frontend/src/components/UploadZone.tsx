"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
}

export default function UploadZone({ onFilesSelected }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const validFiles = files.filter((file) => {
        const name = file.name.toLowerCase();
        return (
          name.endsWith(".fastq") ||
          name.endsWith(".fq") ||
          name.endsWith(".fastq.gz") ||
          name.endsWith(".fq.gz")
        );
      });

      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
    },
    [onFilesSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        onFilesSelected(files);
      }
    },
    [onFilesSelected]
  );

  return (
    <motion.div
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      animate={{
        borderColor: isDragging ? "#1A1A1A" : "#E8E6E3",
        backgroundColor: isDragging ? "#FAF8F5" : "#FFFFFF",
      }}
      className={cn(
        "relative border-2 border-dashed rounded-2xl p-20 text-center transition-all duration-200 cursor-pointer",
        "hover:bg-background"
      )}
    >
      <input
        type="file"
        multiple
        accept=".fastq,.fq,.fastq.gz,.fq.gz"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer overflow-hidden [font-size:0] [line-height:0]"
        aria-label="Upload FASTQ files"
      />

      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 flex items-center justify-center">
          <Upload className="w-12 h-12 text-text-secondary" strokeWidth={1} />
        </div>

        <div className="space-y-2">
          <p className="text-xl font-serif text-text-primary">
            {isDragging ? "Drop files here" : "Drag FASTQ files or click to browse"}
          </p>
          <p className="text-sm text-text-secondary">
            Supports .fastq, .fq, .fastq.gz, .fq.gz (max 5GB per file)
          </p>
        </div>
      </div>
    </motion.div>
  );
}
