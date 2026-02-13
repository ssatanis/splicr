
'use client';

import React, { useState, useEffect } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell,
    PieChart,
    Pie
} from 'recharts';
import { Info, AlertTriangle, CheckCircle, ExternalLink, Download } from 'lucide-react';
import SuspiciousHitsTable from './SuspiciousHitsTable';
import SgRNADetailView from './SgRNADetailView';

// Types (would normally import from a shared types file)
interface OffTargetDashboardProps {
    analysisId: string;
}

export default function OffTargetDashboard({ analysisId }: OffTargetDashboardProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [selectedView, setSelectedView] = useState<'overview' | 'suspicious' | 'details'>('overview');

    useEffect(() => {
        // Determine if we need to mock data or fetch
        // For now, we'll simulate a fetch
        const fetchData = async () => {
            try {
                setLoading(true);
                // In real app: const res = await fetch(`/api/analysis/${analysisId}/off-targets`);
                // const json = await res.json();

                // Mock data for UI development
                await new Promise(resolve => setTimeout(resolve, 1500));
                setData({
                    stats: {
                        totalSgRNAs: 87453,
                        validatedOffTargets: 2341,
                        predictedOffTargets: 45678,
                        riskDistribution: [
                            { name: 'Low Risk', value: 72, color: '#10b981' },
                            { name: 'Medium Risk', value: 23, color: '#f59e0b' },
                            { name: 'High Risk', value: 5, color: '#ef4444' }
                        ]
                    },
                    suspiciousHits: [
                        { gene: 'BRCA1', risk: 'LOW', sgRNACount: '4/4', concordance: 0.92, sharedOffTargets: 0.12 },
                        { gene: 'MYC', risk: 'MEDIUM', sgRNACount: '4/4', concordance: 0.85, sharedOffTargets: 0.58 },
                        { gene: 'XYZ123', risk: 'HIGH', sgRNACount: '2/4', concordance: 0.31, sharedOffTargets: 0 }
                    ]
                });
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [analysisId]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-96 space-y-4">
                <div className="w-12 h-12 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-gray-400 font-medium animate-pulse">Analyzing off-target risks...</p>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-8 bg-[#fcfcf9] dark:bg-[#1f2121] min-h-screen">

            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-[#134252] dark:text-[#f5f5f5]">
                        Off-Target Risk Assessment
                    </h1>
                    <p className="text-[#626c71] dark:text-gray-400 mt-1">
                        Real-time validation using CRISPRoffT and CRISPRitz
                    </p>
                </div>
                <div className="flex space-x-3">
                    <button className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-[#262828] border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md transition-all text-sm font-medium">
                        <Download size={16} />
                        <span>Export Report</span>
                    </button>
                </div>
            </div>

            {/* Hero Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total sgRNAs"
                    value={data.stats.totalSgRNAs.toLocaleString()}
                    subtitle="Analyzed"
                    icon={<CheckCircle className="text-teal-600" size={24} />}
                />
                <StatCard
                    title="Validated Off-Targets"
                    value={data.stats.validatedOffTargets.toLocaleString()}
                    subtitle="Found in CRISPRoffT"
                    icon={<AlertTriangle className="text-amber-500" size={24} />}
                />
                <StatCard
                    title="Predicted Off-Targets"
                    value={data.stats.predictedOffTargets.toLocaleString()}
                    subtitle="CRISPRitz (up to 4 mismatches)"
                    icon={<Info className="text-blue-500" size={24} />}
                />
            </div>

            {/* Main Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Risk Distribution Chart */}
                <div className="lg:col-span-1 bg-white dark:bg-[#262828] p-6 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 backdrop-blur-xl bg-opacity-90">
                    <h3 className="text-lg font-semibold mb-6 text-[#134252] dark:text-[#f5f5f5]">Risk Distribution</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data.stats.riskDistribution}
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {data.stats.riskDistribution.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#262828', borderColor: '#374151', borderRadius: '8px', color: '#f5f5f5' }}
                                    itemStyle={{ color: '#f5f5f5' }}
                                />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                        <div className="flex items-start space-x-2">
                            <Info size={16} className="mt-0.5" />
                            <p>72% of your library is low risk. Recommend validating top hits from the low-risk category first.</p>
                        </div>
                    </div>
                </div>

                {/* Suspicious Hits Table & Detail View */}
                <div className="lg:col-span-2">
                    {selectedView === 'details' ? (
                        <SgRNADetailView
                            sgrnaId="sgRNA_12345"
                            onBack={() => setSelectedView('overview')}
                        />
                    ) : (
                        <SuspiciousHitsTable
                            hits={data.suspiciousHits}
                            onSelectHit={(gene) => setSelectedView('details')}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, subtitle, icon }: any) {
    return (
        <div className="bg-white dark:bg-[#262828] p-6 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 backdrop-blur-xl bg-opacity-90 hover:scale-[1.02] transition-transform duration-300">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
                    <h3 className="text-3xl font-bold mt-2 text-[#134252] dark:text-[#f5f5f5] tabular-nums">{value}</h3>
                    <p className="text-xs mt-2 text-gray-400 dark:text-gray-500">{subtitle}</p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    {icon}
                </div>
            </div>
        </div>
    );
}
