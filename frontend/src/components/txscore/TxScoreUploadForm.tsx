'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Database } from 'lucide-react';
import { parseGeneListFile } from '@/lib/parsers';
import type { ParsedGeneList } from '@/lib/types/analyses';

interface TxScoreUploadFormProps {
  onSuccess?: (analysisId: string) => void;
}

export default function TxScoreUploadForm({ onSuccess }: TxScoreUploadFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [geneList, setGeneList] = useState<string[]>([]);
  const [geneInput, setGeneInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedGeneList | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importFromScreen, setImportFromScreen] = useState(false);

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
      const parsed = await parseGeneListFile(selectedFile);
      
      setParsedData(parsed);
      setGeneList(parsed.genes);
      setGeneInput(parsed.genes.join('\n'));
      
      if (!name) {
        setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setParsedData(null);
    }
  };

  const handleGeneInputChange = (value: string) => {
    setGeneInput(value);
    const genes = value
      .split(/[\n,;\s]+/)
      .map(g => g.trim())
      .filter(g => g.length > 0);
    setGeneList(genes);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || geneList.length === 0) {
      setError('Please provide a name and at least one gene');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const response = await fetch('/api/txscore/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          gene_list: geneList,
          gene_list_source: file ? 'file' : importFromScreen ? 'screen' : 'manual',
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
          placeholder="e.g., Hematologic Malignancies Target Panel"
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          required
        />
      </div>

      {/* Import from Screen Toggle */}
      <div className="flex items-center space-x-3 p-4 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-lg">
        <Database className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={importFromScreen}
            onChange={(e) => setImportFromScreen(e.target.checked)}
            className="rounded text-violet-600 focus:ring-violet-500"
          />
          <span className="text-sm font-medium text-violet-900 dark:text-violet-100">
            Import gene list from existing CRISPR screen
          </span>
        </label>
      </div>

      {/* File Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Upload Gene List File
        </label>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center transition-colors
            ${isDragging 
              ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20' 
              : 'border-gray-300 dark:border-gray-600 hover:border-violet-400'
            }
          `}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".csv,.tsv,.txt,.xlsx"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
          
          {file ? (
            <div className="flex items-center justify-center space-x-2 text-violet-600 dark:text-violet-400">
              <FileText className="w-5 h-5" />
              <span className="font-medium">{file.name}</span>
              <CheckCircle className="w-5 h-5" />
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 dark:text-gray-400 mb-2">
                Drag and drop or{' '}
                <label htmlFor="file-upload" className="text-violet-600 dark:text-violet-400 cursor-pointer hover:underline">
                  browse
                </label>
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Supports CSV, TSV, TXT, or Excel files
              </p>
            </>
          )}
        </div>
      </div>

      {/* Parsed Data Info */}
      {parsedData && (
        <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <CheckCircle className="w-5 h-5 text-violet-600 dark:text-violet-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-violet-900 dark:text-violet-100">
                File parsed successfully
              </p>
              <p className="text-sm text-violet-700 dark:text-violet-300 mt-1">
                Source: {parsedData.metadata?.source_file || 'MANUAL'} • Genes: {parsedData.genes.length}
              </p>
              {parsedData.duplicates && parsedData.duplicates.length > 0 && (
                <p className="text-sm text-violet-600 dark:text-violet-400 mt-1">
                  Removed {parsedData.duplicates.length} duplicates
                </p>
              )}
              {parsedData.invalid_genes && parsedData.invalid_genes.length > 0 && (
                <p className="text-sm text-orange-600 dark:text-orange-400 mt-1">
                  Skipped {parsedData.invalid_genes.length} invalid entries
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Gene Input */}
      <div>
        <label htmlFor="genes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Or Enter Genes Manually
        </label>
        <textarea
          id="genes"
          value={geneInput}
          onChange={(e) => handleGeneInputChange(e.target.value)}
          placeholder="TP53&#10;BCL2&#10;MYC&#10;..."
          rows={8}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {geneList.length} genes • Separate by newline, comma, semicolon, or space • Maximum 5,000 genes
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
        disabled={isUploading || !name || geneList.length === 0}
        className="w-full px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
      >
        {isUploading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Creating Analysis...</span>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5" />
            <span>Start TxScore Analysis</span>
          </>
        )}
      </button>
    </form>
  );
}
