'use client';

import { CheckCircle2, AlertTriangle, TrendingUp, BarChart3, Target, Database } from 'lucide-react';

interface Props {
  library: {
    id: string;
    name: string;
    organism: string;
    type: string;
  };
  summary: {
    totalReads: number;
    matchedReads: number;
    unmatchedReads: number;
    matchRate: number;
    uniqueSgRNAs: number;
    genesDetected: number;
    libraryCoverage: number;
  };
  qc: {
    overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
    recommendation: string;
  };
}

export default function AnalysisSummary({ library, summary, qc }: Props) {
  function getQualityColor(quality: string) {
    if (quality === 'excellent') return 'text-green-600 bg-green-50 border-green-200';
    if (quality === 'good') return 'text-blue-600 bg-blue-50 border-blue-200';
    if (quality === 'fair') return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  }

  function getQualityIcon(quality: string) {
    if (quality === 'excellent' || quality === 'good') {
      return <CheckCircle2 className="w-5 h-5" />;
    }
    return <AlertTriangle className="w-5 h-5" />;
  }

  function formatNumber(num: number): string {
    return num.toLocaleString();
  }

  function formatPercentage(num: number): string {
    return `${num.toFixed(1)}%`;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Analysis Summary</h2>
            <p className="text-blue-100 text-sm mt-1">
              Library: {library.name} ({library.organism} - {library.type})
            </p>
          </div>
          <div className={`px-4 py-2 rounded-lg border ${getQualityColor(qc.overallQuality)} font-semibold flex items-center gap-2`}>
            {getQualityIcon(qc.overallQuality)}
            <span className="capitalize">{qc.overallQuality} Quality</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-6">
        {/* Total Reads */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Database className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Total Reads</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatNumber(summary.totalReads)}
              </p>
            </div>
          </div>
        </div>

        {/* Match Rate */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              summary.matchRate >= 70 ? 'bg-green-100' : summary.matchRate >= 50 ? 'bg-yellow-100' : 'bg-red-100'
            }`}>
              <Target className={`w-5 h-5 ${
                summary.matchRate >= 70 ? 'text-green-600' : summary.matchRate >= 50 ? 'text-yellow-600' : 'text-red-600'
              }`} />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Match Rate</p>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-gray-900">
                  {formatPercentage(summary.matchRate)}
                </p>
                <p className="text-xs text-gray-500">
                  ({formatNumber(summary.matchedReads)} / {formatNumber(summary.totalReads)})
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Unique sgRNAs */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Unique sgRNAs</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatNumber(summary.uniqueSgRNAs)}
              </p>
            </div>
          </div>
        </div>

        {/* Genes Detected */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Genes Detected</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatNumber(summary.genesDetected)}
              </p>
            </div>
          </div>
        </div>

        {/* Library Coverage */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              summary.libraryCoverage >= 40 ? 'bg-green-100' : summary.libraryCoverage >= 20 ? 'bg-yellow-100' : 'bg-red-100'
            }`}>
              <Database className={`w-5 h-5 ${
                summary.libraryCoverage >= 40 ? 'text-green-600' : summary.libraryCoverage >= 20 ? 'text-yellow-600' : 'text-red-600'
              }`} />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Library Coverage</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatPercentage(summary.libraryCoverage)}
              </p>
            </div>
          </div>
        </div>

        {/* Unmatched */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Unmatched</p>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-gray-900">
                  {formatPercentage(100 - summary.matchRate)}
                </p>
                <p className="text-xs text-gray-500">
                  ({formatNumber(summary.unmatchedReads)})
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation */}
      {qc.recommendation && (
        <div className={`mx-6 mb-6 p-4 rounded-lg border ${getQualityColor(qc.overallQuality)}`}>
          <div className="flex items-start gap-3">
            {getQualityIcon(qc.overallQuality)}
            <div>
              <p className="font-semibold">Recommendation</p>
              <p className="text-sm mt-1">{qc.recommendation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
