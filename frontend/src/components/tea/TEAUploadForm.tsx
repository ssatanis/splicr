'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { parseSequenceFile } from '@/lib/parsers';
import type { ParsedSequence } from '@/lib/types/analyses';

interface TEAUploadFormProps {
  onSuccess?: (analysisId: string) => void;
}

export default function TEAUploadForm({ onSuccess }: TEAUploadFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sequence, setSequence] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedSequence | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      await handleFileSelect(droppedFile);
    }
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    
    try {
      const parsed = await parseSequenceFile(selectedFile);
      
      setParsedData(parsed);
      setSequence(parsed.sequence);
      
      if (!name) {
        setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setParsedData(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !sequence) {
      setError('Please provide a name and sequence');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const response = await fetch('/api/tea/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sequence,
          sequence_source: file ? 'file' : 'manual',
          file_name: file?.name,
          parameters: {}
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create analysis');
      }

      const data = await response.json();
      
      if (onSuccess) {
        onSuccess(data.analysis.id);
      } else {
        router.push(data.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create analysis');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Analysis Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Analysis Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., BCL11A +58 SNP Analysis"
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          required
        />
      </div>

      {/* File Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Upload Sequence File
        </label>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center transition-colors
            ${isDragging 
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' 
              : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400'
            }
          `}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".fasta,.fa,.fna,.gb,.gbk,.vcf,.txt"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
          
          {file ? (
            <div className="flex items-center justify-center space-x-2 text-emerald-600 dark:text-emerald-400">
              <FileText className="w-5 h-5" />
              <span className="font-medium">{file.name}</span>
              <CheckCircle className="w-5 h-5" />
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 dark:text-gray-400 mb-2">
                Drag and drop or{' '}
                <label htmlFor="file-upload" className="text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline">
                  browse
                </label>
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Supports FASTA, GenBank, VCF, or plain text
              </p>
            </>
          )}
        </div>
      </div>

      {/* Parsed Data Info */}
      {parsedData && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-emerald-900 dark:text-emerald-100">
                File parsed successfully
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                Source: {parsedData.metadata?.source?.toUpperCase() || 'UNKNOWN'} • Length: {parsedData.sequence.length} bp
              </p>
              {parsedData.metadata?.id && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                  ID: {parsedData.metadata.id}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Sequence Input */}
      <div>
        <label htmlFor="sequence" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Or Enter Sequence Manually
        </label>
        <textarea
          id="sequence"
          value={sequence}
          onChange={(e) => setSequence(e.target.value.toUpperCase())}
          placeholder="ATCGATCGATCG..."
          rows={6}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {sequence.length} bases • Minimum 20 bp, Maximum 10,000 bp
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isUploading || !name || !sequence}
        className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
      >
        {isUploading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Creating Analysis...</span>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5" />
            <span>Start TEA Analysis</span>
          </>
        )}
      </button>
    </form>
  );
}
