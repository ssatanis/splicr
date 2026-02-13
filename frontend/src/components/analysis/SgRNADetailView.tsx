
'use client';

import React from 'react';
import { ArrowLeft, CheckCircle, AlertTriangle, XCircle, Copy, ExternalLink } from 'lucide-react';

interface SgRNADetailViewProps {
    sgrnaId: string;
    onBack: () => void;
}

export default function SgRNADetailView({ sgrnaId, onBack }: SgRNADetailViewProps) {
    // Mock data for detail view - In real app, fetch based on sgrnaId
    const sgRNA = {
        id: sgrnaId,
        sequence: 'GTCGCCCTCGAACTTCACCT',
        pam: 'NGG',
        gene: 'BRCA1',
        locus: 'chr17:43044295',
        onTargetScore: 0.87,
        specificityScore: 92,
        offTargets: [
            { gene: 'EGFR', locus: 'chr1:123456', mismatches: 1, bulges: 0, score: 0.23, validated: true },
            { gene: 'TP53', locus: 'chr3:987654', mismatches: 2, bulges: 0, score: 0.08, validated: false },
            { gene: 'PTEN', locus: 'chr10:112233', mismatches: 2, bulges: 1, score: 0.05, validated: false },
        ]
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <button
                onClick={onBack}
                className="flex items-center text-gray-500 hover:text-teal-600 transition-colors mb-4"
            >
                <ArrowLeft size={16} className="mr-1" /> Back to Dashboard
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Info Card */}
                <div className="lg:col-span-2 bg-white dark:bg-[#262828] rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 p-6">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-[#134252] dark:text-[#f5f5f5] flex items-center">
                                {sgRNA.gene} sgRNA
                                <span className="ml-3 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 font-mono border border-gray-200 dark:border-gray-700">
                                    {sgRNA.id}
                                </span>
                            </h2>
                            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 font-mono text-lg flex items-center justify-between group">
                                <div>
                                    <span className="text-gray-800 dark:text-gray-200 tracking-wider">
                                        {sgRNA.sequence.substring(0, 20)}
                                    </span>
                                    <span className="text-teal-600 font-bold ml-1">{sgRNA.pam}</span>
                                </div>
                                <button className="text-gray-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-all">
                                    <Copy size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="inline-flex flex-col items-end">
                                <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Specificity Risk</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold text-lg mt-1 flex items-center">
                                    <CheckCircle size={18} className="mr-1.5" /> LOW
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-800/30">
                            <span className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold uppercase">On-Target Activity</span>
                            <div className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-400">{sgRNA.onTargetScore}</div>
                            <p className="text-xs text-emerald-600/80 dark:text-emerald-400/60 mt-1">Predicted via CRISPR-Net</p>
                        </div>
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/30">
                            <span className="text-xs text-blue-800 dark:text-blue-300 font-semibold uppercase">Specificity Score</span>
                            <div className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-400">{sgRNA.specificityScore}</div>
                            <p className="text-xs text-blue-600/80 dark:text-blue-400/60 mt-1">MIT Scoring Model</p>
                        </div>
                    </div>

                    <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-4">Top Predicted Off-Targets</h3>
                    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                <tr>
                                    <th className="px-4 py-2 text-left">Gene</th>
                                    <th className="px-4 py-2 text-left">Locus</th>
                                    <th className="px-4 py-2 text-center">Mismatches</th>
                                    <th className="px-4 py-2 text-center">Risk Score</th>
                                    <th className="px-4 py-2 text-center">Validation</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {sgRNA.offTargets.map((ot, i) => (
                                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="px-4 py-3 font-medium">{ot.gene}</td>
                                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{ot.locus}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">
                                                {ot.mismatches} MM
                                                {ot.bulges > 0 && ` + ${ot.bulges} Bulge`}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center font-bold text-gray-700 dark:text-gray-300">
                                            {ot.score.toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {ot.validated ? (
                                                <span className="inline-flex items-center text-emerald-600 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-800">
                                                    <CheckCircle size={10} className="mr-1" /> GUIDE-seq
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-xs">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-[#262828] rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 p-6">
                        <h3 className="text-md font-semibold text-[#134252] dark:text-[#f5f5f5] mb-4">Genome Browser</h3>
                        <div className="aspect-video bg-gray-100 dark:bg-gray-900 rounded-lg flex items-center justify-center border border-gray-200 dark:border-gray-700">
                            <p className="text-xs text-gray-400">IGV.js Visualization</p>
                        </div>
                        <button className="w-full mt-4 text-sm text-teal-600 hover:text-teal-700 font-medium border border-teal-200 dark:border-teal-900/50 rounded-lg py-2 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors flex items-center justify-center">
                            Open Full Browser <ExternalLink size={14} className="ml-2" />
                        </button>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-6 border border-amber-100 dark:border-amber-800/30">
                        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-500 flex items-center mb-2">
                            <AlertTriangle size={16} className="mr-2" />
                            Validation Recommendation
                        </h3>
                        <p className="text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">
                            This sgRNA has a known off-target in <strong>EGFR</strong> (1 mismatch).
                            If observing an EGFR-related phenotype, validate with orthogonal sgRNA or rescue experiment.
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
}
