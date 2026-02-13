
'use client';

import React from 'react';
import { AlertTriangle, ExternalLink, ChevronDown, ChevronRight, Info } from 'lucide-react';

interface SuspiciousHitsTableProps {
    hits: any[];
    onSelectHit: (gene: string) => void;
}

export default function SuspiciousHitsTable({ hits, onSelectHit }: SuspiciousHitsTableProps) {
    // We'll manage expanded state locally
    const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

    const toggleRow = (gene: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(gene)) {
            newExpanded.delete(gene);
        } else {
            newExpanded.add(gene);
        }
        setExpandedRows(newExpanded);
    };

    return (
        <div className="bg-white dark:bg-[#262828] rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-semibold text-[#134252] dark:text-[#f5f5f5] flex items-center space-x-2">
                        <AlertTriangle className="text-amber-500" size={20} />
                        <span>Suspicious Hits & Discordance Analysis</span>
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Genes flagged due to phenotypic discordance or high off-target overlap among sgRNAs.
                    </p>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                        <tr>
                            <th className="w-10 px-4 py-3"></th>
                            <th className="px-4 py-3">Gene</th>
                            <th className="px-4 py-3">Risk Level</th>
                            <th className="px-4 py-3"># sgRNAs</th>
                            <th className="px-4 py-3">Concordance</th>
                            <th className="px-4 py-3">Shared OT Overlap</th>
                            <th className="px-4 py-3">Recommendation</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {hits.map((hit, idx) => {
                            const isExpanded = expandedRows.has(hit.gene);
                            return (
                                <React.Fragment key={hit.gene}>
                                    <tr
                                        className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer ${isExpanded ? 'bg-gray-50 dark:bg-gray-800/30' : ''}`}
                                        onClick={() => toggleRow(hit.gene)}
                                    >
                                        <td className="px-4 py-4 text-gray-400">
                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </td>
                                        <td className="px-4 py-4 font-semibold text-[#134252] dark:text-[#f5f5f5]">{hit.gene}</td>
                                        <td className="px-4 py-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${hit.risk === 'LOW' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
                                                    hit.risk === 'MEDIUM' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                                                        'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                                }`}>
                                                {hit.risk}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-gray-600 dark:text-gray-400 font-mono">{hit.sgRNACount}</td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center space-x-2">
                                                <span className={`font-mono ${hit.concordance < 0.6 ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}`}>
                                                    {hit.concordance.toFixed(2)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-gray-600 dark:text-gray-400">{(hit.sharedOffTargets * 100).toFixed(0)}%</td>
                                        <td className="px-4 py-4">
                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                {hit.risk === 'HIGH' ? 'Discard / Rescreen' : hit.risk === 'MEDIUM' ? 'Check OT manually' : 'Safe to validate'}
                                            </span>
                                        </td>
                                    </tr>

                                    {isExpanded && (
                                        <tr className="bg-gray-50/50 dark:bg-gray-800/20">
                                            <td colSpan={7} className="px-4 py-4">
                                                <div className="ml-10 p-4 bg-white dark:bg-[#1f2121] rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                                                    <h4 className="text-sm font-semibold mb-3 flex items-center text-gray-700 dark:text-gray-300">
                                                        <Info size={16} className="mr-2 text-teal-500" />
                                                        Detailed Reasoning
                                                    </h4>
                                                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                                        {hit.reasoning || "Discordance detected among replicates. 2 sgRNAs show strong depletion while 2 show no effect."}
                                                    </p>

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <h5 className="text-xs uppercase text-gray-500 font-semibold mb-2">Flagged sgRNAs</h5>
                                                            <div className="space-y-1">
                                                                {['sgRNA_1', 'sgRNA_2'].map(sg => (
                                                                    <div key={sg} className="text-xs font-mono bg-gray-100 dark:bg-gray-800 p-1.5 rounded text-gray-700 dark:text-gray-300">
                                                                        {sg}: GCTAGCTAGCTAGCTAGC...
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-end justify-end">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onSelectHit(hit.gene); }}
                                                                className="px-3 py-1.5 bg-teal-600 hoer:bg-teal-700 text-white text-xs font-medium rounded-md shadow-sm transition-colors flex items-center"
                                                            >
                                                                View Full Analysis <ExternalLink size={12} className="ml-1.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
