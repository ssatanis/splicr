'use client';

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts';
import { Info } from 'lucide-react';
import {
    Tooltip as UiTooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

interface BinData {
    bin: string;
    correlation: number;
    pValue: number;
}

interface BinwiseCorrelationChartProps {
    data: BinData[];
}

export function BinwiseCorrelationChart({ data }: BinwiseCorrelationChartProps) {
    return (
        <div className="glass-card p-6 rounded-2xl backdrop-blur-xl bg-white/50 dark:bg-slate-800/50 border border-white/20 shadow-xl">
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Signal Localization Analysis</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Correlation analysis across different effect size bins
                    </p>
                </div>
                <TooltipProvider>
                    <UiTooltip>
                        <TooltipTrigger>
                            <div className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                <Info className="w-5 h-5 text-slate-400" />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                            <p className="text-xs">
                                True biological signal usually resides in the strong hits (Top 5-10%).
                                High correlation in the middle/bulk of the distribution is often due to library representation bias rather than biological effect.
                            </p>
                        </TooltipContent>
                    </UiTooltip>
                </TooltipProvider>
            </div>

            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                        <XAxis
                            dataKey="bin"
                            angle={-25}
                            textAnchor="end"
                            height={80}
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            interval={0}
                            tickLine={false}
                            axisLine={{ stroke: '#e2e8f0' }}
                        />
                        <YAxis
                            label={{ value: 'Pearson Correlation', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 12 } }}
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                            content={({ active, payload }) => {
                                if (active && payload && payload[0]) {
                                    const data = payload[0].payload as BinData;
                                    return (
                                        <div className="bg-white/95 dark:bg-slate-800/95 p-4 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm">
                                            <p className="font-semibold text-slate-800 dark:text-slate-200 mb-2">{data.bin}</p>
                                            <div className="space-y-1">
                                                <p className="text-sm text-slate-600 dark:text-slate-300 flex justify-between gap-4">
                                                    <span>Correlation:</span>
                                                    <span className="font-mono font-semibold">{data.correlation.toFixed(3)}</span>
                                                </p>
                                                <p className="text-sm text-slate-600 dark:text-slate-300 flex justify-between gap-4">
                                                    <span>P-Value:</span>
                                                    <span className="font-mono">{data.pValue < 0.001 ? '< 0.001' : data.pValue.toFixed(3)}</span>
                                                </p>
                                            </div>
                                            <div className={`mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-xs font-medium ${data.correlation > 0.7 ? 'text-green-600' :
                                                    data.correlation > 0.4 ? 'text-yellow-600' :
                                                        'text-red-500'
                                                }`}>
                                                {data.correlation > 0.7 ? '✓ Strong correlation' :
                                                    data.correlation > 0.4 ? '~ Moderate correlation' :
                                                        '⚠ Weak correlation'}
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Bar
                            dataKey="correlation"
                            radius={[6, 6, 0, 0]}
                            animationDuration={1500}
                        >
                            {data.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.correlation > 0.7 ? '#10b981' : entry.correlation > 0.4 ? '#f59e0b' : '#ef4444'}
                                    fillOpacity={0.8}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-2 p-4 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20">
                <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                    <strong>Interpretation:</strong> Healthy screens show highest correlation in the
                    <span className="font-semibold mx-1">Top 5-10%</span> bins.
                    If correlation is highest in "Middle 50%", you are likely measuring library representation noise rather than biological signal.
                </p>
            </div>
        </div>
    );
}
