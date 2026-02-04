'use client';

import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { QCMetrics as ComprehensiveQCMetrics } from '@/lib/analysis/qcMetrics';

interface QCStatusSummaryCardProps {
  /** Full comprehensive QC, or pipeline-style flat qc with optional qcAssessment (status/issues/recommendations). */
  qc: ComprehensiveQCMetrics | null | undefined;
  className?: string;
}

export default function QCStatusSummaryCard({ qc, className = '' }: QCStatusSummaryCardProps) {
  if (!qc) return null;

  const { library_representation, distribution, replicate_concordance, sequencing_depth, overall_quality } = qc;
  const status = overall_quality?.status;
  if (status === undefined) return null;

  const StatusIcon = status === 'pass' ? CheckCircle : status === 'warning' ? AlertCircle : XCircle;
  const statusColor =
    status === 'pass'
      ? 'text-green-700 bg-green-50 border-green-200'
      : status === 'warning'
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-red-700 bg-red-50 border-red-200';

  return (
    <div className={`rounded-xl border overflow-hidden bg-white ${className}`}>
      <div className={`px-4 py-3 border-b flex items-center gap-3 ${statusColor}`}>
        <StatusIcon className="w-6 h-6 flex-shrink-0" />
        <div>
          <h3 className="font-semibold">
            Quality Control: {status === 'pass' ? 'PASS' : status === 'warning' ? 'WARNINGS' : 'ISSUES'}
          </h3>
          <p className="text-sm opacity-90">{overall_quality?.recommendation ?? '—'}</p>
        </div>
      </div>
      <div className="p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Library coverage</span>
          <span className="font-medium">
            {(library_representation?.detection_rate ?? 0).toFixed(1)}%
            {(library_representation?.detection_rate ?? 0) >= 60 ? ' ✓' : ' ✗'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Gini index</span>
          <span className="font-medium">
            {(distribution?.gini_index ?? 0).toFixed(2)} ({distribution?.gini_quality ?? '—'}){' '}
            {((distribution?.gini_index ?? 0) < 0.4 ? '✓' : '✗')}
          </span>
        </div>
        {replicate_concordance && (
          <div className="flex justify-between">
            <span className="text-gray-600">Replicate correlation</span>
            <span className="font-medium">
              r = {replicate_concordance.pearson_correlation.toFixed(2)} ({replicate_concordance.correlation_quality}){' '}
              {(replicate_concordance.pearson_correlation >= 0.7) ? '✓' : '✗'}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-600">Sequencing depth</span>
          <span className="font-medium">
            {sequencing_depth?.meets_minimum ? 'Sufficient ✓' : 'Below recommended ✗'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Zero-count sgRNAs</span>
          <span className="font-medium">
            {(library_representation?.zero_count_percentage ?? 0).toFixed(1)}%
            {(library_representation?.zero_count_percentage ?? 0) <= 20 ? ' ✓' : ' ✗'}
          </span>
        </div>
      </div>
      {((overall_quality?.warnings?.length ?? 0) > 0 || (overall_quality?.issues?.length ?? 0) > 0) && (
        <div className="px-4 pb-4 space-y-2">
          {(overall_quality?.issues?.length ?? 0) > 0 && (
            <div className="text-xs text-red-700">
              <strong>Critical:</strong> {(overall_quality?.issues ?? []).join('; ')}
            </div>
          )}
          {(overall_quality?.warnings?.length ?? 0) > 0 && (
            <div className="text-xs text-amber-700">
              <strong>Warnings:</strong> {(overall_quality?.warnings ?? []).join('; ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
