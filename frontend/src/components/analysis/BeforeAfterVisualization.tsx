import React from 'react';
import Plot from 'react-plotly.js';

interface PCAPoint {
    x: number;
    y: number;
    batch: string;
    stage: string;
}

interface Metrics {
    silhouetteBefore: number;
    silhouetteAfter: number;
    pcaR2Before: number;
    pcaR2After: number;
}

interface BeforeAfterVisualizationProps {
    pcaPoints: PCAPoint[];
    metrics: Metrics;
}

export function BeforeAfterVisualization({ pcaPoints, metrics }: BeforeAfterVisualizationProps) {

    // Split points
    const beforePoints = pcaPoints.filter(p => p.stage === 'Before');
    const afterPoints = pcaPoints.filter(p => p.stage === 'After');

    // Group by batch for coloring
    // Helper to get trace
    const getTrace = (points: PCAPoint[], name: string, color: string) => {
        const p = points.filter(pt => pt.batch === name);
        return {
            x: p.map(pt => pt.x),
            y: p.map(pt => pt.y),
            type: 'scatter' as const,
            mode: 'markers' as const,
            marker: { color, size: 8, opacity: 0.7 },
            name
        };
    };

    const tracesBefore = [
        getTrace(beforePoints, 'User', '#0d9488'), // Teal-600
        getTrace(beforePoints, 'DepMap', '#94a3b8') // Slate-400
    ];

    const tracesAfter = [
        getTrace(afterPoints, 'User', '#0d9488'),
        getTrace(afterPoints, 'DepMap', '#94a3b8')
    ];

    const layout = {
        autosize: true,
        height: 300,
        margin: { l: 40, r: 20, t: 20, b: 40 },
        showlegend: false, // shared legend? or per plot
        xaxis: { title: 'PC1' },
        yaxis: { title: 'PC2' },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: 'Inter, sans-serif' }
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Before Correction */}
                <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex justify-between">
                        Before Correction
                        <span className="text-xs font-normal bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                            Batch Effect: High (R²={(metrics.pcaR2Before).toFixed(2)})
                        </span>
                    </h3>
                    <div className="w-full h-[300px]">
                        <Plot
                            data={tracesBefore}
                            layout={{ ...layout, title: undefined }}
                            useResizeHandler={true}
                            style={{ width: '100%', height: '100%' }}
                            config={{ displayModeBar: false }}
                        />
                    </div>
                </div>

                {/* After Correction */}
                <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex justify-between">
                        After Correction
                        <span className="text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                            Batch Effect: Low (R²={(metrics.pcaR2After).toFixed(2)})
                        </span>
                    </h3>
                    <div className="w-full h-[300px]">
                        <Plot
                            data={tracesAfter}
                            layout={{ ...layout, title: undefined }}
                            useResizeHandler={true}
                            style={{ width: '100%', height: '100%' }}
                            config={{ displayModeBar: false }}
                        />
                    </div>
                </div>
            </div>

            {/* Metrics Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 bg-slate-50 dark:bg-slate-800/80 p-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <div>Metric</div>
                    <div>Before</div>
                    <div>After</div>
                    <div>Change</div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    <MetricRow
                        label="Batch Variance (PCA R²)"
                        before={metrics.pcaR2Before}
                        after={metrics.pcaR2After}
                        desirable="lower"
                    />
                    {/* Placeholder Silhouette if available */}
                </div>
            </div>
        </div>
    );
}

function MetricRow({ label, before, after, desirable }: { label: string, before: number, after: number, desirable: 'lower' | 'higher' }) {
    const isBetter = desirable === 'lower' ? after < before : after > before;
    const diff = after - before;
    const diffPct = (diff / before) * 100;

    return (
        <div className="grid grid-cols-4 p-3 text-sm">
            <div className="font-medium text-slate-700 dark:text-slate-300">{label}</div>
            <div className="text-slate-500">{before.toFixed(3)}</div>
            <div className="text-slate-900 dark:text-slate-100 font-semibold">{after.toFixed(3)}</div>
            <div className={isBetter ? "text-emerald-600" : "text-amber-600"}>
                {isBetter ? '✓ Improved' : '—'}
                <span className="ml-1 text-xs opacity-70">
                    ({diff > 0 ? '+' : ''}{diff.toFixed(2)})
                </span>
            </div>
        </div>
    );
}
