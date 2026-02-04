'use client';

import { useState, useEffect } from 'react';
import { Info, ChevronDown } from 'lucide-react';

export interface Library {
  id: string;
  name: string;
  organism: 'Human' | 'Mouse';
  library_type: 'knockout' | 'activation' | 'inhibition';
  description: string;
  total_sgrnas: number;
  genes_targeted: number;
  sgrnas_per_gene: number;
  addgene_id: string;
  addgene_url: string;
}

interface Props {
  selectedLibrary: string | null;
  onSelectLibrary: (libraryId: string) => void;
  disabled?: boolean;
}

export default function LibrarySelector({
  selectedLibrary,
  onSelectLibrary,
  disabled = false,
}: Props) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [selectedLibInfo, setSelectedLibInfo] = useState<Library | null>(null);

  useEffect(() => {
    loadLibraries();
  }, []);

  async function loadLibraries() {
    try {
      const response = await fetch('/api/libraries/metadata');
      if (!response.ok) {
        throw new Error('Failed to load libraries');
      }
      const data = await response.json();
      setLibraries(data.libraries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load libraries');
      console.error('Error loading libraries:', err);
    } finally {
      setLoading(false);
    }
  }

  function formatCount(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toString();
  }

  function getLibraryTypeLabel(type: string): string {
    if (type === 'knockout') return 'Knockout (KO)';
    if (type === 'activation') return 'Activation (CRISPRa)';
    if (type === 'inhibition') return 'Inhibition (CRISPRi)';
    return type;
  }

  function handleLibraryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const libraryId = e.target.value;
    onSelectLibrary(libraryId);
  }

  function handleShowInfo() {
    if (selectedLibrary) {
      const lib = libraries.find(l => l.id === selectedLibrary);
      if (lib) {
        setSelectedLibInfo(lib);
        setShowInfo(true);
      }
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          CRISPR Library
        </label>
        <div className="animate-pulse bg-gray-200 h-10 rounded-lg"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          CRISPR Library
        </label>
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  // Group libraries by organism and type
  const humanKnockout = libraries.filter(l => l.organism === 'Human' && l.library_type === 'knockout');
  const humanActivation = libraries.filter(l => l.organism === 'Human' && l.library_type === 'activation');
  const humanInhibition = libraries.filter(l => l.organism === 'Human' && l.library_type === 'inhibition');
  const mouseKnockout = libraries.filter(l => l.organism === 'Mouse' && l.library_type === 'knockout');
  const mouseInhibition = libraries.filter(l => l.organism === 'Mouse' && l.library_type === 'inhibition');

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Select CRISPR Library *
      </label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <select
            value={selectedLibrary || ''}
            onChange={handleLibraryChange}
            disabled={disabled}
            className={`
              w-full px-4 py-2.5 pr-10
              border border-gray-300 rounded-lg
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              appearance-none cursor-pointer
              ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}
            `}
          >
            <option value="">Choose a library...</option>

            {/* Human Libraries */}
            {humanKnockout.length > 0 && (
              <optgroup label="Human - Knockout (KO)">
                {humanKnockout.map(lib => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} - {formatCount(lib.total_sgrnas)} sgRNAs, {formatCount(lib.genes_targeted)} genes
                  </option>
                ))}
              </optgroup>
            )}

            {humanActivation.length > 0 && (
              <optgroup label="Human - Activation (CRISPRa)">
                {humanActivation.map(lib => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} - {formatCount(lib.total_sgrnas)} sgRNAs, {formatCount(lib.genes_targeted)} genes
                  </option>
                ))}
              </optgroup>
            )}

            {humanInhibition.length > 0 && (
              <optgroup label="Human - Inhibition (CRISPRi)">
                {humanInhibition.map(lib => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} - {formatCount(lib.total_sgrnas)} sgRNAs, {formatCount(lib.genes_targeted)} genes
                  </option>
                ))}
              </optgroup>
            )}

            {/* Mouse Libraries */}
            {mouseKnockout.length > 0 && (
              <optgroup label="Mouse - Knockout (KO)">
                {mouseKnockout.map(lib => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} - {formatCount(lib.total_sgrnas)} sgRNAs, {formatCount(lib.genes_targeted)} genes
                  </option>
                ))}
              </optgroup>
            )}

            {mouseInhibition.length > 0 && (
              <optgroup label="Mouse - Inhibition (CRISPRi)">
                {mouseInhibition.map(lib => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} - {formatCount(lib.total_sgrnas)} sgRNAs, {formatCount(lib.genes_targeted)} genes
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
        </div>

        {selectedLibrary && (
          <button
            onClick={handleShowInfo}
            className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            title="Library Information"
          >
            <Info className="w-5 h-5 text-gray-600" />
          </button>
        )}
      </div>

      {/* Info Modal */}
      {showInfo && selectedLibInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {selectedLibInfo.name}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedLibInfo.organism} - {getLibraryTypeLabel(selectedLibInfo.library_type)}
                  </p>
                </div>
                <button
                  onClick={() => setShowInfo(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Description
                </h3>
                <p className="text-gray-600">{selectedLibInfo.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                    Total sgRNAs
                  </h3>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedLibInfo.total_sgrnas.toLocaleString()}
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                    Genes Targeted
                  </h3>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedLibInfo.genes_targeted.toLocaleString()}
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                    sgRNAs per Gene
                  </h3>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedLibInfo.sgrnas_per_gene}
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                    Addgene ID
                  </h3>
                  <p className="text-2xl font-bold text-gray-900">
                    #{selectedLibInfo.addgene_id}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Source
                </h3>
                <a
                  href={selectedLibInfo.addgene_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  View on Addgene
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                onClick={() => setShowInfo(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
