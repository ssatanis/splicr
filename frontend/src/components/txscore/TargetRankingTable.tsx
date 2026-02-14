'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    createColumnHelper,
    SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TxScore } from '@sdk/txscore-client';
import { ChevronDown, ChevronUp, ExternalLink, Activity, Shield, Crosshair, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSaveTarget, useSavedTargets, useRemoveSavedTarget } from '@/hooks/useTxScore';

interface TargetRankingTableProps {
    data: TxScore[];
    isLoading?: boolean;
}

const columnHelper = createColumnHelper<TxScore>();

const ScoreCell = ({ value, colorClass }: { value: number; colorClass: string }) => (
    <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
            <div
                className={`h-full ${colorClass}`}
                style={{ width: `${value * 100}%` }}
            />
        </div>
        <span className="text-xs font-mono">{value.toFixed(2)}</span>
    </div>
);

export default function TargetRankingTable({ data, isLoading }: TargetRankingTableProps) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const parentRef = useRef<HTMLDivElement>(null);

    // Saved Targets Logic
    const { data: savedTargets } = useSavedTargets();
    const saveMutation = useSaveTarget();
    const removeMutation = useRemoveSavedTarget();

    const isSaved = (geneId: string) => savedTargets?.some((t) => t.gene_id === geneId);

    const toggleSave = (e: React.MouseEvent, geneId: string) => {
        e.stopPropagation();
        if (isSaved(geneId)) {
            removeMutation.mutate({ geneId });
        } else {
            saveMutation.mutate({ geneId });
        }
    };

    // Columns Configuration
    const columns = useMemo(
        () => [
            columnHelper.accessor('gene_id', {
                header: 'Gene',
                cell: (info) => (
                    <div className="flex flex-col">
                        <span className="font-bold text-foreground">{info.getValue()}</span>
                        {/* Assuming gene_symbol matches gene_id in this context or we need to join it. 
                        TxScore type usually has gene_symbol if joined, but here it's gene_id. 
                        We might need to fetch symbol separately or it's properly populated. 
                        For now using gene_id as symbol. */}
                    </div>
                ),
                size: 100,
            }),
            columnHelper.accessor('tvs', {
                header: 'TxScore (TVS)',
                cell: (info) => (
                    <div className="font-bold text-lg font-serif text-primary">
                        {info.getValue().toFixed(2)}
                    </div>
                ),
                size: 120,
            }),
            columnHelper.accessor('efficacy_score', {
                header: 'Efficacy',
                cell: (info) => <ScoreCell value={info.getValue()} colorClass="bg-emerald-500" />,
                size: 150,
            }),
            columnHelper.accessor('safety_score', {
                header: 'Safety',
                cell: (info) => <ScoreCell value={info.getValue()} colorClass="bg-blue-500" />,
                size: 150,
            }),
            columnHelper.accessor('druggability_score', {
                header: 'Druggability',
                cell: (info) => <ScoreCell value={info.getValue()} colorClass="bg-amber-500" />,
                size: 150,
            }),
            columnHelper.accessor('modality_recommendation.recommended_modality', {
                header: 'Modality',
                cell: (info) => {
                    const val = info.getValue();
                    const labels: Record<string, string> = {
                        small_molecule: 'Small Mol',
                        antibody: 'Antibody',
                        gene_therapy: 'Gene Tx'
                    };
                    return (
                        <span className="px-2 py-1 rounded-full bg-muted text-xs whitespace-nowrap">
                            {labels[val] || val || '-'}
                        </span>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => {
                    const geneId = info.row.original.gene_id;
                    const saved = isSaved(geneId);
                    return (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => toggleSave(e, geneId)}
                                className={`p-1.5 rounded-md transition-colors ${saved ? 'text-yellow-500 bg-yellow-500/10' : 'text-muted-foreground hover:bg-muted'}`}
                                aria-label={saved ? "Remove from saved targets" : "Save target"}
                                title={saved ? "Remove from saved" : "Save target"}
                            >
                                <Star className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />
                            </button>
                            <button
                                className="p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded-md transition-colors"
                                aria-label={`View details for ${geneId}`}
                                title="View external details"
                            >
                                <ExternalLink className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                size: 100,
            })
        ],
        [savedTargets]
    );

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const { rows } = table.getRowModel();

    // Virtualization
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 50, // Row height
        overscan: 20,
    });

    return (
        <div ref={parentRef} className="h-full overflow-auto border border-border rounded-lg bg-card">
            <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id} className="border-b border-border">
                            {headerGroup.headers.map((header) => (
                                <th
                                    key={header.id}
                                    className="p-3 font-medium text-muted-foreground select-none cursor-pointer hover:text-foreground transition-colors"
                                    style={{ width: header.getSize() }}
                                    onClick={header.column.getToggleSortingHandler()}
                                >
                                    <div className="flex items-center gap-1">
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {{
                                            asc: <ChevronUp className="w-3 h-3" aria-hidden="true" />,
                                            desc: <ChevronDown className="w-3 h-3" aria-hidden="true" />,
                                        }[header.column.getIsSorted() as string] ?? null}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {/* Virtualizer Spacer Top */}
                    {rowVirtualizer.getVirtualItems().length > 0 && (
                        <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                            <td colSpan={columns.length} />
                        </tr>
                    )}

                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        return (
                            <motion.tr
                                key={row.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="border-b border-border/50 hover:bg-accent/50 transition-colors group"
                                style={{ height: `${virtualRow.size}px` }}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <td key={cell.id} className="p-3">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </motion.tr>
                        );
                    })}

                    {/* Virtualizer Spacer Bottom */}
                    {rowVirtualizer.getVirtualItems().length > 0 && (
                        <tr style={{ height: `${rowVirtualizer.getTotalSize() - rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1].end}px` }}>
                            <td colSpan={columns.length} />
                        </tr>
                    )}

                    {data.length === 0 && !isLoading && (
                        <tr>
                            <td colSpan={columns.length} className="p-8 text-center text-muted-foreground">
                                No targets found matching your criteria.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
