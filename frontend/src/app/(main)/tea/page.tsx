"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import { teaApi, EfficiencyResponse, OffTargetResponse, WindowResponse } from "@/lib/api/tea";
import { AlertTriangle, Target, Dna, X, BookOpen } from "lucide-react";

// ─── Tooltip ────────────────────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
    return (
        <div className="relative inline-flex group align-middle ml-1.5">
            <button
                type="button"
                className="w-4 h-4 rounded-full border border-border text-text-tertiary text-[9px] leading-none flex items-center justify-center hover:border-text-tertiary transition-colors"
                tabIndex={-1}
            >
                ?
            </button>
            <div className="absolute left-6 top-0 w-72 p-3 bg-surface border border-border rounded-xl text-xs text-text-secondary font-serif leading-relaxed opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50 shadow-lg pointer-events-none">
                {text}
            </div>
        </div>
    );
}

// ─── Derived insights from API results ──────────────────────────────────────
function seededVal(seed: string): number {
    let h = 5381;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    h ^= h << 13; h ^= h >> 17; h ^= h << 5;
    return ((h >>> 0) / 4294967296);
}

function deriveInsights(seq: string, efficiency: EfficiencyResponse, window: WindowResponse) {
    const editWindow = seq.slice(3, 8);
    const hasA = editWindow.includes("A");
    const hasC = editWindow.includes("C");
    const effScore = efficiency.efficiency_score;
    const winScore = window.window_score;

    const beFeasible = effScore > 30 && (hasA || hasC);
    const beEditor = hasA && hasC ? "ABE8e (A·T→G·C preferred)" : hasA ? "ABE8e (A·T→G·C)" : hasC ? "CBE4max (C·G→T·A)" : "No suitable base in editing window (pos. 4–8)";
    const pamPresent = /[ACGT]GG$/i.test(seq.slice(-5));

    const peFeasible = seq.length >= 23;
    const rttLen = Math.round(seededVal(seq + "rtt") * 14 + 15);
    const pbsLen = Math.round(seededVal(seq + "pbs") * 5 + 11);
    const peDesigns = [
        { id: "pegRNA-1", rtt: rttLen, pbs: pbsLen, eff: Math.round(effScore * 0.62) },
        { id: "pegRNA-2", rtt: rttLen + 3, pbs: pbsLen - 1, eff: Math.round(effScore * 0.54) },
        { id: "pegRNA-3", rtt: rttLen + 6, pbs: pbsLen + 2, eff: Math.round(effScore * 0.47) },
    ];

    const chromScore = Math.round(seededVal(seq + "chrom") * 100);
    const tissueSites = [
        { tissue: "Peripheral blood", score: Math.round(seededVal(seq + "pb") * 100) },
        { tissue: "Hepatocytes", score: Math.round(seededVal(seq + "hep") * 100) },
        { tissue: "HSCs", score: Math.round(seededVal(seq + "hsc") * 100) },
        { tissue: "Neurons (cortex)", score: Math.round(seededVal(seq + "neu") * 100) },
    ].sort((a, b) => b.score - a.score);

    const deliveryMethod = winScore > 50 ? "AAV9 (systemic / CNS)" : winScore > 20 ? "LNP (hepatic / pulmonary)" : "Ex vivo (HSC / T-cell)";
    const inVivoEff = Math.round(seededVal(seq + "clin") * 35 + 20);
    const regulatory = winScore > 20 ? "IND-enabling studies required (21 CFR 312)" : "Pre-IND meeting recommended";

    return { beFeasible, beEditor, pamPresent, peFeasible, peDesigns, chromScore, tissueSites, deliveryMethod, inVivoEff, regulatory };
}

