'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadMultipleFilesToR2,
  formatFileSize,
  isAllowedSequencingFile,
  type UploadedFile,
  type UploadProgress,
} from '@/lib/storage/r2-upload';
import { SUPPORTED_FORMATS_UI } from '@/lib/upload/constants';
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
  onFileSelect?: (file: File) => void;
  maxFiles?: number;
}

export default function FastqUploader({
  onFilesUploaded,
  onFilesChange,
  onFileSelect,
  maxFiles = 10,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const [reusedFiles, setReusedFiles] = useState<Set<string>>(new Set());
  const [uploadSpeed, setUploadSpeed] = useState<Record<string, number>>({});
  const startTimesRef = useRef<Record<string, number>>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  const supabase = createClient();

  const cancelUpload = (fileName: string) => {
    const controller = abortControllersRef.current[fileName];
    if (controller) {
      controller.abort();
      delete abortControllersRef.current[fileName];
    }
    setProgress((prev) => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setUploadSpeed((prev) => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setCompletedFiles((prev) => {
      const next = new Set(prev);
      next.delete(fileName);
      return next;
    });
    setReusedFiles((prev) => {
      const next = new Set(prev);
      next.delete(fileName);
      return next;
    });
  };

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

    const invalidFiles = files.filter((f) => !isAllowedSequencingFile(f.name));
    if (invalidFiles.length > 0) {
      setError(
        `Unsupported file type: ${invalidFiles.map((f) => f.name).join(', ')}. Allowed: ${SUPPORTED_FORMATS_UI}.`
      );
      return;
    }

    if (files.length > 0 && onFileSelect) {
      const firstFile = files[0];
      // If file is large, only send first 5MB for smart ingest to avoid 413
      const MAX_INGEST_SIZE = 5 * 1024 * 1024;
      if (firstFile.size > MAX_INGEST_SIZE) {
        const slice = firstFile.slice(0, MAX_INGEST_SIZE);
        // Create a new File object from the slice to preserve name and type
        const partialFile = new File([slice], firstFile.name, { type: firstFile.type });
        onFileSelect(partialFile);
      } else {
        onFileSelect(firstFile);
      }
    }

    await uploadFiles(files);
  };

  const uploadFiles = async (files: File[]) => {
    setError(null);
    setUploading(true);
    startTimesRef.current = {};
    setUploadSpeed({});
    setReusedFiles(new Set());
    abortControllersRef.current = {};
    files.forEach((f) => {
      abortControllersRef.current[f.name] = new AbortController();
    });
    // Show progress bar instantly with 0% for each file
    setProgress(
      files.reduce<Record<string, UploadProgress>>(
        (acc, f) => ({
          ...acc,
          [f.name]: { loaded: 0, total: f.size, percent: 0 },
        }),
        {}
      )
    );

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('You must be logged in to upload files.');
      }

      const getSignal = (fileName: string) => abortControllersRef.current[fileName]?.signal;

      const uploaded = await uploadMultipleFilesToR2(
        files,
        user.id,
        (fileName, fileProgress) => {
          if (!startTimesRef.current[fileName]) {
            startTimesRef.current[fileName] = Date.now();
          }
          const elapsedSec = (Date.now() - startTimesRef.current[fileName]) / 1000;
          if (elapsedSec > 0) {
            setUploadSpeed((prev) => ({
              ...prev,
              [fileName]: fileProgress.loaded / elapsedSec,
            }));
          }
          setProgress((prev) => ({
            ...prev,
            [fileName]: fileProgress,
          }));
        },
        (uploadedFile) => {
          setCompletedFiles((prev) => new Set(prev).add(uploadedFile.name));
          if (uploadedFile.reused) {
            setReusedFiles((prev) => new Set(prev).add(uploadedFile.name));
          }
        },
        getSignal
      );

      const nextFiles = [...uploadedFiles, ...uploaded];
      setUploadedFiles(nextFiles);
      onFilesUploaded(uploaded);
      onFilesChange?.(nextFiles);

      setTimeout(() => {
        setProgress({});
        setCompletedFiles(new Set());
        setReusedFiles(new Set());
        setUploadSpeed({});
      }, 2000);
    } catch (err: unknown) {
      let message = 'Upload failed. Please try again.';
      if (err instanceof Error) {
        message = err.message;
        // Provide more helpful messages for common errors
        if (message.includes('Authentication required')) {
          message = 'Please sign in to upload files.';
        } else if (message.includes('R2 credentials not configured')) {
          message = 'Storage is not configured. Please contact support.';
        } else if (message.includes('Network error')) {
          message = 'Network error. Please check your connection and try again.';
        }
      }
      console.error('Upload error:', err);
      setError(message);
    } finally {
      abortControllersRef.current = {};
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
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${uploading
          ? 'border-border bg-background'
          : 'border-border hover:border-accent hover:bg-background'
          }`}
      >
        <input
          type="file"
          id="fastq-upload"
          accept=".fastq,.fastq.gz,.fq,.fq.gz,.bam,.cram,.sam,.txt"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
        <label
          htmlFor="fastq-upload"
          className={`flex flex-col items-center space-y-3 ${uploading ? 'cursor-not-allowed' : 'cursor-pointer'
            }`}
        >
          {uploading ? (
            <Loader2 className="w-12 h-12 text-accent animate-spin" />
          ) : (
            <Upload className="w-12 h-12 text-text-secondary" strokeWidth={1} />
          )}
          <div>
            <p className="text-xl font-serif text-text-primary">
              {uploading ? 'Uploading sequencing data…' : 'Upload sequencing data'}
            </p>
            <p className="text-sm text-text-secondary mt-1">
              Max 5 GB. {maxFiles} files max.
            </p>
            <p className="text-xs text-text-tertiary mt-1">
              Supports: {SUPPORTED_FORMATS_UI}
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

      {/* Upload Progress - shown instantly when upload starts */}
      {Object.keys(progress).length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">
            Uploading sequencing data… ({Object.keys(progress).length} file(s))
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
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-text-secondary">
                    {fileProgress.percent}%
                  </span>
                  {!completedFiles.has(fileName) && (
                    <button
                      type="button"
                      onClick={() => cancelUpload(fileName)}
                      className="text-error hover:opacity-80 p-0.5 rounded"
                      title="Cancel upload"
                      aria-label={`Cancel upload of ${fileName}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-2 rounded-full transition-all duration-300"
                  style={{ width: `${fileProgress.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-text-tertiary">
                <span>
                  {formatFileSize(fileProgress.loaded)} / {formatFileSize(fileProgress.total)}
                </span>
                {reusedFiles.has(fileName) ? (
                  <span className="text-success">100% – reused from cloud storage</span>
                ) : uploadSpeed[fileName] != null && uploadSpeed[fileName] > 0 ? (
                  <span>{formatFileSize(uploadSpeed[fileName])}/s</span>
                ) : null}
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
                      {file.reused && (
                        <span className="ml-2 text-success">· Reused from cloud</span>
                      )}
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
