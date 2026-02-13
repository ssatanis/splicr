
import React, { useState, useEffect } from 'react';
import { LibraryDetectionPanel } from './LibraryDetectionPanel';
import { BeforeAfterVisualization } from './BeforeAfterVisualization';
import { AlertCircle, CheckCircle, Loader2, Play, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
// import { Button } from '@/components/ui/button'; 

interface BatchCorrectionDashboardProps {
    analysisId: string;
    initialMetrics?: any;
}

export function BatchCorrectionDashboard({ analysisId, initialMetrics }: BatchCorrectionDashboardProps) {
    const [step, setStep] = useState<'detect' | 'confirm' | 'correcting' | 'results'>('detect');
    const [library, setLibrary] = useState<any>(null);
    const [metrics, setMetrics] = useState<any>(initialMetrics || null);
    const [pcaData, setPcaData] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (initialMetrics) {
            setStep('results');
            // If we have metrics but no PCA data, we might need to fetch it or generic placeholder
            // fetching PCA data might be needed if not in initialMetrics
        }
    }, [initialMetrics]);

    const handleLibraryDetected = (result: any) => {
        setLibrary(result);
        setStep('confirm');
    };

    const runCorrection = async () => {
        setStep('correcting');
        setError(null);
        try {
            const res = await fetch(`/api/analysis/${analysisId}/batch-correct`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Correction failed');
            }

            const data = await res.json();
            setMetrics(data.metrics);
            // If API returns PCA data
            if (data.pcaCoordinates) {
                setPcaData(data.pcaCoordinates);
            }
            setLibrary(data.library); // Update with backend confirmed library
            setStep('results');
        } catch (err: any) {
            setError(err.message);
            setStep('confirm'); // Go back to confirm to try again
        }
    };

    return (
        <div className="space-y-8">
            <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    Batch Effect Correction
                    <div className="group relative inline-block">
                        <Info className="w-5 h-5 text-slate-400 cursor-help" />
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-2 bg-slate-800 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none text-center">
                            Aligns your CRISPR screen data with public reference sets (like DepMap) to remove technical artifacts and increase biological signal.
                            <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-slate-800"></div>
                        </div>
                    </div>
                </h2>
                <p className="text-slate-500 dark:text-slate-400">
                    Correct for technical artifacts by integrating with DepMap reference data.
                </p>
            </div>

            {/* Step 1: Library Detection */}
            {step === 'detect' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <LibraryDetectionPanel onLibraryDetected={handleLibraryDetected} />
                    <p className="text-sm text-slate-400 mt-4 text-center">
                        Upload your count matrix or sgRNA list to detect library and enable correction.
                    </p>
                </div>
            )}

            {/* Step 2: Confirmation & Config */}
            {step === 'confirm' && library && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-4">Correction Configuration</h3>

                        <div className="flex items-center gap-4 bg-teal-50 dark:bg-teal-900/20 p-4 rounded-lg border border-teal-100 dark:border-teal-900/50">
                            <CheckCircle className="w-5 h-5 text-teal-600" />
                            <div>
                                <p className="font-medium text-teal-900 dark:text-teal-100">Library Detected: {library.name}</p>
                                <p className="text-sm text-teal-700 dark:text-teal-300">Confidence: {Math.round(library.confidence * 100)}%</p>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setStep('detect')}
                                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                            >
                                Back
                            </button>
                            <button
                                onClick={runCorrection}
                                className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white px-6 py-2 rounded-lg font-medium shadow-lg shadow-teal-500/20 flex items-center gap-2 transition-all"
                            >
                                <Play className="w-4 h-4" />
                                Run Batch Correction
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 3: Running */}
            {step === 'correcting' && (
                <div className="flex flex-col items-center justify-center p-12 space-y-4">
                    <Loader2 className="w-10 h-10 text-teal-600 animate-spin" />
                    <div className="text-center">
                        <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">Correcting Batch Effects...</h3>
                        <p className="text-slate-500">Aligning with DepMap reference (this may take 1-2 minutes)</p>
                    </div>
                </div>
            )}

            {/* Step 4: Results */}
            {step === 'results' && metrics && (
                <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/50 p-4 rounded-lg flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                        <p className="text-emerald-800 dark:text-emerald-200 font-medium">Batch correction complete.</p>
                    </div>

                    <BeforeAfterVisualization pcaPoints={pcaData} metrics={metrics} />

                    <div className="flex justify-end">
                        <button className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 rounded-lg text-sm font-medium">
                            Download Corrected Data
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}
        </div>
    );
}