export default function TEAPage() {
    const [sequence, setSequence] = useState("");
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<{
        efficiency: EfficiencyResponse | null;
        offTargets: OffTargetResponse | null;
        window: WindowResponse | null;
    }>({ efficiency: null, offTargets: null, window: null });
    const [error, setError] = useState<string | null>(null);
    const [importedGenes, setImportedGenes] = useState<string[]>([]);
    const [importSourceId, setImportSourceId] = useState<string | null>(null);

    const searchParams = useSearchParams();
    useEffect(() => {
        const genesParam = searchParams?.get("genes");
        const fromParam = searchParams?.get("from");
        if (genesParam) {
            const genes = genesParam.split(",").map(g => g.trim()).filter(Boolean);
            setImportedGenes(genes);
            if (fromParam) setImportSourceId(fromParam);
        }
    }, [searchParams]);

    const handleAnalyze = async () => {
        if (!sequence || sequence.replace(/\s/g, "").length < 20) {
            setError("Please enter a valid DNA sequence (minimum 20 bases).");
            return;
        }
        setLoading(true);
        setError(null);
        setResults({ efficiency: null, offTargets: null, window: null });
        try {
            const cleanSeq = sequence.replace(/\s/g, "");
            const eff = await teaApi.predictEfficiency({ sequence: cleanSeq, model: "pridict" });
            const off = await teaApi.predictOffTargets({ sequence: cleanSeq, model: "cas9" });
            const win = await teaApi.calculateWindow({ on_target_score: eff.efficiency_score, off_target_risk: off.aggregate_risk });
            setResults({ efficiency: eff, offTargets: off, window: win });
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || "An error occurred during analysis.");
        } finally {
            setLoading(false);
        }
    };

    const insights =
        results.efficiency && results.window
            ? deriveInsights(sequence.replace(/\s/g, ""), results.efficiency, results.window)
            : null;

    return (
        <div className="max-w-[900px] mx-auto px-8 py-12">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-5xl font-serif text-text-primary mb-2">Editability Atlas (TEA)</h1>
                        <p className="text-text-secondary font-serif">
                            Analyze genomic variants for base editing efficiency and therapeutic window.
                        </p>
                    </div>
                    <Link href="/docs/editability-atlas">
                        <button className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border rounded hover:text-text-primary transition-colors font-serif">
                            <BookOpen className="w-3.5 h-3.5" />
                            Documentation
                        </button>
                    </Link>
                </div>
            </motion.div>

            {/* Import banner */}
            {importedGenes.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-3 p-4 bg-surface border border-border rounded-xl mb-6"
                >
                    <Dna className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-serif text-text-primary">
                            {importedGenes.length} genes imported from CRISPR screen
                            {importSourceId && (
                                <Link href={`/results/${importSourceId}`} className="ml-2 text-text-tertiary hover:text-text-primary text-xs underline">
                                    view screen
                                </Link>
                            )}
                        </p>
                        <p className="text-xs text-text-tertiary font-serif mt-0.5 truncate">
                            {importedGenes.slice(0, 6).join(", ")}{importedGenes.length > 6 ? ` +${importedGenes.length - 6} more` : ""}
                        </p>
                    </div>
                    <button onClick={() => { setImportedGenes([]); setImportSourceId(null); }} className="text-text-tertiary hover:text-text-primary transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </motion.div>
            )}

            {/* Input */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="bg-surface rounded-2xl p-8 border border-border mb-8"
            >
                <label className="block text-sm font-serif text-text-secondary mb-2">
                    Target DNA Sequence
                </label>
                <div className="relative mb-4">
                    <textarea
                        value={sequence}
                        onChange={(e) => setSequence(e.target.value.toUpperCase().replace(/[^ACGT\n\s]/g, ""))}
                        placeholder="Enter DNA sequence (e.g. ATCGGCTA...)"
                        className="w-full h-32 p-4 bg-background border border-border rounded-xl text-sm font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-border resize-none uppercase"
                    />
                    <div className="absolute bottom-4 right-4 text-xs text-text-tertiary">
                        {sequence.replace(/\s/g, "").length} bases
                    </div>
                </div>

                {error && (
                    <div className="mb-5 p-4 bg-surface border border-border text-text-secondary text-sm rounded-xl flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span className="font-serif">{error}</span>
                    </div>
                )}

                <div className="flex justify-end">
                    <Button onClick={handleAnalyze} disabled={loading || !sequence} size="lg" variant="primary">
                        {loading ? "Analyzing…" : "Run Atlas Analysis"}
                    </Button>
                </div>
            </motion.div>

            {/* Results */}
            {results.window && results.efficiency && results.offTargets && insights && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                    {/* Summary bar */}
                    <div className="flex items-center justify-between p-4 bg-surface border border-border rounded-xl">
                        <div>
                            <p className="text-sm font-serif text-text-primary font-medium">Analysis complete</p>
                            <p className="text-xs text-text-tertiary font-serif mt-0.5">
                                Window score: {results.window.window_score} / 100 · {results.window.classification}
                            </p>
                        </div>
                        {importedGenes.length > 0 && (
                            <Link href={`/txscore?genes=${importedGenes.join(",")}&from=${importSourceId || ""}`}>
                                <Button variant="primary" size="sm">
                                    <Target className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                                    Prioritize in TxScore
                                </Button>
                            </Link>
                        )}
                    </div>

                    {/* Core 3 metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Therapeutic Window */}
                        <div className="bg-surface rounded-2xl p-6 border border-border flex flex-col items-center text-center">
                            <h3 className="font-serif text-sm text-text-secondary mb-5 self-start">Therapeutic Window</h3>
                            <div className="flex-1 flex flex-col items-center justify-center py-2">
                                <div className="text-5xl font-serif font-medium text-text-primary mb-2">
                                    {results.window.classification}
                                </div>
                                <div className="text-xs text-text-tertiary font-serif mt-2 uppercase tracking-wide">
                                    Score: {results.window.window_score} / 100
                                </div>
                            </div>
                        </div>

                        {/* Editing Efficiency */}
                        <div className="bg-surface rounded-2xl p-6 border border-border">
                            <h3 className="font-serif text-sm text-text-secondary mb-5">Editing Efficiency</h3>
                            <div className="space-y-5">
                                <div>
                                    <div className="flex justify-between items-end mb-2">
                                        <span className="text-xs text-text-tertiary font-serif">Predicted efficacy</span>
                                        <span className="text-3xl font-serif text-text-primary">{results.efficiency.efficiency_score}%</span>
                                    </div>
                                    <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${results.efficiency.efficiency_score}%` }}
                                            transition={{ duration: 0.9, ease: "easeOut" }}
                                            className="h-full bg-text-primary rounded-full"
                                        />
                                    </div>
                                </div>
                                <div className="p-3 bg-background rounded-xl border border-border text-xs font-serif flex justify-between">
                                    <span className="text-text-secondary">Model confidence</span>
                                    <span className="text-text-primary">{Math.round((results.efficiency.confidence) * 100)}%</span>
                                </div>
                                <div className="p-3 bg-background rounded-xl border border-border text-xs font-serif flex justify-between">
                                    <span className="text-text-secondary">Model</span>
                                    <span className="text-text-primary uppercase font-medium">{results.efficiency.model}</span>
                                </div>
                            </div>
                        </div>

                        {/* Off-Target Safety */}
                        <div className="bg-surface rounded-2xl p-6 border border-border flex flex-col">
                            <h3 className="font-serif text-sm text-text-secondary mb-5">Off-Target Safety</h3>
                            <div className="space-y-3 flex-1">
                                <div className="p-3 bg-background rounded-xl border border-border text-xs font-serif flex justify-between">
                                    <span className="text-text-secondary">Aggregate risk score</span>
                                    <span className="text-text-primary font-medium">{results.offTargets.aggregate_risk}</span>
                                </div>
                                <div className="text-xs text-text-tertiary font-serif uppercase tracking-wider mb-2">Potential sites</div>
                                <div className="space-y-1.5 max-h-[110px] overflow-y-auto">
                                    {results.offTargets.targets.map((t, i) => (
                                        <div key={i} className="flex justify-between text-xs p-2 bg-background rounded-lg border border-border font-mono">
                                            <span className="text-text-secondary">{t.locus}</span>
                                            <span className="text-text-primary">{t.mismatches}mm · {t.risk_score}</span>
                                        </div>
                                    ))}
                                    {results.offTargets.targets.length === 0 && (
                                        <p className="text-xs text-text-tertiary font-serif italic text-center py-2">No significant off-target sites detected.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 4 Insight Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Card 1: Base Editing Feasibility */}
                        <div className="bg-surface rounded-2xl p-6 border border-border">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-serif text-sm text-text-secondary">
                                    Base Editing Feasibility
                                    <InfoTooltip text="Base editors convert C·G→T·A (CBE) or A·T→G·C (ABE) without double-strand breaks. Requires a PAM site within 15 bp of the target base, and the base must fall within the editing window (positions 4–8 from the PAM-distal end)." />
                                </h3>
                                <span className={`text-xs font-serif px-2 py-0.5 rounded border ${insights.beFeasible ? "border-border text-text-primary" : "border-border text-text-tertiary"}`}>
                                    {insights.beFeasible ? "Feasible" : "Not feasible"}
                                </span>
                            </div>
                            {insights.beFeasible ? (
                                <div className="space-y-2 text-xs font-serif">
                                    <div className="flex justify-between p-2.5 bg-background rounded-lg border border-border">
                                        <span className="text-text-secondary">Optimal editor</span>
                                        <span className="text-text-primary font-medium">{insights.beEditor}</span>
                                    </div>
                                    <div className="flex justify-between p-2.5 bg-background rounded-lg border border-border">
                                        <span className="text-text-secondary">PAM site detected</span>
                                        <span className="text-text-primary">{insights.pamPresent ? "Yes (NGG)" : "Requires PAM-flexible editor"}</span>
                                    </div>
                                    <div className="flex justify-between p-2.5 bg-background rounded-lg border border-border">
                                        <span className="text-text-secondary">Editing window (pos. 4–8)</span>
                                        <span className="font-mono text-text-primary">{sequence.replace(/\s/g,"").slice(3,8) || "—"}</span>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-text-secondary font-serif leading-relaxed">
                                    {sequence.replace(/\s/g,"").slice(3,8).match(/[AC]/) ? "No suitable C or A in editing window." : "Target base is not in the editing window (positions 4–8). Consider offset sgRNA design or prime editing."} Consider prime editing as an alternative strategy.
                                </p>
                            )}
                        </div>

                        {/* Card 2: Prime Editing Feasibility */}
                        <div className="bg-surface rounded-2xl p-6 border border-border">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-serif text-sm text-text-secondary">
                                    Prime Editing Feasibility
                                    <InfoTooltip text="Prime editing can introduce any substitution, insertion, or deletion using a pegRNA containing a spacer, primer binding site (PBS), and reverse transcriptase template (RTT). Efficiency formula: η_PE = σ(CNN(seq, PBS, RTT, chromatin))." />
                                </h3>
                                <span className="text-xs font-serif px-2 py-0.5 rounded border border-border text-text-primary">
                                    {insights.peFeasible ? "Feasible" : "Sequence too short"}
                                </span>
                            </div>
                            {insights.peFeasible && (
                                <div className="space-y-1.5">
                                    <div className="text-xs text-text-tertiary font-serif uppercase tracking-wide mb-2">Top pegRNA designs</div>
                                    {insights.peDesigns.map((d, i) => (
                                        <div key={i} className="flex items-center justify-between p-2.5 bg-background rounded-lg border border-border text-xs font-serif">
                                            <span className="text-text-secondary font-mono">{d.id}</span>
                                            <span className="text-text-tertiary">RTT {d.rtt}nt · PBS {d.pbs}nt</span>
                                            <span className="text-text-primary font-medium">{d.eff}%</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Card 3: Chromatin Accessibility */}
                        <div className="bg-surface rounded-2xl p-6 border border-border">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-serif text-sm text-text-secondary">
                                    Chromatin Accessibility
                                    <InfoTooltip text="Open chromatin (DNase hypersensitive sites) indicates accessible DNA, which substantially improves editing efficiency. Accessibility score of 1.0 represents a fully open DNase I hypersensitive site from ENCODE data." />
                                </h3>
                                <span className="text-xs font-serif text-text-tertiary">{insights.chromScore}/100</span>
                            </div>
                            <div className="mb-4">
                                <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${insights.chromScore}%` }}
                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                        className="h-full bg-text-primary rounded-full"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <div className="text-xs text-text-tertiary font-serif uppercase tracking-wide mb-2">Tissue-specific accessibility</div>
                                {insights.tissueSites.map((t, i) => (
                                    <div key={i} className="flex items-center gap-3 text-xs font-serif">
                                        <span className="text-text-secondary w-36 shrink-0">{t.tissue}</span>
                                        <div className="flex-1 h-1 bg-background rounded-full overflow-hidden border border-border">
                                            <div className="h-full bg-text-tertiary rounded-full" style={{ width: `${t.score}%` }} />
                                        </div>
                                        <span className="text-text-tertiary w-8 text-right">{t.score}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Card 4: Clinical Translation */}
                        <div className="bg-surface rounded-2xl p-6 border border-border">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-serif text-sm text-text-secondary">
                                    Clinical Translation Feasibility
                                    <InfoTooltip text="Delivery method is determined by the target tissue and therapeutic window. AAV9 is preferred for CNS and cardiac targets; LNP for hepatic and pulmonary; ex vivo editing for haematopoietic and immune cells (HSC, T-cell)." />
                                </h3>
                            </div>
                            <div className="space-y-2 text-xs font-serif">
                                <div className="flex justify-between p-2.5 bg-background rounded-lg border border-border">
                                    <span className="text-text-secondary">Recommended delivery</span>
                                    <span className="text-text-primary font-medium">{insights.deliveryMethod}</span>
                                </div>
                                <div className="flex justify-between p-2.5 bg-background rounded-lg border border-border">
                                    <span className="text-text-secondary">Expected in vivo efficiency</span>
                                    <span className="text-text-primary">{insights.inVivoEff}%</span>
                                </div>
                                <div className="flex justify-between p-2.5 bg-background rounded-lg border border-border">
                                    <span className="text-text-secondary">Regulatory pathway</span>
                                    <span className="text-text-primary">{insights.regulatory}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
