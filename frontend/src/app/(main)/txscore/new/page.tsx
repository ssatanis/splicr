import { Metadata } from 'next';
import TxScoreUploadForm from '@/components/txscore/TxScoreUploadForm';
import { Target, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'New TxScore Analysis | SplicR',
  description: 'Upload gene list for Therapeutic Translation Score analysis'
};

export default function NewTxScoreAnalysisPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/dashboard"
            className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
              <Target className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              New TxScore Analysis
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Upload your gene list for therapeutic target prioritization
          </p>
        </div>

        {/* Feature Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            What is TxScore Analysis?
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            TxScore (Therapeutic Translation Score) prioritizes gene targets through multivariate 
            ranking incorporating DepMap dependency scores, tissue-specific expression, CRISPR 
            editability feasibility, druggability potential, and clinical translatability metrics.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-violet-50 dark:bg-violet-950/20 rounded-lg p-4">
              <p className="font-medium text-violet-900 dark:text-violet-100 mb-1">
                TVS Ranking
              </p>
              <p className="text-sm text-violet-700 dark:text-violet-300">
                Therapeutic Viability Score for each target
              </p>
            </div>
            <div className="bg-violet-50 dark:bg-violet-950/20 rounded-lg p-4">
              <p className="font-medium text-violet-900 dark:text-violet-100 mb-1">
                DepMap Integration
              </p>
              <p className="text-sm text-violet-700 dark:text-violet-300">
                Genome-wide dependency data
              </p>
            </div>
            <div className="bg-violet-50 dark:bg-violet-950/20 rounded-lg p-4">
              <p className="font-medium text-violet-900 dark:text-violet-100 mb-1">
                Tissue Specificity
              </p>
              <p className="text-sm text-violet-700 dark:text-violet-300">
                Expression profiles and selectivity
              </p>
            </div>
          </div>
        </div>

        {/* Upload Form */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <TxScoreUploadForm />
        </div>
      </div>
    </div>
  );
}
