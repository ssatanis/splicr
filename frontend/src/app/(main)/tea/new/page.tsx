import { Metadata } from 'next';
import TEAUploadForm from '@/components/tea/TEAUploadForm';
import { Activity, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'New TEA Analysis | SplicR',
  description: 'Upload sequence for Therapeutic Editability Atlas analysis'
};

export default function NewTEAAnalysisPage() {
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
            <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              New TEA Analysis
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Upload your sequence for comprehensive Therapeutic Editability Atlas analysis
          </p>
        </div>

        {/* Feature Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            What is TEA Analysis?
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            TEA (Therapeutic Editability Atlas) is a composite metric integrating base editor efficiency, 
            prime editor compatibility, therapeutic window analysis, chromatin accessibility, and 
            patient-specific off-target risk profiling.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-4">
              <p className="font-medium text-emerald-900 dark:text-emerald-100 mb-1">
                EDIT Score
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Composite metric for editing feasibility
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-4">
              <p className="font-medium text-emerald-900 dark:text-emerald-100 mb-1">
                Editor Compatibility
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                ABE, CBE, PE3, PE4, PE5 recommendations
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-4">
              <p className="font-medium text-emerald-900 dark:text-emerald-100 mb-1">
                Off-Target Analysis
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Patient-specific risk profiling
              </p>
            </div>
          </div>
        </div>

        {/* Upload Form */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <TEAUploadForm />
        </div>
      </div>
    </div>
  );
}
