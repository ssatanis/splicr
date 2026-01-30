'use client';

import { useState, useMemo } from 'react';
import { Download, Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface GeneData {
  gene: string;
  sgrnaCount: number;
  logFoldChange: number;
  pValue: number;
  fdr: number;
  rank: number;
  isSignificant?: boolean;
  mageck?: any;
  bagel2?: any;
  drugz?: any;
}

interface InteractiveDataTableProps {
  data: GeneData[];
  analysisId: string;
  onGeneClick?: (gene: string) => void;
}

type SortField = 'rank' | 'gene' | 'sgrnaCount' | 'logFoldChange' | 'pValue' | 'fdr';
type SortDirection = 'asc' | 'desc';

export default function InteractiveDataTable({ data, analysisId, onGeneClick }: InteractiveDataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Filter data by search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    const query = searchQuery.toLowerCase();
    return data.filter(gene =>
      gene.gene.toLowerCase().includes(query)
    );
  }, [data, searchQuery]);

  // Sort data
  const sortedData = useMemo(() => {
    const sorted = [...filteredData].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'gene') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredData, sortField, sortDirection]);

  // Paginate data
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const handleExportCSV = () => {
    const headers = ['Rank', 'Gene', 'sgRNA Count', 'Log2 FC', 'P-value', 'FDR'];
    const rows = sortedData.map(gene => [
      gene.rank,
      gene.gene,
      gene.sgrnaCount,
      gene.logFoldChange.toFixed(4),
      gene.pValue.toExponential(3),
      gene.fdr.toFixed(6)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splicr-gene-rankings-${analysisId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    // TSV format for Excel compatibility
    const headers = ['Rank', 'Gene', 'sgRNA Count', 'Log2 FC', 'P-value', 'FDR'];
    const rows = sortedData.map(gene => [
      gene.rank,
      gene.gene,
      gene.sgrnaCount,
      gene.logFoldChange.toFixed(4),
      gene.pValue.toExponential(3),
      gene.fdr.toFixed(6)
    ]);

    const tsvContent = [
      headers.join('\t'),
      ...rows.map(row => row.join('\t'))
    ].join('\n');

    const blob = new Blob([tsvContent], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splicr-gene-rankings-${analysisId}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc'
      ? <ChevronUp className="w-4 h-4 inline ml-1" />
      : <ChevronDown className="w-4 h-4 inline ml-1" />;
  };

  return (
    <div className="space-y-6">
      {/* Search and Export Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-auto sm:min-w-[300px]">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search genes (e.g., TP53, KRAS)..."
            className="w-full pl-12 pr-4 py-3 bg-surface border border-border rounded-xl font-serif focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary font-serif">
            {sortedData.length} genes
          </span>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg hover:bg-background transition-colors font-serif text-sm"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg hover:bg-background transition-colors font-serif text-sm"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-2xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-background">
              <tr>
                <th
                  className="px-6 py-4 text-left text-sm font-serif text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => handleSort('rank')}
                >
                  Rank <SortIcon field="rank" />
                </th>
                <th
                  className="px-6 py-4 text-left text-sm font-serif text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => handleSort('gene')}
                >
                  Gene <SortIcon field="gene" />
                </th>
                <th
                  className="px-6 py-4 text-left text-sm font-serif text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => handleSort('sgrnaCount')}
                >
                  sgRNAs <SortIcon field="sgrnaCount" />
                </th>
                <th
                  className="px-6 py-4 text-left text-sm font-serif text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => handleSort('logFoldChange')}
                >
                  Log₂ FC <SortIcon field="logFoldChange" />
                </th>
                <th
                  className="px-6 py-4 text-left text-sm font-serif text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => handleSort('pValue')}
                >
                  P-value <SortIcon field="pValue" />
                </th>
                <th
                  className="px-6 py-4 text-left text-sm font-serif text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => handleSort('fdr')}
                >
                  FDR <SortIcon field="fdr" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {paginatedData.length > 0 ? (
                paginatedData.map((gene) => (
                  <tr
                    key={gene.gene}
                    className={`hover:bg-background transition-colors ${
                      gene.isSignificant ? 'bg-accent/5' : ''
                    }`}
                  >
                    <td className="px-6 py-4 text-sm font-mono text-text-secondary">
                      {gene.rank}
                    </td>
                    <td className="px-6 py-4">
                      {onGeneClick ? (
                        <button
                          type="button"
                          onClick={() => onGeneClick(gene.gene)}
                          className={`font-mono font-medium hover:underline text-left ${
                            gene.isSignificant ? 'text-accent' : 'text-text-primary'
                          }`}
                        >
                          {gene.gene}
                        </button>
                      ) : (
                        <span className={`font-mono font-medium ${
                          gene.isSignificant ? 'text-accent' : 'text-text-primary'
                        }`}>
                          {gene.gene}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-text-secondary">
                      {gene.sgrnaCount}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-mono text-sm ${
                        gene.logFoldChange < 0 ? 'text-error' : gene.logFoldChange > 0 ? 'text-success' : 'text-text-secondary'
                      }`}>
                        {gene.logFoldChange.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-text-secondary">
                      {gene.pValue.toExponential(2)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-mono text-sm ${
                        gene.fdr < 0.05 ? 'font-bold text-accent' : 'text-text-secondary'
                      }`}>
                        {gene.fdr.toFixed(4)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-text-tertiary font-serif">
                    {searchQuery ? 'No genes match your search' : 'No data available'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-text-secondary font-serif">
            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length} genes
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }

                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-10 h-10 rounded-lg font-serif transition-colors ${
                      currentPage === page
                        ? 'bg-accent text-white'
                        : 'hover:bg-background'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-border hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary font-serif">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-3 py-2 bg-surface border border-border rounded-lg font-serif text-sm focus:outline-none focus:border-accent"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
