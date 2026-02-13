'use client';

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';
import { Info } from 'lucide-react';

interface SampleStat {
  name: string;
  totalReads: number;
  avgQuality?: string;
  gcContent?: string;
  uniqueSgRNAs?: number;
  mappingRate?: string | number;
}

interface QCChartsProps {
  readCounts?: { sample: string; reads: number }[];
  correlation?: number[][];
  coverage?: { sample: string; coverage: number }[];
  giniCoefficient?: number;
  sampleStats?: SampleStat[];
  lorenzCurve?: { cumulative_population: number; cumulative_reads: number }[];
  /** When 'demo', show notice that metrics are from demo data; run with sequencing data for real QC. */
  resultsSource?: 'demo' | 'pipeline';
}

const EmptyQC = () => (
  <div className="bg-surface rounded-xl p-12 border border-border text-center">
    <p className="text-text-secondary font-serif">No QC data available.</p>
    <p className="text-text-tertiary text-sm mt-2">Quality metrics will appear when the analysis pipeline produces real results.</p>
  </div>
);

export default function QCCharts({
  readCounts,
  correlation,
  coverage,
  giniCoefficient,
  sampleStats,
  lorenzCurve,
  resultsSource,
}: QCChartsProps) {
  const hasReadCounts = readCounts && readCounts.length > 0;
  const hasCorrelation = correlation && correlation.length > 0;
  const hasCoverage = coverage && coverage.length > 0;
  const hasGini = typeof giniCoefficient === 'number';
  const hasSampleStats = sampleStats && sampleStats.length > 0;
  const hasLorenz = lorenzCurve && lorenzCurve.length > 0;
  const isDemo = resultsSource === 'demo';

  const sampleNames = sampleStats?.map(s => s.name) ||
    (hasReadCounts ? readCounts!.map(d => d.sample) : []);

  const hasAnyData = hasReadCounts || hasCorrelation || hasCoverage || hasGini || hasSampleStats || hasLorenz;

  if (!hasAnyData) {
    return (
      <div className="space-y-8">
        <EmptyQC />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {isDemo && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>Demo data.</strong> These QC metrics are from a demo run. To see real Gini coefficient, read counts, and correlations from your sequencing data, run an analysis with your own FASTQ or count files.
        </div>
      )}
      {/* Sample Statistics Table — only when real data */}
      {hasSampleStats && (
        <div className="bg-surface rounded-xl p-6 shadow-card border border-border">
          <h3 className="text-xl font-serif mb-4 text-text-primary">Sample statistics</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Sample</th>
                  <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Total Reads</th>
                  <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Unique sgRNAs</th>
                  <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Avg Quality</th>
                  <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">GC Content</th>
                  <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Mapping Rate</th>
                </tr>
              </thead>
              <tbody>
                {sampleStats!.map((sample, idx) => (
                  <tr key={idx} className="border-b border-border-light hover:bg-background">
                    <td className="px-4 py-3 text-sm font-mono font-medium text-text-primary">{sample.name}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {(sample.totalReads / 1e6).toFixed(2)}M
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {(sample.uniqueSgRNAs ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {sample.avgQuality || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {sample.gcContent ? `${sample.gcContent}%` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {sample.mappingRate ? `${sample.mappingRate}%` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Read Count Distribution */}
        <div className="bg-surface rounded-xl p-6 shadow-card border border-border">
          <h3 className="text-xl font-serif mb-4 text-text-primary flex items-center gap-2">
            Read count per sample
            <span title="Total number of successfully mapped reads for each sample. Benchmarking suggests 10M+ for genome-scale screens.">
              <Info className="w-4 h-4 text-text-tertiary cursor-help" />
            </span>
          </h3>
          {hasReadCounts ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={readCounts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
                <XAxis
                  dataKey="sample"
                  tick={{ fontSize: 12, fontFamily: 'Instrument Serif' }}
                  tickLine={false}
                />
                <YAxis
                  label={{ value: 'Reads (millions)', angle: -90, position: 'insideLeft', style: { fontFamily: 'Instrument Serif' } }}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  content={({ active, payload, label }: { active?: boolean; payload?: readonly any[]; label?: any }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface p-3 rounded-lg shadow-lg border border-border">
                          <p className="font-serif text-text-primary">{label}</p>
                          <p className="text-sm text-text-secondary">
                            {Number(payload[0].value).toFixed(2)}M reads
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="reads" fill="#6ABF36" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyQC />
          )}
        </div>

        {/* Sample Correlation Heatmap */}
        <div className="bg-surface rounded-xl p-6 shadow-card border border-border">
          <h3 className="text-xl font-serif mb-4 text-text-primary flex items-center gap-2">
            Sample correlation matrix
            <span title="Pearson correlation of sgRNA counts between samples. High correlation (>0.8) between replicates is expected.">
              <Info className="w-4 h-4 text-text-tertiary cursor-help" />
            </span>
          </h3>
          {hasCorrelation ? (
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${correlation!.length}, 1fr)` }}>
                  {correlation!.map((row, i) =>
                    row.map((val, j) => (
                      <div
                        key={`${i}-${j}`}
                        className="aspect-square flex items-center justify-center rounded text-xs font-mono transition-all hover:scale-105"
                        style={{
                          backgroundColor: getCorrelationColor(val),
                          color: val > 0.7 ? '#1A1A1A' : '#6B6B6B'
                        }}
                        title={sampleNames[i] && sampleNames[j] ? `${sampleNames[i]} vs ${sampleNames[j]}: ${val.toFixed(3)}` : `${val.toFixed(3)}`}
                      >
                        {val.toFixed(2)}
                      </div>
                    ))
                  )}
                </div>
                {sampleNames.length > 0 && (
                  <div className="grid gap-1 mt-2" style={{ gridTemplateColumns: `repeat(${correlation!.length}, 1fr)` }}>
                    {sampleNames.slice(0, correlation!.length).map((name, i) => (
                      <div key={i} className="text-xs text-text-tertiary text-center truncate" title={name}>
                        {name.length > 8 ? `${name.substring(0, 8)}...` : name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center">
                <div className="w-4 h-32 rounded" style={{
                  background: 'linear-gradient(to bottom, #6ABF36, #E8FF4E, #FFFFFF)'
                }} />
                <div className="flex justify-between w-full mt-1">
                  <span className="text-xs text-text-tertiary">1.0</span>
                </div>
                <div className="flex justify-between w-full">
                  <span className="text-xs text-text-tertiary">0.5</span>
                </div>
                <div className="flex justify-between w-full">
                  <span className="text-xs text-text-tertiary">0.0</span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyQC />
          )}
          {hasCorrelation && (
            <p className="text-sm text-text-secondary mt-4">
              Pearson correlation between sample sgRNA counts
            </p>
          )}
        </div>

        {/* Library Coverage */}
        <div className="bg-surface rounded-xl p-6 shadow-card border border-border">
          <h3 className="text-xl font-serif mb-4 text-text-primary flex items-center gap-2">
            Library coverage
            <span title="Percentage of the total library sgRNAs detected in each sample. Low coverage indicates loss of library representation.">
              <Info className="w-4 h-4 text-text-tertiary cursor-help" />
            </span>
          </h3>
          {hasCoverage ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={coverage}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
                <XAxis
                  dataKey="sample"
                  tick={{ fontSize: 12, fontFamily: 'Instrument Serif' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  label={{ value: 'Coverage (%)', angle: -90, position: 'insideLeft', style: { fontFamily: 'Instrument Serif' } }}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  content={({ active, payload, label }: { active?: boolean; payload?: readonly any[]; label?: any }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-surface p-3 rounded-lg shadow-lg border border-border">
                          <p className="font-serif text-text-primary">{label}</p>
                          <p className="text-sm text-text-secondary">
                            {Number(payload[0].value).toFixed(1)}% coverage
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="coverage" fill="#1A1A1A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyQC />
          )}
        </div>

        {/* Gini Coefficient — only when real value */}
      </div>

      {/* Lorenz Curve - New Visualization */}
      <div className="bg-surface rounded-xl p-6 shadow-card border border-border">
        <h3 className="text-xl font-serif mb-4 text-text-primary">Lorenz Curve</h3>
        {hasLorenz ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={lorenzCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
              <XAxis
                dataKey="cumulative_population"
                type="number"
                domain={[0, 1]}
                tickFormatter={(val) => `${(val * 100).toFixed(0)}%`}
                label={{ value: 'Culm. % of sgRNAs', position: 'insideBottom', offset: -5, style: { fontFamily: 'Instrument Serif' } }}
                tick={{ fontSize: 12, fontFamily: 'Instrument Serif' }}
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(val: number) => `${(val * 100).toFixed(0)}%`}
                label={{ value: 'Culm. % of Reads', angle: -90, position: 'insideLeft', style: { fontFamily: 'Instrument Serif' } }}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(value: any) => [`${(Number(value) * 100).toFixed(1)}%`, 'Cumulative Reads']}
                labelFormatter={(label: any) => `Top ${(Number(label) * 100).toFixed(1)}% sgRNAs`}
              />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#ccc" strokeDasharray="3 3" label="Perfect Uniformity" />
              <Line type="monotone" dataKey="cumulative_reads" stroke="#6ABF36" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <p className="text-text-secondary">Lorenz curve data not available.</p>
            <p className="text-xs text-text-tertiary mt-2">Requires comprehensive QC calculation.</p>
          </div>
        )}
      </div>

      {/* Gini Coefficient - Enhanced Display within Grid */}
      <div className="bg-surface rounded-xl p-6 flex flex-col items-center justify-center shadow-card border border-border">
        <h3 className="text-xl font-serif mb-4 text-text-primary">Gini Coefficient</h3>
        {hasGini ? (
          <>
            <div
              className="text-7xl font-serif"
              style={{
                color: giniCoefficient! < 0.2 ? '#6ABF36' : // Excellent (Green)
                  giniCoefficient! < 0.4 ? '#8FD14F' : // Good (Light Green)
                    giniCoefficient! < 0.6 ? '#F2C94C' : // Acceptable (Yellow)
                      '#EB5757'                            // Poor (Red)
              }}
            >
              {giniCoefficient!.toFixed(2)}
            </div>
            <p className="text-sm text-text-secondary mt-1 font-medium">
              {giniCoefficient! < 0.2 ? 'Excellent Uniformity' :
                giniCoefficient! < 0.4 ? 'Good Uniformity' :
                  giniCoefficient! < 0.6 ? 'Acceptable' : 'Poor Uniformity (Skewed)'}
            </p>

            <div className="mt-8 w-full max-w-xs relative pt-4">
              <div className="h-3 bg-gradient-to-r from-success via-warning to-error rounded-full w-full" />

              {/* Marker */}
              <div
                className="absolute top-2 w-0.5 h-7 bg-text-primary transform -translate-x-1/2 transition-all duration-500"
                style={{ left: `${Math.min(giniCoefficient! * 100, 100)}%` }}
              />

              <div className="flex justify-between mt-2 text-xs text-text-tertiary">
                <span>0 (Uniform)</span>
                <span>0.5</span>
                <span>1 (Skewed)</span>
              </div>
            </div>

            <p className="text-xs text-text-tertiary mt-6 text-center max-w-xs px-4">
              Gini coefficient measures inequality in read distribution.
              Values &lt; 0.2 are ideal for CRISPR screens.
              Values &gt; 0.4 suggest potential library imbalance or PCR bias.
            </p>
          </>
        ) : (
          <EmptyQC />
        )}
      </div>
    </div>
  );
}

function getCorrelationColor(value: number): string {
  if (value >= 0.9) return 'rgba(106, 191, 54, 0.9)';
  if (value >= 0.8) return 'rgba(106, 191, 54, 0.7)';
  if (value >= 0.7) return 'rgba(232, 255, 78, 0.8)';
  if (value >= 0.5) return 'rgba(232, 255, 78, 0.5)';
  if (value >= 0.3) return 'rgba(232, 255, 78, 0.3)';
  return 'rgba(255, 255, 255, 0.8)';
}
