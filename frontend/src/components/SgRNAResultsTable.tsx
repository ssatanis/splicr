'use client';

import { useState, useMemo } from 'react';
import { Search, Download, Copy, Check, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

interface SgRNAResult {
  sequence: string;
  gene: string;
  geneId?: string;
  count: number;
  rpm: number;
}

interface Props {
  results: SgRNAResult[];
  onExportCSV?: () => void;
}

type SortField = 'sequence' | 'gene' | 'count' | 'rpm';
type SortDirection = 'asc' | 'desc';

export default function SgRNAResultsTable({ results, onExportCSV }: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedSequence, setCopiedSequence] = useState<string | null>(null);
  const itemsPerPage = 50;

  // Filter and sort results
  const filteredAndSorted = useMemo(() => {
    let filtered = results;

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = results.filter(
        r =>
          r.sequence.toLowerCase().includes(term) ||
          r.gene.toLowerCase().includes(term) ||
          r.geneId?.toLowerCase().includes(term)
      );
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle string comparison
      if (sortField === 'sequence' || sortField === 'gene') {
        return sortDirection === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      }

      // Handle numeric comparison
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [results, searchTerm, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSorted.length / itemsPerPage);
  const paginatedResults = filteredAndSorted.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  }

  function getSortIcon(field: SortField) {
    if (sortField !== field) {
      return <ChevronsUpDown className="w-4 h-4 text-gray-400" />;
    }
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-4 h-4 text-blue-600" />
    ) : (
      <ChevronDown className="w-4 h-4 text-blue-600" />
    );
  }

  async function copyToClipboard(sequence: string) {
    try {
      await navigator.clipboard.writeText(sequence);
      setCopiedSequence(sequence);
      setTimeout(() => setCopiedSequence(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">sgRNA Results</h2>
            <p className="text-blue-100 text-sm mt-1">
              {filteredAndSorted.length.toLocaleString()} unique sgRNAs detected
            </p>
          </div>
          {onExportCSV && (
            <button
              onClick={onExportCSV}
              className="px-4 py-2 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2 font-medium"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by sequence, gene name, or ID..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th
                onClick={() => handleSort('sequence')}
                className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  Sequence
                  {getSortIcon('sequence')}
                </div>
              </th>
              <th
                onClick={() => handleSort('gene')}
                className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  Gene Target
                  {getSortIcon('gene')}
                </div>
              </th>
              <th
                onClick={() => handleSort('count')}
                className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-end gap-2">
                  Read Count
                  {getSortIcon('count')}
                </div>
              </th>
              <th
                onClick={() => handleSort('rpm')}
                className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-end gap-2">
                  RPM
                  {getSortIcon('rpm')}
                </div>
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedResults.map((result, idx) => (
              <tr
                key={`${result.sequence}-${idx}`}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <code className="px-2 py-1 bg-gray-100 rounded text-xs font-mono text-gray-900">
                    {result.sequence}
                  </code>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="font-medium text-gray-900">{result.gene}</div>
                    {result.geneId && (
                      <div className="text-xs text-gray-500">{result.geneId}</div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 font-medium">
                  {result.count.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                  {result.rpm.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <button
                    onClick={() => copyToClipboard(result.sequence)}
                    className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                    title="Copy sequence"
                  >
                    {copiedSequence === result.sequence ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-600" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Showing {((currentPage - 1) * itemsPerPage) + 1} to{' '}
              {Math.min(currentPage * itemsPerPage, filteredAndSorted.length)} of{' '}
              {filteredAndSorted.length} sgRNAs
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-sm text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredAndSorted.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-gray-500">No sgRNAs found matching your search.</p>
        </div>
      )}
    </div>
  );
}
