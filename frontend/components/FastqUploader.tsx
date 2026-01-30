'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadMultipleFilesToR2,
  formatFileSize,
  isFastqFile,
  type UploadedFile,
  type UploadProgress,
} from '@/lib/storage/r2-upload';
import {
  Upload,
  File as FileIcon,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface Props {
  onFilesUploaded: (files: UploadedFile[]) => void;
  onFilesChange?: (files: UploadedFile[]) => void;
  maxFiles?: number;
}

export default function FastqUploader({
  onFilesUploaded,
  onFilesChange,
  maxFiles = 10,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());

  const supabase = createClient();

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    event.target.value = '';

    // Validate file count
    if (files.length + uploadedFiles.length > maxFiles) {
      setError(
        `Maximum ${maxFiles} files allowed. You selected ${files.length + uploadedFiles.length} files.`
      );
      return;
    }

    // Validate all files are FASTQ
    const invalidFiles = files.filter((f) => !isFastqFile(f.name));
    if (invalidFiles.length > 0) {
      setError(
        `Invalid file types: ${invalidFiles.map((f) => f.name).join(', ')}. Only FASTQ files (.fastq, .fastq.gz, .fq, .fq.gz) are allowed.`
      );
      return;
    }

    await uploadFiles(files);
  };

  const uploadFiles = async (files: File[]) => {
    setError(null);
    setUploading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('You must be logged in to upload files.');
      }

      const uploaded = await uploadMultipleFilesToR2(
        files,
        user.id,
        (fileName, fileProgress) => {
          setProgress((prev) => ({
            ...prev,
            [fileName]: fileProgress,
          }));
        },
        (uploadedFile) => {
          setCompletedFiles((prev) => new Set(prev).add(uploadedFile.name));
        }
      );

      const nextFiles = [...uploadedFiles, ...uploaded];
      setUploadedFiles(nextFiles);
      onFilesUploaded(uploaded);
      onFilesChange?.(nextFiles);

      setTimeout(() => {
        setProgress({});
        setCompletedFiles(new Set());
      }, 2000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Upload failed. Please try again.';
      console.error('Upload error:', err);
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (file: UploadedFile) => {
    const nextFiles = uploadedFiles.filter((f) => f.r2Key !== file.r2Key);
    setUploadedFiles(nextFiles);
    onFilesChange?.(nextFiles);
  };

  return (
    <div className="space-y-4">
      {/* Upload Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
          uploading
            ? 'border-border bg-background'
            : 'border-border hover:border-accent hover:bg-background'
        }`}
      >
        <input
          type="file"
          id="fastq-upload"
          accept=".fastq,.fastq.gz,.fq,.fq.gz"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
        <label
          htmlFor="fastq-upload"
          className={`flex flex-col items-center space-y-3 ${
            uploading ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
        >
          {uploading ? (
            <Loader2 className="w-12 h-12 text-accent animate-spin" />
          ) : (
            <Upload className="w-12 h-12 text-text-secondary" strokeWidth={1} />
          )}
          <div>
            <p className="text-xl font-serif text-text-primary">
              {uploading ? 'Uploading FASTQ files...' : 'Upload FASTQ Files'}
            </p>
            <p className="text-sm text-text-secondary mt-1">
              Click or drag files here • Up to 5GB per file • {maxFiles} files
              max
            </p>
            <p className="text-xs text-text-tertiary mt-1">
              Supports: .fastq, .fastq.gz, .fq, .fq.gz
            </p>
          </div>
        </label>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-start space-x-3 p-4 bg-error/10 border border-error/30 rounded-xl">
          <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-error">Upload Error</p>
            <p className="text-sm text-error/90 mt-1">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-error hover:opacity-80"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Upload Progress */}
      {Object.keys(progress).length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">
            Uploading {Object.keys(progress).length} file(s)...
          </h3>
          {Object.entries(progress).map(([fileName, fileProgress]) => (
            <div key={fileName} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  {completedFiles.has(fileName) ? (
                    <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                  ) : (
                    <Loader2
                      className="w-4 h-4 text-accent animate-spin flex-shrink-0"
                    />
                  )}
                  <span className="font-medium text-text-primary truncate">
                    {fileName}
                  </span>
                </div>
                <span className="text-text-secondary ml-2">
                  {fileProgress.percent}%
                </span>
              </div>
              <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-2 rounded-full transition-all duration-300"
                  style={{ width: `${fileProgress.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-text-tertiary">
                <span>{formatFileSize(fileProgress.loaded)}</span>
                <span>{formatFileSize(fileProgress.total)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">
            Uploaded Files ({uploadedFiles.length})
          </h3>
          <div className="space-y-2">
            {uploadedFiles.map((file) => (
              <div
                key={file.r2Key}
                className="flex items-center justify-between p-3 bg-surface border border-border rounded-xl"
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <FileIcon
                    className="w-5 h-5 text-accent flex-shrink-0"
                    strokeWidth={1}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary truncate">
                      {file.name}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(file)}
                  disabled={uploading}
                  className="text-error hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed ml-2"
                  title="Remove file"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
