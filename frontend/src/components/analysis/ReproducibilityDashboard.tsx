'use client';

import { motion } from 'framer-motion';
import { Info, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { WBCScoreCard } from './WBCScoreCard';
import { BinwiseCorrelationChart } from './BinwiseCorrelationChart';
import { ReproducibilityMetrics } from '@/lib/analysis/reproducibility-metrics';

interface ReproducibilityDashboardProps {
    metrics: ReproducibilityMetrics;
}

export function ReproducibilityDashboard({ metrics }: ReproducibilityDashboardProps) {

    const getQualityBadgeStyle = (quality: string) => {
        switch (quality) {
            case 'EXCELLENT': return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
            case 'GOOD': return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
            case 'POOR': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
            default: return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
        }
    };

    const getQualityIcon = (quality: string) => {
        switch (quality) {
            case 'EXCELLENT': return <CheckCircle className="w-5 h-5" />;
            case 'GOOD': return <CheckCircle className="w-5 h-5" />;
            case 'POOR': return <AlertTriangle className="w-5 h-5" />;
            default: return <HelpCircle className="w-5 h-5" />;
        }
    };

    return (
        <div className="space-y-6 p-1 max-w-[1200px] mx-auto animate-in fade-in duration-500">
            {/* Hero Section */}
            <div className="glass-card p-8 rounded-2xl bg-gradient-to-br from-white/90 to-white/70 dark:from-slate-800/90 dark:to-slate-800/70 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h2 className="text-3xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                                Context-Specific Reproducibility
                            </h2>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                BETA
                            </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 text-lg max-w-2xl leading-relaxed">
                            Advanced quality assessment for genetic interaction and drug response screens based on differential signal stability.
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-3">
                        {/* Quality Badge */}
                        <div className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-lg border shadow-sm ${getQualityBadgeStyle(metrics.overallQuality)}`}>
                            {getQualityIcon(metrics.overallQuality)}
                            {metrics.overallQuality}
                        </div>

                        {/* Info Tooltip */}
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors">
                                    <Info className="w-4 h-4" />
                                    <span>About these metrics</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-md p-4 bg-slate-900 text-slate-100 border-slate-800">
                                    <p className="text-sm leading-relaxed">
                                        Unlike traditional metrics that measure technical correlation (often dominated by library abundance),
                                        these context-specific metrics assess whether your biological replicates show true signal reproducibility
                                        distinct from unrelated screens. Based on Billmann et al., Cell Systems 2023.
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <WBCScoreCard wbcScore={metrics.wbcScore} wbcZScore={metrics.wbcZScore} />

                {/* Traditional Metrics Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="glass-card p-6 rounded-2xl backdrop-blur-xl border border-white/20 shadow-xl bg-white/50 dark:bg-slate-800/50"
                >
                    <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                        Traditional Metrics
                        <span className="text-[10px] font-normal text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded">Legacy</span>
                    </h3>

                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between items-baseline mb-1">
                                <span className="text-sm text-slate-500">Read Count PCC</span>
                                <span className="text-2xl font-bold font-mono text-slate-700 dark:text-slate-200">{metrics.readcountPCC.toFixed(2)}</span>
                            </div>
                            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-slate-400 dark:bg-slate-500 rounded-full"
                                    style={{ width: `${metrics.readcountPCC * 100}%` }}
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-baseline mb-1">
                                <span className="text-sm text-slate-500">LFC Correlation</span>
                                <span className="text-2xl font-bold font-mono text-slate-700 dark:text-slate-200">{metrics.lfcPCC.toFixed(2)}</span>
                            </div>
                            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-slate-400 dark:bg-slate-500 rounded-full"
                                    style={{ width: `${Math.max(0, metrics.lfcPCC) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-slate-400 mt-4 leading-normal">
                        High values here are necessary but not sufficient for quality. Often inflated by non-targeting guides.
                    </p>
                </motion.div>

                {/* Signal Quality Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="glass-card p-6 rounded-2xl backdrop-blur-xl border border-white/20 shadow-xl bg-white/50 dark:bg-slate-800/50"
                >
                    <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-4">Signal Quality</h3>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-slate-100 dark:bg-slate-900/50 rounded-xl">
                            <div className="text-xs text-slate-500 mb-1">Signal Density</div>
                            <div className="text-xl font-bold text-slate-800 dark:text-slate-200">{metrics.signalDensity.toFixed(1)}%</div>
                        </div>
                        <div className="p-3 bg-slate-100 dark:bg-slate-900/50 rounded-xl">
                            <div className="text-xs text-slate-500 mb-1">Skew Index</div>
                            <div className="text-xl font-bold text-slate-800 dark:text-slate-200">{metrics.skewIndex.toFixed(2)}</div>
                        </div>
                    </div>

                    <div className="mt-4 text-xs text-slate-400 space-y-2">
                        <p><strong>Signal Density:</strong> % of guides with strong effect sizes.</p>
                        <p><strong>Skew Index:</strong> Asymmetry of LFC distribution (should be negative for essentiality screens).</p>
                    </div>
                </motion.div>
            </div>

            {/* Bin-wise Analysis Chart */}
            <BinwiseCorrelationChart data={metrics.binwiseCorrelations} />

            {/* Recommendation Panel */}
            <div className={`p-6 rounded-2xl border ${metrics.shouldProceed
                    ? 'bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border-slate-200 dark:border-slate-700'
                    : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30'
                }`}>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    {metrics.shouldProceed ? 'Recommendation' : 'CRITICAL WARNING'}
                </h3>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    {metrics.recommendation}
                </p>
            </div>
        </div>
    );
}
