'use client';

import { useMemo, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { TxScore } from '@sdk/txscore-client';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface TherapeuticWindowPlotProps {
    data: TxScore[];
    onPointClick?: (geneId: string) => void;
}

export default function TherapeuticWindowPlot({ data, onPointClick }: TherapeuticWindowPlotProps) {
    // Simple dark mode detection via class
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        const checkDark = () => document.documentElement.classList.contains('dark');
        setIsDark(checkDark());
        const observer = new MutationObserver(checkDark);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const plotData = useMemo(() => {
        return [
            {
                x: data.map(d => d.safety_score),
                y: data.map(d => d.efficacy_score),
                text: data.map(d => `${d.gene_id}<br>TVS: ${d.tvs.toFixed(2)}`),
                mode: 'markers',
                type: 'scatter',
                marker: {
                    size: data.map(d => Math.max(8, d.tvs * 20)), // Size by TVS
                    color: data.map(d => d.druggability_score), // Color by Druggability
                    colorscale: 'Viridis',
                    showscale: true,
                    colorbar: {
                        title: 'Druggability',
                        thickness: 20,
                        len: 0.75,
                        tickfont: { color: isDark ? '#e5e7eb' : '#1f2937' },
                        titlefont: { color: isDark ? '#e5e7eb' : '#1f2937' }
                    },
                    opacity: 0.8,
                    line: {
                        color: isDark ? '#ffffff' : '#000000',
                        width: 1
                    }
                },
                hoverinfo: 'text'
            }
        ] as any[];
    }, [data, isDark]);

    const layout = useMemo(() => {
        return {
            title: 'Therapeutic Window (Safety vs. Efficacy)',
            xaxis: {
                title: 'Safety Score (Higher is Safer)',
                range: [0, 1.05],
                gridcolor: isDark ? '#333' : '#eee',
                zerolinecolor: isDark ? '#666' : '#ccc',
                tickfont: { color: isDark ? '#e5e7eb' : '#1f2937' },
                titlefont: { color: isDark ? '#e5e7eb' : '#1f2937' }
            },
            yaxis: {
                title: 'Efficacy Score (Higher is More Effective)',
                range: [0, 1.05],
                gridcolor: isDark ? '#333' : '#eee',
                zerolinecolor: isDark ? '#666' : '#ccc',
                tickfont: { color: isDark ? '#e5e7eb' : '#1f2937' },
                titlefont: { color: isDark ? '#e5e7eb' : '#1f2937' }
            },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: {
                family: 'var(--font-sans)',
                color: isDark ? '#e5e7eb' : '#1f2937'
            },
            margin: { t: 40, r: 20, b: 50, l: 60 },
            autosize: true,
            hovermode: 'closest',
            shapes: [
                // Ideal quadrant box
                {
                    type: 'rect',
                    x0: 0.7,
                    y0: 0.7,
                    x1: 1,
                    y1: 1,
                    fillcolor: isDark ? 'rgba(0, 255, 0, 0.1)' : 'rgba(0, 255, 0, 0.05)',
                    line: {
                        width: 0
                    }
                }
            ]
        } as any;
    }, [isDark]);

    return (
        <div className="w-full h-96 border border-border rounded-lg bg-card p-4">
            <Plot
                data={plotData}
                layout={layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: '100%' }}
                onClick={(e: any) => {
                    if (e.points && e.points[0] && onPointClick) {
                        const text = e.points[0].text;
                        const geneId = text.split('<br>')[0];
                        onPointClick(geneId);
                    }
                }}
            />
        </div>
    );
}
