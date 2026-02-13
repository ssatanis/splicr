
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone'; // Use or implement simple dropzone
import Papa from 'papaparse';
import { FileUp, BookOpen, CheckCircle, AlertCircle, Loader2, Dna, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
// import { Button } from '@/components/ui/button'; // Assuming shadcn or similar

interface LibraryDetectionResult {
    name: string;
    confidence: number;
    matchStats: Record<string, number>;
    details: any;
}

interface LibraryDetectionPanelProps {
    onLibraryDetected?: (result: LibraryDetectionResult) => void;
    className?: string;
}

export function LibraryDetectionPanel({ onLibraryDetected, className }: LibraryDetectionPanelProps) {
    const [file, setFile] = useState<File | null>(null);
    const [isDetecting, setIsDetecting] = useState(false);
    const [result, setResult] = useState<LibraryDetectionResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setFile(acceptedFiles[0]);
            setResult(null);
            setError(null);
            detectLibrary(acceptedFiles[0]); // Auto-detect on drop
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
            'text/tab-separated-values': ['.tsv', '.txt']
        },
        maxFiles: 1
    });

    const detectLibrary = async (uploadedFile: File) => {
        setIsDetecting(true);
        setError(null);

        // Parse first 1000 lines
        Papa.parse(uploadedFile, {
            preview: 1000,
            step: function (row) {
                // We can't easily collect just 1000 lines with step without managing state, 
                // better to use complete with preview: 1000
            },
            complete: async (results) => {
                try {
                    // Extract sequences. Heuristic: Look for column with len ~20 and ACTG content
                    const rows = results.data as string[][];
                    let sequenceColIndex = -1;

                    if (rows.length > 0) {
                        // Simple heuristic: check first non-header row
                        // Find column with 'A', 'T', 'G', 'C' and length > 15
                        const sampleRow = rows[1] || rows[0];
                        sampleRow.forEach((cell: string, idx: number) => {
                            if (cell && cell.length >= 19 && cell.length <= 21 && /^[ATGCatgc]+$/.test(cell)) {
                                sequenceColIndex = idx;
                            }
                        });
                    }

                    if (sequenceColIndex === -1) {
                        // Fallback: Check headers for 'sequence' or 'sgRNA'
                        const header = rows[0];
                        const idx = header.findIndex(h => /seq|sgrna/i.test(h));
                        if (idx !== -1) sequenceColIndex = idx;
                    }

                    if (sequenceColIndex === -1) {
                        // Default to column 0 if mostly DNA
                        sequenceColIndex = 0;
                    }

                    const sequences = rows.map(r => r[sequenceColIndex]).filter(s => s && s.length >= 15);

                    // API Call
                    const res = await fetch('/api/analysis/detect-library', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sequences })
                    });

                    if (!res.ok) throw new Error('Detection failed');
                    const data = await res.json();
                    setResult(data);
                    onLibraryDetected?.(data);

                } catch (err) {
                    setError('Failed to detect library. Please verify file format.');
                    console.error(err);
                } finally {
                    setIsDetecting(false);
                }
            },
            error: (err) => {
                setError('Error parsing CSV file.');
                setIsDetecting(false);
            }
        });
    };

    return (
        <div className={cn("bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6", className)}>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-teal-600" />
                Library Detection
            </h3>

            {!result ? (
                <div
                    {...getRootProps()}
                    className={cn(
                        "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                        isDragActive ? "border-teal-500 bg-teal-50/50 dark:bg-teal-900/10" : "border-slate-300 dark:border-slate-600 hover:border-teal-400"
                    )}
                >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center gap-3">
                        <div className="p-3 bg-teal-100 dark:bg-teal-900/30 rounded-full">
                            {isDetecting ? (
                                <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
                            ) : (
                                <FileUp className="w-6 h-6 text-teal-600" />
                            )}
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                {isDetecting ? "Analyzing sequences..." : "Drag & drop count matrix or click to upload"}
                            </p>
                            <p className="text-xs text-slate-500">Supported: CSV, TSV (max 50MB)</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                    <div className="flex items-start justify-between bg-teal-50/50 dark:bg-teal-900/20 p-4 rounded-lg border border-teal-100 dark:border-teal-900/50">
                        <div className="flex gap-3">
                            <div className="p-2 bg-teal-100 dark:bg-teal-900/50 rounded-lg">
                                <Dna className="w-6 h-6 text-teal-700 dark:text-teal-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-teal-900 dark:text-teal-100 flex items-center gap-2">
                                    {result.name}
                                    <span className="text-xs bg-teal-200 dark:bg-teal-800 text-teal-800 dark:text-teal-200 px-2 py-0.5 rounded-full">
                                        {Math.round(result.confidence * 100)}% Match
                                    </span>
                                </h4>
                                <p className="text-sm text-teal-700 dark:text-teal-300 mt-1">
                                    {result.details?.notes || "Standard CRISPR library detected."}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => { setResult(null); setFile(null); }}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                            Change File
                        </button>
                    </div>

                    {/* Stats Bar */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-500">
                            <span>Confidence Score</span>
                            <span>{Math.round(result.confidence * 100)}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-teal-500 transition-all duration-500 ease-out"
                                style={{ width: `${result.confidence * 100}%` }}
                            />
                        </div>
                    </div>

                    {/* Matches Breakdown */}
                    <div className="grid grid-cols-2 gap-2 mt-4">
                        {Object.entries(result.matchStats)
                            .sort(([, a], [, b]) => b - a)
                            .slice(0, 4)
                            .map(([lib, count]) => (
                                <div key={lib} className="flex justify-between text-xs p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-100 dark:border-slate-700">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{lib}</span>
                                    <span className="text-slate-500">{String(count)}</span>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-lg flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}
        </div>
    );
}
