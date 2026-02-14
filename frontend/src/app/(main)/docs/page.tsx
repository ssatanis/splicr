"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Dna, Activity, Target, BookOpen, ArrowRight, FlaskConical, ChevronRight } from "lucide-react";

const docSections = [
  {
    icon: Dna,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/20",
    title: "CRISPR Screen Analysis",
    subtitle: "MAGeCK, BAGEL2 & DrugZ Statistical Framework",
    description:
      "Pooled CRISPR screen analysis using negative binomial models, robust rank aggregation, Bayesian essentiality classifiers, and DrugZ z-score normalization. Complete mathematical derivations and implementation details.",
    href: "/docs/crispr-screen-analysis",
    topics: ["MAGeCK Algorithm", "BAGEL2 Bayesian Framework", "DrugZ Analysis", "Quality Control Metrics"],
  },
  {
    icon: Activity,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
    title: "Editability Atlas (TEA)",
    subtitle: "EDIT Score & Therapeutic Window Prediction",
    description:
      "AI-powered prediction of gene editing feasibility integrating base editability, prime editability, therapeutic window, off-target safety, and delivery optimization into a unified EDIT score.",
    href: "/docs/editability-atlas",
    topics: ["EDIT Score Formula", "Base & Prime Editability", "Off-Target CFD Scoring", "Delivery Optimization"],
  },
  {
    icon: Target,
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    border: "border-violet-400/20",
    title: "Therapeutic Translation (TxScore)",
    subtitle: "Therapeutic Viability Score (TVS) Framework",
    description:
      "Bayesian multi-modal framework predicting the probability of a gene target progressing from preclinical screens to approved therapy. Integrates DepMap, GTEx, gnomAD, AlphaFold, and ClinVar.",
    href: "/docs/therapeutic-translation",
    topics: ["TVS Geometric Mean", "Efficacy (DepMap/Chronos)", "Safety (GTEx/gnomAD)", "Druggability & Precedent"],
  },
];

const stats = [
  { value: "141,456", label: "Humans in gnomAD constraint dataset" },
  { value: "850+", label: "FDA-approved drug targets (training set)" },
  { value: "0.87", label: "TxScore AUC-ROC (internal validation)" },
  { value: "54", label: "GTEx tissues profiled for safety" },
];

export default function DocsPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-8 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12"
      >
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-accent/10 rounded-xl">
            <BookOpen className="w-8 h-8 text-accent" />
          </div>
          <div>
            <h1 className="text-4xl font-serif text-text-primary">Documentation</h1>
            <p className="text-text-secondary mt-1 font-serif">
              PhD-level methodology, algorithms, and mathematical foundations
            </p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6">
          <p className="text-text-secondary font-serif leading-relaxed">
            SplicR integrates three cutting-edge computational biology tools into a unified pipeline from CRISPR screens
            to FDA-approvable gene therapy candidates. Each component is grounded in peer-reviewed methodology with
            full mathematical transparency.
          </p>
        </div>
      </motion.div>

      {/* Stats bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12"
      >
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-serif font-medium text-accent">{stat.value}</div>
            <div className="text-xs text-text-tertiary font-serif mt-1 leading-tight">{stat.label}</div>
          </div>
        ))}
      </motion.div>

      {/* Doc Sections */}
      <div className="space-y-6">
        {docSections.map((section, i) => {
          const Icon = section.icon;
          return (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
            >
              <Link href={section.href} className="group block">
                <div className={`bg-surface border ${section.border} rounded-2xl p-7 hover:shadow-lg transition-all duration-200 hover:border-opacity-50`}>
                  <div className="flex items-start gap-5">
                    <div className={`p-3 ${section.bg} rounded-xl shrink-0`}>
                      <Icon className={`w-7 h-7 ${section.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h2 className="text-xl font-serif text-text-primary group-hover:text-accent transition-colors">
                          {section.title}
                        </h2>
                        <ArrowRight className="w-4 h-4 text-text-tertiary group-hover:text-accent group-hover:translate-x-1 transition-all" />
                      </div>
                      <p className={`text-sm font-serif ${section.color} mb-3`}>{section.subtitle}</p>
                      <p className="text-text-secondary text-sm font-serif leading-relaxed mb-4">
                        {section.description}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {section.topics.map((topic) => (
                          <span
                            key={topic}
                            className="text-xs px-2.5 py-1 bg-background border border-border rounded-full text-text-tertiary font-serif"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Pipeline Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="mt-12 bg-surface border border-border rounded-2xl p-8"
      >
        <h2 className="text-xl font-serif text-text-primary mb-6 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-accent" />
          Integrated Pipeline
        </h2>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          {[
            { label: "CRISPR Screen", sub: "MAGeCK / BAGEL2 / DrugZ", color: "border-blue-400/40 bg-blue-400/5" },
            { label: "Editability", sub: "EDIT Score", color: "border-emerald-400/40 bg-emerald-400/5" },
            { label: "Translation", sub: "TVS Score", color: "border-violet-400/40 bg-violet-400/5" },
          ].map((step, i) => (
            <div key={step.label} className="flex items-center gap-4 flex-1">
              <div className={`flex-1 border ${step.color} rounded-xl p-4 text-center`}>
                <div className="text-sm font-serif text-text-primary font-medium">{step.label}</div>
                <div className="text-xs text-text-tertiary font-serif mt-0.5">{step.sub}</div>
              </div>
              {i < 2 && <ChevronRight className="w-4 h-4 text-text-tertiary shrink-0" />}
            </div>
          ))}
        </div>
        <p className="text-text-tertiary text-xs font-serif mt-4 leading-relaxed">
          Each tool in the pipeline can be used independently, or results can flow seamlessly from CRISPR screen analysis
          through editability prediction to therapeutic target prioritization.
        </p>
      </motion.div>
    </div>
  );
}
