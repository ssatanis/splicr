'use client';

import { CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';

interface Props {
  qc: {
    matchRate: number;
    matchRateQuality: 'excellent' | 'good' | 'fair' | 'poor';
    libraryCoverage: number;
    libraryQuality: 'excellent' | 'good' | 'fair' | 'poor';
    zeroCountSgRNAs: number;
    zeroCountPercentage: number;
    zeroCountQuality: 'excellent' | 'good' | 'fair' | 'poor';
    giniCoefficient: number;
    giniQuality: 'excellent' | 'good' | 'fair' | 'poor';
    overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
    recommendation: string;
  };
}

export default function QCMetrics({ qc }: Props) {
  function getQualityIcon(quality: string) {
    if (quality === 'excellent') return <CheckCircle className="w-5 h-5 text-green-600" />;
    if (quality === 'good') return <CheckCircle className="w-5 h-5 text-blue-600" />;
    if (quality === 'fair') return <AlertCircle className="w-5 h-5 text-yellow-600" />;
    return <XCircle className="w-5 h-5 text-red-600" />;
  }

  function getQualityColor(quality: string) {
    if (quality === 'excellent') return 'text-green-700 bg-green-50 border-green-200';
    if (quality === 'good') return 'text-blue-700 bg-blue-50 border-blue-200';
    if (quality === 'fair') return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    return 'text-red-700 bg-red-50 border-red-200';
  }

  function formatPercentage(num: number): string {
    return `${num.toFixed(1)}%`;
  }

  function getQualityThreshold(metric: string, quality: string): string {
    if (metric === 'matchRate') {
      if (quality === 'excellent') return '>80%';
      if (quality === 'good') return '>70%';
      if (quality === 'fair') return '>50%';
      return '<50%';
    }
    if (metric === 'libraryCoverage') {
      if (quality === 'excellent') return '>50%';
      if (quality === 'good') return '>40%';
      if (quality === 'fair') return '>20%';
      return '<20%';
    }
    if (metric === 'zeroCount') {
      if (quality === 'excellent') return '<40%';
      if (quality === 'good') return '<60%';
      if (quality === 'fair') return '<80%';
      return '>80%';
    }
    if (metric === 'gini') {
      if (quality === 'excellent') return '<0.3';
      if (quality === 'good') return '<0.5';
      if (quality === 'fair') return '<0.7';
      return '>0.7';
    }
    return '';
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4">
        <h2 className="text-xl font-bold text-white">Quality Control Metrics</h2>
        <p className="text-purple-100 text-sm mt-1">
          Assess the quality of your CRISPR screen data
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="p-6 space-y-4">
        {/* Match Rate */}
        <div className={`p-4 rounded-lg border ${getQualityColor(qc.matchRateQuality)}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              {getQualityIcon(qc.matchRateQuality)}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Match Rate</h3>
                  <span className="text-2xl font-bold">{formatPercentage(qc.matchRate)}</span>
                </div>
                <p className="text-sm mt-1 opacity-80">
                  Percentage of reads that matched the library
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-white bg-opacity-50 font-medium">
                    {qc.matchRateQuality.charAt(0).toUpperCase() + qc.matchRateQuality.slice(1)}
                  </span>
                  <span className="opacity-70">
                    (Expected: {getQualityThreshold('matchRate', qc.matchRateQuality)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Library Coverage */}
        <div className={`p-4 rounded-lg border ${getQualityColor(qc.libraryQuality)}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              {getQualityIcon(qc.libraryQuality)}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Library Coverage</h3>
                  <span className="text-2xl font-bold">{formatPercentage(qc.libraryCoverage)}</span>
                </div>
                <p className="text-sm mt-1 opacity-80">
                  Percentage of library sgRNAs detected in your sample
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-white bg-opacity-50 font-medium">
                    {qc.libraryQuality.charAt(0).toUpperCase() + qc.libraryQuality.slice(1)}
                  </span>
                  <span className="opacity-70">
                    (Expected: {getQualityThreshold('libraryCoverage', qc.libraryQuality)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Zero-Count sgRNAs */}
        <div className={`p-4 rounded-lg border ${getQualityColor(qc.zeroCountQuality)}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              {getQualityIcon(qc.zeroCountQuality)}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Zero-Count sgRNAs</h3>
                  <div className="text-right">
                    <span className="text-2xl font-bold">{formatPercentage(qc.zeroCountPercentage)}</span>
                    <p className="text-xs opacity-70">({qc.zeroCountSgRNAs.toLocaleString()} sgRNAs)</p>
                  </div>
                </div>
                <p className="text-sm mt-1 opacity-80">
                  Library sgRNAs not detected in your sample
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-white bg-opacity-50 font-medium">
                    {qc.zeroCountQuality.charAt(0).toUpperCase() + qc.zeroCountQuality.slice(1)}
                  </span>
                  <span className="opacity-70">
                    (Expected: {getQualityThreshold('zeroCount', qc.zeroCountQuality)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Gini Coefficient */}
        <div className={`p-4 rounded-lg border ${getQualityColor(qc.giniQuality)}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              {getQualityIcon(qc.giniQuality)}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Gini Coefficient</h3>
                  <span className="text-2xl font-bold">{qc.giniCoefficient.toFixed(2)}</span>
                </div>
                <p className="text-sm mt-1 opacity-80">
                  Measure of read count uniformity (0 = perfect uniformity, 1 = maximum inequality)
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-white bg-opacity-50 font-medium">
                    {qc.giniQuality.charAt(0).toUpperCase() + qc.giniQuality.slice(1)}
                  </span>
                  <span className="opacity-70">
                    (Expected: {getQualityThreshold('gini', qc.giniQuality)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Help Section */}
      <div className="px-6 pb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold mb-2">Understanding QC Metrics</p>
              <ul className="space-y-1 text-xs opacity-90">
                <li><strong>Match Rate:</strong> Should be 70%+. Low values suggest wrong library or sequencing issues.</li>
                <li><strong>Library Coverage:</strong> Should be 40%+. Low values suggest insufficient sequencing depth.</li>
                <li><strong>Zero-Count sgRNAs:</strong> Should be 40%. High values indicate poor library representation.</li>
                <li><strong>Gini Coefficient:</strong> Should be 0.5. High values indicate uneven sgRNA distribution.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
