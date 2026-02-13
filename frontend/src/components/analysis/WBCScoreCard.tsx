'use client';

import { motion } from 'framer-motion';
import { TrendingUp, Info } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

interface WBCScoreCardProps {
    wbcScore: number;
    wbcZScore: number;
}

export function WBCScoreCard({ wbcScore, wbcZScore }: WBCScoreCardProps) {

    const isExcellent = wbcZScore > 3;
    const isGood = wbcZScore > 1.5;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6 rounded-2xl backdrop-blur-xl border border-white/20 shadow-xl bg-white/50 dark:bg-slate-800/50"
        >
            <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 shadow-lg shadow-teal-500/20">
                    <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h3 className="font-semibold text-slate-700 dark:text-slate-200">WBC Z-Score</h3>
                    <p className="text-xs text-slate-500">Within-vs-Between Context</p>
                </div>
            </div>

            {/* Large Number Display */}
            <div className="mb-4">
                <div className={`text-5xl font-bold font-mono tracking-tight ${isExcellent ? 'text-green-600 dark:text-green-400' : isGood ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                    {wbcZScore.toFixed(2)}
                </div>
                <div className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                    Correlation: {(wbcScore * 100).toFixed(1)}%
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <Info className="w-3 h-3 text-slate-400 hover:text-slate-600 transition-colors" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="max-w-[200px] text-xs">
                                    Raw correlation between replicates. High correlation alone does not guarantee biological signal if unrelated screens also correlate highly.
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Visual Indicator */}
            <div className="relative h-3 bg-slate-200 dark:bg-slate-700/50 rounded-full overflow-hidden mb-4">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(Math.max((wbcZScore / 5) * 100, 5), 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                    className={`absolute h-full rounded-full ${isExcellent ? 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' :
                            isGood ? 'bg-gradient-to-r from-yellow-500 to-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' :
                                'bg-gradient-to-r from-red-500 to-rose-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                        }`}
                />
            </div>

            {/* Benchmark Reference */}
            <div className="pt-4 border-t border-slate-200/50 dark:border-slate-700/50">
                <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-1">
                    <span>Poor</span>
                    <span>Good</span>
                    <span>Excellent</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-mono opacity-70">
                    <span>z &lt; 1</span>
                    <span>z = 1-3</span>
                    <span>z &gt; 3</span>
                </div>
            </div>

            {/* Interpretation */}
            <div className={`mt-4 p-3 rounded-lg text-xs leading-relaxed ${isExcellent ? 'bg-green-50 dark:bg-green-900/10 text-green-800 dark:text-green-200 border border-green-100 dark:border-green-900/20' :
                    isGood ? 'bg-yellow-50 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-200 border border-yellow-100 dark:border-yellow-900/20' :
                        'bg-red-50 dark:bg-red-900/10 text-red-800 dark:text-red-200 border border-red-100 dark:border-red-900/20'
                }`}>
                <p>
                    {isExcellent && "🎯 Excellent! Replicates are highly reproducible and clearly distinct from unrelated screens."}
                    {isGood && !isExcellent && "✓ Good reproducibility. Replicates show consistent biological signal."}
                    {!isGood && "⚠️ Poor reproducibility. Replicates are not more similar than random pairs."}
                </p>
            </div>
        </motion.div>
    );
}
