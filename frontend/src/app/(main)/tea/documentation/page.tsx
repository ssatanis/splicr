"use client";

import { motion } from "framer-motion";
import { BookOpen, Zap, Shield, Activity, ArrowLeft } from "lucide-react";
import Link from "next/link";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

export default function TEADocumentationPage() {
    return (
        <div className="max-w-[900px] mx-auto px-8 py-16">
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="mb-12"
            >
                <Link
                    href="/tea"
                    className="flex items-center gap-2 text-text-tertiary hover:text-accent transition-colors text-sm font-serif mb-8 group"
                >
                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                    Back to Atlas
                </Link>

                <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-accent/10 rounded-xl text-accent">
                        <BookOpen className="w-8 h-8" />
                    </div>
                    <h1 className="text-5xl font-serif text-text-primary">TEA Platform</h1>
                </div>
                <p className="text-xl text-text-secondary font-serif leading-relaxed max-w-2xl">
                    The Therapeutic Editability Atlas (TEA) is a state-of-the-art computational engine designed to predict the safety and efficacy of base editing for therapeutic applications.
                </p>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="prose prose-invert max-w-none space-y-16"
            >
                {/* section: Overview */}
                <section>
                    <h2 className="text-2xl font-serif text-text-primary flex items-center gap-2 mb-6">
                        <Activity className="w-6 h-6 text-accent" />
                        Platform Architecture
                    </h2>
                    <p className="text-text-secondary leading-relaxed">
                        TEA integrates multiple machine learning models to provide a holistic view of a genomic target's editability. By combining on-target efficiency predictions with comprehensive off-target risk assessment, TEA calculates a unified <span className="text-accent italic">Therapeutic Window</span> (TW) score.
                    </p>
                </section>

                {/* section: Mathematical Models */}
                <section className="bg-surface/50 rounded-3xl p-10 border border-border">
                    <h2 className="text-2xl font-serif text-text-primary flex items-center gap-2 mb-8">
                        <Zap className="w-6 h-6 text-success" />
                        Mathematical Framework
                    </h2>

                    <div className="space-y-10">
                        <div>
                            <h3 className="text-lg font-serif text-text-primary mb-4">1. Efficiency Prediction (PRIDICT)</h3>
                            <p className="text-sm text-text-secondary mb-6">
                                TEA utilizes the PRIDICT (Position-specific Real-time Inference of DNA-editing Impact in Cellular Transformation) model. It calculates the probability of successful nucleotide conversion based on local sequence context.
                            </p>
                            <div className="bg-background/80 rounded-2xl p-6 border border-border-light font-serif">
                                <BlockMath math="E = \sigma\left( \sum_{i=-20}^{20} w_i \cdot x_i + \beta \right)" />
                                <p className="text-[10px] text-center text-text-tertiary mt-2">
                                    Where E is the efficiency score, σ is the sigmoid activation, and $x_i$ represents the one-hot encoded sequence features.
                                </p>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-serif text-text-primary mb-4">2. Off-Target Risk (CFD Scoring)</h3>
                            <p className="text-sm text-text-secondary mb-6">
                                Safety is assessed using the Cutting Frequency Determination (CFD) model, which evaluates potential off-target activity across the entire genome.
                            </p>
                            <div className="bg-background/80 rounded-2xl p-6 border border-border-light font-serif">
                                <BlockMath math="R_{agg} = \min\left( 100, \sum_{s \in S} \prod_{p=1}^{20} w_p(m_p, i_p) \right)" />
                                <p className="text-[10px] text-center text-text-tertiary mt-2">
                                    Aggregate risk <InlineMath math="R_{agg}" /> is the sum of product weights <InlineMath math="w_p" /> for all potential off-target sites <InlineMath math="S" /> where <InlineMath math="m_p" /> is mutation type.
                                </p>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-serif text-text-primary mb-4">3. Therapeutic Window (TW)</h3>
                            <p className="text-sm text-text-secondary mb-6">
                                The final TW score is a weighted ratio that penalizes efficacy by the safety risk factor.
                            </p>
                            <div className="bg-background/80 rounded-2xl p-6 border border-border-light font-serif">
                                <BlockMath math="TW = \min\left(100, \alpha \cdot \frac{E}{\max(1, R_{agg})} \right)" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* section: Safety */}
                <section>
                    <h2 className="text-2xl font-serif text-text-primary flex items-center gap-2 mb-6">
                        <Shield className="w-6 h-6 text-warning" />
                        Safety Thresholds
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            { label: "Excellent", range: "TW > 50", color: "text-success", desc: "Minimal off-target risk, high surgical precision." },
                            { label: "Good", range: "20 < TW < 50", color: "text-info", desc: "Safe for therapeutic consideration with monitoring." },
                            { label: "Fair", range: "5 < TW < 20", color: "text-warning", desc: "Potential safety concerns; requires validation." },
                            { label: "Poor", range: "TW < 5", color: "text-error", desc: "High off-target risk; not recommended." }
                        ].map((tier, i) => (
                            <div key={i} className="p-6 bg-surface border border-border rounded-2xl">
                                <div className={`font-serif text-lg ${tier.color} mb-1`}>{tier.label}</div>
                                <div className="text-xs font-mono text-text-tertiary mb-3">{tier.range}</div>
                                <p className="text-sm text-text-secondary">{tier.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <div className="pt-12 border-t border-border">
                    <p className="text-sm text-text-tertiary text-center font-serif italic">
                        TEA (Therapeutic Editability Atlas) - v1.0.0 Experimental Platform
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
