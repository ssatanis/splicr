'use client';

import { motion } from 'framer-motion';
import { X, BookOpen } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { BlockMath } from 'react-katex';

interface DocumentationProps {
    onClose: () => void;
}

export default function Documentation({ onClose }: DocumentationProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-4xl h-[85vh] bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                role="dialog"
                aria-modal="true"
                aria-labelledby="docs-title"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/10 dark:bg-black/20 backdrop-blur-md">
                    <h2 id="docs-title" className="text-xl font-serif font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                        <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        TxScore Methodology
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-full transition-colors text-slate-400"
                        aria-label="Close documentation"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-8 text-foreground custom-scrollbar">
                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">1. Overview</h3>
                        <p className="leading-relaxed">
                            The SplicR Therapeutic Viability Score (TVS) is a composite metric designed to rank therapeutic targets based on their
                            potential for successful clinical translation. It integrates multi-dimensional data across efficacy, safety, druggability,
                            and clinical precedence.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">2. Scoring Model</h3>
                        <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                            The core TVS is calculated as a weighted geometric mean of normalized component scores:
                        </p>
                        <div className="py-6 px-8 bg-blue-50/30 dark:bg-blue-900/10 rounded-2xl border border-white/10 overflow-x-auto backdrop-blur-sm">
                            {/* @ts-ignore */}
                            <BlockMath math="TVS = \prod_{i} S_i^{w_i}" />
                        </div>
                        <p className="leading-relaxed">
                            Where:
                        </p>
                        <ul className="list-disc list-inside space-y-2 ml-4">
                            <li><span className="font-mono">TVS</span>: Therapeutic Viability Score (0-1)</li>
                            <li><span className="font-mono">S_E</span>: Efficacy Score (CRISPR/RNAi dependency)</li>
                            <li><span className="font-mono">S_S</span>: Safety Score (Tissue specificity, genetic constraint)</li>
                            <li><span className="font-mono">S_D</span>: Druggability Score (Structure availability, pockets)</li>
                            <li><span className="font-mono">S_C</span>: Clinical Precedence Score (Trials, approved drugs)</li>
                        </ul>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold">3. Efficacy Component (S_E)</h3>
                        <p className="leading-relaxed">
                            Efficacy is derived from DepMap Chronos scores and consistency across cell lines of the target indication.
                        </p>
                        <BlockMath math="S_E = 0.4 \cdot P_{dep} + 0.3 \cdot S_{sel} + 0.3 \cdot N_{chronos}" />
                        <p className="text-sm text-muted-foreground">
                            Calculated as a weighted linear combination of Dependency Probability, Selectivity Index, and Normalized Chronos Score.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold">4. Safety Component (S_S)</h3>
                        <p className="leading-relaxed">
                            Safety penalizes targets with high expression in critical tissues (Heart, Liver, Brain) and high genetic constraint (pLI, LOEUF).
                        </p>
                    </section>

                    <div className="pt-8 border-t border-border">
                        <p className="text-sm text-muted-foreground italic">
                            Documentation version 1.0. For full details, refer to the SplicR technical whitepaper.
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
