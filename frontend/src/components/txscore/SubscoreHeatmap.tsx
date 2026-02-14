'use client';

import { useMemo, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { TxScore } from '@sdk/txscore-client';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface SubscoreHeatmapProps {
    data: TxScore[];
}

export default function SubscoreHeatmap({ data }: SubscoreHeatmapProps) {
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        const checkDark = () => document.documentElement.classList.contains('dark');
        setIsDark(checkDark());
        const observer = new MutationObserver(checkDark);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const topData = data.slice(0, 20);

    const plotData = useMemo(() => {
        const genes = topData.map(d => d.gene_id);
        const metrics = ['Efficacy', 'Safety', 'Druggability', 'Precedent', 'TVS'];

        // Rows = metrics, Cols = genes? No, Usually Rows=Genes in heatmap if many genes. 
        // Or Rows=Genes if we want listlike.
        // Let's do Genes on X for horizontal readability if few, or Genes on Y if many.
        // Top 20 fits on X usually.

        const zData = topData.map(d => [
            d.efficacy_score,
            d.safety_score,
            d.druggability_score,
            d.precedent_score,
            d.tvs
        ]);

        // Z must be array of arrays of numbers.
        // If x=genes, y=metrics:
        // z[0] is column for gene 0? No, z is usually row-major.
        // We want metrics on Y. So z should be array of metric values (rows).
        const zTransposed = metrics.map((_, i) => zData.map(row => row[i]));

        return [
            {
                z: zTransposed,
                x: genes,
                y: metrics,
                type: 'heatmap',
                colorscale: 'Blues',
                hoverongaps: false,
                xgap: 1,
                ygap: 1,
                showscale: true,
                colorbar: {
                    tickfont: { color: isDark ? '#e5e7eb' : '#1f2937' }
                }
            }
        ] as any[];
    }, [topData, isDark]);

    const layout = useMemo(() => {
        return {
            title: 'Top 20 Targets - Subscore Breakdown',
            margin: { t: 40, r: 20, b: 60, l: 80 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: {
                family: 'var(--font-sans)',
                color: isDark ? '#e5e7eb' : '#1f2937'
            },
            xaxis: {
                tickangle: -45,
                tickfont: { color: isDark ? '#e5e7eb' : '#1f2937' }
            },
            yaxis: {
                tickfont: { color: isDark ? '#e5e7eb' : '#1f2937' }
            },
            autosize: true
        } as any;
    }, [isDark]);

    return (
        <div className="w-full h-80 border border-border rounded-lg bg-card p-4">
            <Plot
                data={plotData}
                layout={layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: '100%' }}
            />
        </div>
    );
}
