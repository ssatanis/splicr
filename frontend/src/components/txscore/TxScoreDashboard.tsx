'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
    Filter,
    Search,
    RefreshCw,
    BarChart2,
    Zap,
    LayoutGrid,
    List as ListIcon,
    Info,
    Dna,
    X,
    BookOpen,
    Upload,
    ArrowRight,
    ChevronRight,
    Target,
    Plus,
} from 'lucide-react';
import { useTargetRanking, useSavedTargets } from '@/hooks/useTxScore';
import { TxScoreFilters, RankingOptions } from '@sdk/txscore-client';
import { useAnalyses } from '@/lib/hooks/useAnalyses';
import TargetRankingTable from './TargetRankingTable';
import TherapeuticWindowPlot from './TherapeuticWindowPlot';
import SubscoreHeatmap from './SubscoreHeatmap';
import FilterPanel from './FilterPanel';
import TargetDossier from './TargetDossier';

type WorkflowStep = 'input' | 'results';

const EXAMPLE_GENES = 'EGFR\nKRAS\nTP53\nBRCA1\nPIK3CA\nMYC\nPTEN\nAKT1';

export default function TxScoreDashboard() {
    const [step, setStep] = useState<WorkflowStep>('input');
    const [geneInput, setGeneInput] = useState('');
    const [inputGenes, setInputGenes] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<'list' | 'analytics'>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGene, setSelectedGene] = useState<string | null>(null);
    const [savedOnly, setSavedOnly] = useState(false);
    const [importedGenes, setImportedGenes] = useState<string[]>([]);
    const [importSourceId, setImportSourceId] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(true);
    const [dragOver, setDragOver] = useState(false);

    const searchParams = useSearchParams();
    useEffect(() => {
        const genesParam = searchParams?.get('genes');
        const fromParam = searchParams?.get('from');
        if (genesParam) {
            const genes = genesParam.split(',').map(g => g.trim()).filter(Boolean);
            setImportedGenes(genes);
            setInputGenes(genes);
            if (fromParam) setImportSourceId(fromParam);
            setStep('results');
        }
    }, [searchParams]);

    const [filters, setFilters] = useState<TxScoreFilters>({
        min_tvs: 0.5,
        cancer_type: 'pan-cancer',
    });

    const [options] = useState<RankingOptions>({
        limit: 50,
        offset: 0,
        order_by: 'tvs',
        order_direction: 'desc',
    });

    const { data: rankingData, isLoading, error } = useTargetRanking(filters, options);
    const { data: savedTargets } = useSavedTargets();

    const { data: analyses = [] } = useAnalyses();
    const completedAnalyses = analyses.filter((a: any) => a.status === 'complete');

    const [selectedAnalysisId, setSelectedAnalysisId] = useState('');
    const [fdrThreshold, setFdrThreshold] = useState(0.05);

    const handleImportFromScreen = () => {
        const analysis = completedAnalyses.find((a: any) => a.id === selectedAnalysisId);
        if (!analysis) return;
        // Use all genes from that analysis (with FDR filter where available)
        const genes: string[] = ((analysis as any).results?.significant_genes || [])
            .filter((g: any) => (g.fdr ?? 0) <= fdrThreshold)
            .map((g: any) => g.gene_id || g.gene);
        if (genes.length > 0) {
            setGeneInput(genes.join('\n'));
            setInputGenes(genes);
            setImportSourceId(selectedAnalysisId);
            setStep('results');
        } else {
            // Fallback: just proceed to results view with screen id
            setImportSourceId(selectedAnalysisId);
            setStep('results');
        }
    };

    const parsedGeneCount = geneInput.split(/[\n,\s;]+/).filter(Boolean).length;

    const handleGeneSubmit = () => {
        const genes = geneInput
            .split(/[\n,\s;]+/)
            .map(g => g.trim().toUpperCase())
            .filter(Boolean);
        if (genes.length > 0) {
            setInputGenes(genes);
            setStep('results');
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const genes = text.split(/[\n,\s;]+/).map(g => g.trim().toUpperCase()).filter(Boolean);
            if (genes.length > 0) {
                setGeneInput(genes.join('\n'));
                setInputGenes(genes);
                setStep('results');
            }
        };
        reader.readAsText(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const genes = text.split(/[\n,\s;]+/).map(g => g.trim().toUpperCase()).filter(Boolean);
            if (genes.length > 0) {
                setGeneInput(genes.join('\n'));
                setInputGenes(genes);
                setStep('results');
            }
        };
        reader.readAsText(file);
    };

    // ── INPUT STEP ──────────────────────────────────────────────────────────────
    if (step === 'input') {
        return (
            <div className="max-w-[860px] mx-auto px-8 py-12">
                {selectedGene && (
                    <TargetDossier geneSymbol={selectedGene} onClose={() => setSelectedGene(null)} />
                )}

                {/* Header */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-5xl font-serif text-text-primary mb-2">Therapeutic Translation</h1>
                            <p className="text-text-secondary font-serif">
                                Prioritize gene targets for therapeutic development using multi-modal evidence.
                            </p>
                        </div>
                        <Link href="/docs/therapeutic-translation">
                            <button className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border rounded hover:text-text-primary transition-colors font-serif">
                                <BookOpen className="w-3.5 h-3.5" />
                                Documentation
                            </button>
                        </Link>
                    </div>
                </motion.div>

                {/* Gene input card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                    className="bg-surface rounded-2xl p-8 border border-border mb-5"
                >
                    <label className="block text-sm font-serif text-text-secondary mb-2">
                        Gene Targets
                    </label>
                    <p className="text-xs text-text-tertiary font-serif mb-4">
                        Paste gene symbols (one per line or comma-separated), upload a file, or import from a CRISPR screen below.
                    </p>

                    <div
                        className={`relative border border-dashed rounded-xl transition-colors mb-4 ${
                            dragOver ? 'border-text-tertiary bg-background' : 'border-border'
                        }`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                    >
                        <textarea
                            value={geneInput}
                            onChange={(e) => setGeneInput(e.target.value)}
                            placeholder={'EGFR\nKRAS\nTP53\nBRCA1\nPIK3CA\n\nOne gene symbol per line, or comma-separated'}
                            className="w-full h-48 p-5 bg-transparent text-sm font-mono text-text-primary focus:outline-none resize-none placeholder:text-text-tertiary"
                            spellCheck={false}
                        />
                        <div className="absolute bottom-3.5 right-4 text-xs text-text-tertiary">
                            {parsedGeneCount > 0 ? `${parsedGeneCount} gene${parsedGeneCount !== 1 ? 's' : ''}` : (dragOver ? 'Drop file here' : 'drag & drop .txt/.csv')}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer font-serif">
                                <Upload className="w-3.5 h-3.5" />
                                Upload CSV / TXT
                                <input type="file" accept=".csv,.txt,.tsv" className="sr-only" onChange={handleFileUpload} />
                            </label>
                            <button
                                onClick={() => setGeneInput(EXAMPLE_GENES)}
                                className="px-3.5 py-2 rounded-lg border border-border text-sm text-text-tertiary hover:text-text-primary transition-colors font-serif"
                            >
                                Load example
                            </button>
                        </div>
                        <button
                            onClick={handleGeneSubmit}
                            disabled={parsedGeneCount === 0}
                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-text-primary hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed text-background rounded-xl text-sm font-medium transition-opacity font-serif"
                        >
                            Analyze Targets
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </motion.div>

                {/* Import from CRISPR screen */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 }}
                    className="bg-surface rounded-2xl p-6 border border-border mb-5"
                >
                    <h3 className="text-sm font-serif text-text-primary mb-1">Import from CRISPR Screen Analysis</h3>
                    <p className="text-xs text-text-tertiary font-serif mb-4">
                        Select a completed screen to import significant hits directly into TxScore.
                    </p>

                    {completedAnalyses.length > 0 ? (
                        <div className="space-y-3">
                            <select
                                value={selectedAnalysisId}
                                onChange={(e) => setSelectedAnalysisId(e.target.value)}
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-serif text-text-primary focus:outline-none focus:ring-1 focus:ring-border appearance-none"
                            >
                                <option value="">Select analysis…</option>
                                {completedAnalyses.map((a: any) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name} — {a.results?.significant_genes?.length ?? '?'} hits
                                    </option>
                                ))}
                            </select>

                            <div className="flex items-center gap-3">
                                <label className="text-xs font-serif text-text-secondary shrink-0">
                                    FDR threshold
                                </label>
                                <input
                                    type="range"
                                    min={0.001}
                                    max={0.1}
                                    step={0.001}
                                    value={fdrThreshold}
                                    onChange={(e) => setFdrThreshold(Number(e.target.value))}
                                    className="flex-1"
                                />
                                <span className="text-xs font-mono text-text-secondary w-14 text-right">
                                    {fdrThreshold.toFixed(3)}
                                </span>
                            </div>

                            <button
                                onClick={handleImportFromScreen}
                                disabled={!selectedAnalysisId}
                                className="w-full py-2 text-sm font-serif text-text-secondary border border-border rounded-lg hover:text-text-primary hover:border-text-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Import genes
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-text-tertiary font-serif">No completed screen analyses found.</p>
                            <Link href="/upload">
                                <button className="inline-flex items-center gap-1.5 text-xs text-text-secondary border border-border rounded px-3 py-1.5 hover:text-text-primary transition-colors font-serif">
                                    Run a screen
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </Link>
                        </div>
                    )}
                </motion.div>

                {/* About */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.17 }}
                    className="bg-surface rounded-2xl p-6 border border-border"
                >
                    <h3 className="text-sm font-serif text-text-primary mb-3">Why use this tool?</h3>
                    <p className="text-sm text-text-secondary font-serif leading-relaxed mb-4">
                        Prioritize therapeutic targets using multi-dimensional evidence derived from public and proprietary datasets.
                    </p>
                    <ul className="space-y-1.5 text-xs text-text-secondary font-serif">
                        <li className="flex items-start gap-2"><span className="text-text-tertiary mt-0.5">·</span>Genetic validation from pooled CRISPR fitness screens (DepMap, Chronos)</li>
                        <li className="flex items-start gap-2"><span className="text-text-tertiary mt-0.5">·</span>Clinical safety predictions from human population genetics (gnomAD, GTEx)</li>
                        <li className="flex items-start gap-2"><span className="text-text-tertiary mt-0.5">·</span>Druggability assessment from structural biology (AlphaFold, fpocket)</li>
                        <li className="flex items-start gap-2"><span className="text-text-tertiary mt-0.5">·</span>Real-world precedent from clinical trials and approved drug databases</li>
                    </ul>
                    <Link href="/docs/therapeutic-translation">
                        <button className="mt-4 inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors font-serif">
                            Learn more
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </Link>
                </motion.div>
            </div>
        );
    }

    // ── RESULTS STEP ────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
            {selectedGene && (
                <TargetDossier geneSymbol={selectedGene} onClose={() => setSelectedGene(null)} />
            )}

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <AnimatePresence>
                    {showFilters && (
                        <motion.aside
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 272, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            id="filters-panel"
                            className="border-r border-border bg-card/50 flex flex-col overflow-y-auto overflow-x-hidden shrink-0"
                            style={{ width: 272 }}
                        >
                            <div className="p-4 border-b border-border">
                                <h2 className="text-sm font-serif font-medium flex items-center gap-2 text-text-primary">
                                    <Filter className="w-3.5 h-3.5" />
                                    Filters
                                </h2>
                            </div>
                            <div className="p-4 space-y-5">
                                <FilterPanel
                                    filters={filters}
                                    onFilterChange={setFilters}
                                    savedOnly={savedOnly}
                                    onSavedOnlyChange={(checked) => {
                                        setSavedOnly(checked);
                                        if (checked && savedTargets) {
                                            setFilters(prev => ({ ...prev, gene_ids: savedTargets.map(t => t.gene_id) }));
                                        } else {
                                            setFilters(prev => { const { gene_ids, ...rest } = prev; return rest; });
                                        }
                                    }}
                                />
                                <div className="p-3.5 bg-muted/30 rounded-xl text-xs space-y-1.5">
                                    <div className="flex justify-between">
                                        <span className="text-text-tertiary">Targets found</span>
                                        <span className="font-mono text-text-primary">{rankingData?.meta.count ?? 0}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-tertiary">Input genes</span>
                                        <span className="font-mono text-text-primary">{inputGenes.length || '—'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-tertiary">Saved</span>
                                        <span className="font-mono text-text-primary">{savedTargets?.length ?? 0}</span>
                                    </div>
                                </div>
                            </div>
                        </motion.aside>
                    )}
                </AnimatePresence>

                {/* Main */}
                <main className="flex-1 flex flex-col overflow-hidden min-w-0">
                    {/* Header */}
                    <header className="h-14 border-b border-border flex items-center justify-between px-5 bg-card/30 backdrop-blur-sm shrink-0">
                        <div className="flex items-center gap-2.5">
                            <button
                                onClick={() => setStep('input')}
                                className="inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                New analysis
                            </button>
                            <span className="text-text-tertiary text-xs">/</span>
                            <span className="text-xs font-serif font-medium text-text-primary">
                                {importedGenes.length > 0
                                    ? `${importedGenes.length} imported genes`
                                    : inputGenes.length > 0
                                        ? `${inputGenes.length} genes`
                                        : 'All targets'}
                            </span>
                            {importSourceId && (
                                <Link href={`/results/${importSourceId}`} className="text-xs text-violet-400 hover:underline">
                                    [from screen]
                                </Link>
                            )}
                            <Link href="/docs/therapeutic-translation">
                                <button className="inline-flex items-center gap-1.5 h-6 px-2.5 text-xs border border-border text-text-tertiary hover:text-text-primary rounded transition-colors font-serif">
                                    <BookOpen className="w-3 h-3" />
                                    Docs
                                </button>
                            </Link>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                <input
                                    type="text"
                                    placeholder="Search gene..."
                                    className="pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400/40 w-44"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && searchQuery) setSelectedGene(searchQuery);
                                    }}
                                />
                            </div>
                            <div className="h-4 w-px bg-border" />
                            <button
                                onClick={() => setShowFilters(v => !v)}
                                className={`p-1.5 rounded transition-colors ${showFilters ? 'bg-background border border-border text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`}
                                title="Toggle filters"
                            >
                                <Filter className="w-4 h-4" />
                            </button>
                            <div className="flex bg-muted/50 p-0.5 rounded-md">
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-background shadow-sm text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`}
                                    title="List view"
                                >
                                    <ListIcon className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setViewMode('analytics')}
                                    className={`p-1.5 rounded transition-colors ${viewMode === 'analytics' ? 'bg-background shadow-sm text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`}
                                    title="Analytics view"
                                >
                                    <LayoutGrid className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <button
                                className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors rounded"
                                onClick={() => window.dispatchEvent(new CustomEvent('start-txscore-tour'))}
                                title="Restart tour"
                            >
                                <Info className="w-4 h-4" />
                            </button>
                        </div>
                    </header>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        {/* Import banner */}
                        {importedGenes.length > 0 && (
                            <div className="flex items-start gap-3 p-3.5 bg-violet-400/5 border border-violet-400/25 rounded-xl">
                                <Dna className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-serif text-text-primary font-medium">
                                        {importedGenes.length} genes imported from CRISPR screen
                                        {importSourceId && (
                                            <Link href={`/results/${importSourceId}`} className="ml-2 text-violet-400 hover:underline">
                                                [view screen]
                                            </Link>
                                        )}
                                    </p>
                                    <p className="text-xs text-text-tertiary font-serif mt-0.5 truncate">
                                        {importedGenes.slice(0, 8).join(', ')}{importedGenes.length > 8 ? ` +${importedGenes.length - 8} more` : ''}
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setImportedGenes([]); setImportSourceId(null); }}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}

                        {/* Key Metrics */}
                        <div id="key-metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="bg-surface border border-border rounded-xl p-4 flex flex-col shadow-sm">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-text-tertiary">Top Target</span>
                                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                                </div>
                                {rankingData?.data[0] ? (
                                    <>
                                        <div className="text-xl font-serif font-medium text-text-primary">{rankingData.data[0].gene_id}</div>
                                        <div className="text-xs text-text-tertiary mt-0.5">TVS: {rankingData.data[0].tvs.toFixed(2)}</div>
                                    </>
                                ) : (
                                    <div className="text-xl font-serif text-text-tertiary">—</div>
                                )}
                            </div>
                            <div className="bg-surface border border-border rounded-xl p-4 flex flex-col shadow-sm">
                                <span className="text-xs text-text-tertiary mb-2">Targets Analyzed</span>
                                <div className="text-xl font-serif font-medium text-text-primary">
                                    {rankingData?.meta.count || inputGenes.length || '—'}
                                </div>
                                <BarChart2 className="w-3.5 h-3.5 text-violet-400 mt-auto self-end" />
                            </div>
                            <div className="bg-surface border border-border rounded-xl p-4 flex flex-col shadow-sm">
                                <span className="text-xs text-text-tertiary mb-2">Avg Efficacy</span>
                                <div className="text-xl font-serif font-medium text-text-primary">
                                    {rankingData?.data.length
                                        ? (rankingData.data.reduce((a, b) => a + b.efficacy_score, 0) / rankingData.data.length).toFixed(2)
                                        : '—'}
                                </div>
                            </div>
                            <div className="bg-surface border border-border rounded-xl p-4 flex flex-col shadow-sm">
                                <span className="text-xs text-text-tertiary mb-2">High-Priority</span>
                                <div className="text-xl font-serif font-medium text-text-primary">
                                    {rankingData ? rankingData.data.filter(t => t.tvs > 0.7).length : '—'}
                                </div>
                                <span className="text-xs text-text-tertiary mt-0.5">TVS &gt; 0.7</span>
                            </div>
                        </div>

                        {/* Main view */}
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={viewMode}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.15 }}
                                className="pb-16"
                            >
                                {viewMode === 'list' ? (
                                    <div className="bg-surface border border-border rounded-xl shadow-sm flex flex-col min-h-[400px]">
                                        {isLoading ? (
                                            <div className="p-12 flex items-center justify-center text-text-tertiary">
                                                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                                                Loading targets...
                                            </div>
                                        ) : error ? (
                                            <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
                                                <div className="p-3 bg-red-400/10 text-red-400 rounded-xl">
                                                    <Zap className="w-6 h-6" />
                                                </div>
                                                <h3 className="font-serif text-text-primary">Unable to load targets</h3>
                                                <p className="text-sm text-text-tertiary max-w-sm font-serif">
                                                    There was a problem fetching therapeutic targets.
                                                </p>
                                                <button
                                                    onClick={() => window.location.reload()}
                                                    className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
                                                >
                                                    Retry
                                                </button>
                                            </div>
                                        ) : (
                                            <TargetRankingTable data={rankingData?.data || []} />
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <TherapeuticWindowPlot
                                            data={rankingData?.data || []}
                                            onPointClick={(geneId) => setSelectedGene(geneId)}
                                        />
                                        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col">
                                            <h3 className="text-sm font-serif font-medium text-text-primary mb-3">Top Targets Heatmap</h3>
                                            <SubscoreHeatmap data={rankingData?.data || []} />
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </main>
            </div>
        </div>
    );
}
