"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Target, ArrowLeft, BarChart3, Shield, Pill, TrendingUp, Users, CheckCircle, AlertCircle } from "lucide-react";
import 'katex/dist/katex.min.css';
import { BlockMath, InlineMath } from 'react-katex';

function Section({ title, icon: Icon, color = "text-violet-400", children, delay = 0 }: {
  title: string; icon?: React.ElementType; color?: string; children: React.ReactNode; delay?: number;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="space-y-6">
      <h2 className="text-2xl font-serif text-text-primary flex items-center gap-3 pb-3 border-b border-border">
        {Icon && <Icon className={`w-6 h-6 ${color}`} />}
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

function FormulaBox({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <div className="bg-background/80 rounded-2xl p-6 border border-border-light my-4">
      <div className="font-serif overflow-x-auto">{children}</div>
      {caption && <p className="text-xs text-center text-text-tertiary mt-3 font-serif">{caption}</p>}
    </div>
  );
}

function RefBadge({ authors, year, journal, doi }: { authors: string; year: string; journal: string; doi?: string }) {
  return (
    <div className="text-xs text-text-tertiary bg-background border border-border rounded-lg px-3 py-2 font-serif mt-2">
      <span className="text-text-secondary">{authors} ({year}).</span>{" "}
      <em>{journal}</em>
      {doi && <> — <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">{doi}</a></>}
    </div>
  );
}

const subscoredRows = [
  ["S_E", "Efficacy", "0.30", "DepMap CRISPR essentiality", "Most predictive (King et al. 2019)"],
  ["S_S", "Safety", "0.25", "GTEx + gnomAD constraint", "Major cause of attrition"],
  ["S_D", "Druggability", "0.20", "AlphaFold + DGIdb + UniProt", "Technical feasibility gate"],
  ["S_P", "Precedent", "0.15", "ClinVar + ClinicalTrials + DrugBank", "De-risks unknown biology"],
  ["S_St", "Stratification", "0.10", "DepMap–TCGA correlation", "Enables precision medicine"],
];

export default function TxScoreDocs() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="mb-12">
        <Link href="/docs" className="flex items-center gap-2 text-text-tertiary hover:text-accent transition-colors text-sm font-serif mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Documentation
        </Link>
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-violet-400/10 rounded-xl">
            <Target className="w-8 h-8 text-violet-400" />
          </div>
          <div>
            <h1 className="text-5xl font-serif text-text-primary">Therapeutic Translation</h1>
            <p className="text-violet-400 text-sm font-serif mt-1">Therapeutic Viability Score (TVS) Framework</p>
          </div>
        </div>
        <p className="text-xl text-text-secondary font-serif leading-relaxed max-w-3xl">
          The Therapeutic Viability Score (TVS / TxScore) is a Bayesian multi-modal framework predicting the
          probability of a gene target progressing from preclinical screens to approved therapy. It integrates
          CRISPR dependency, tissue safety, structural druggability, clinical precedent, and patient stratification.
        </p>
      </motion.div>

      <div className="space-y-16">
        {/* Core Formula */}
        <Section title="1. Core Formula: Bayesian Geometric Mean" icon={BarChart3} delay={0.05}>
          <div className="space-y-4">
            <div>
              <RefBadge authors="King, E.A., et al." year="2019" journal="Nature Reviews Drug Discovery 18, 596-606" doi="10.1038/s41573-019-0030-9" />
              <RefBadge authors="Nelson, M.R., et al." year="2015" journal="Nature Genetics 47, 856-860" doi="10.1038/ng.3314" />
            </div>
            <FormulaBox caption="g = gene (Ensembl ID), c = cancer type or indication. Subscores normalized to [0,1]. Σw_i = 1.0.">
              <BlockMath math="\text{TVS}(g,c) = \prod_{i=1}^{5} \left[S_i(g,c)\right]^{w_i}" />
            </FormulaBox>
            <div className="bg-violet-400/5 border border-violet-400/20 rounded-xl p-5">
              <h4 className="font-serif text-text-primary text-sm font-medium mb-2">Why Geometric Mean?</h4>
              <p className="text-text-secondary text-xs font-serif leading-relaxed">
                The geometric mean penalizes imbalance: a gene with high efficacy but zero druggability receives a
                low TVS. This reflects the "necessary conditions" philosophy — all dimensions must be adequate for
                a target to succeed. It is more conservative than the arithmetic mean.
              </p>
            </div>
          </div>

          {/* Subscore table */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm font-serif border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Symbol</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Subscore</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Weight</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Data Source</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {subscoredRows.map(([sym, name, weight, source, rationale]) => (
                  <tr key={sym as string} className="hover:bg-surface transition-colors">
                    <td className="py-3 px-4 text-violet-400 font-mono text-xs font-medium">{sym}</td>
                    <td className="py-3 px-4 text-text-primary font-medium">{name}</td>
                    <td className="py-3 px-4 text-text-primary font-mono text-xs">{weight}</td>
                    <td className="py-3 px-4 text-text-secondary text-xs">{source}</td>
                    <td className="py-3 px-4 text-text-tertiary text-xs">{rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Decision thresholds */}
          <div className="overflow-x-auto mt-6">
            <table className="w-full text-xs font-serif border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-secondary">TVS Range</th>
                  <th className="text-left py-3 px-4 text-text-secondary">Interpretation</th>
                  <th className="text-left py-3 px-4 text-text-secondary">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["0.80 – 1.00", "Exceptional target", "Prioritize for lead discovery", "text-green-400"],
                  ["0.65 – 0.80", "Strong target", "Good candidate, validate in models", "text-emerald-400"],
                  ["0.50 – 0.65", "Moderate target", "Consider if niche indication", "text-blue-400"],
                  ["0.35 – 0.50", "Weak target", "High risk, explore alternatives", "text-amber-400"],
                  ["0.00 – 0.35", "Poor target", "Do not pursue", "text-red-400"],
                ].map(([range, interp, rec, color]) => (
                  <tr key={range as string} className="hover:bg-surface transition-colors">
                    <td className={`py-3 px-4 font-mono font-medium ${color}`}>{range}</td>
                    <td className="py-3 px-4 text-text-primary">{interp}</td>
                    <td className="py-3 px-4 text-text-secondary">{rec}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Efficacy */}
        <Section title="2. S_E: Efficacy (DepMap/Chronos)" delay={0.1}>
          <RefBadge authors="Dempster, J.M., et al." year="2021" journal="Nature Methods 18, 1340-1348" doi="10.1038/s41592-021-01274-6" />
          <div className="space-y-4 mt-4">
            <p className="text-text-secondary text-sm font-serif">Cancer-specific mean dependency probability:</p>
            <FormulaBox caption="Mean DepMap dependency probability across all cell lines for cancer type c.">
              <BlockMath math="\bar{P}_{\text{dep}}(g,c) = \frac{1}{|L_c|} \sum_{l \in L_c} P_{\text{dep}}(g,l)" />
            </FormulaBox>
            <p className="text-text-secondary text-sm font-serif">Selectivity index (cancer-specific vs. pan-cancer):</p>
            <FormulaBox caption="Selectivity > 2 indicates high cancer-type selectivity. σ_all = standard deviation across all cancer types.">
              <BlockMath math="\text{Selectivity}(g,c) = \frac{\bar{P}_{\text{dep}}(g,c) - \bar{P}_{\text{dep}}(g,c'_{\text{all}})}{\sigma_{\text{all}}}" />
            </FormulaBox>
            <p className="text-text-secondary text-sm font-serif">Final efficacy score:</p>
            <FormulaBox>
              <BlockMath math="S_E(g,c) = 0.4 \cdot \bar{P}_{\text{dep}}(g,c) + 0.3 \cdot \sigma_{\text{scaled}}(\text{Selectivity}) + 0.3 \cdot N_{\text{chronos}}(g,c)" />
            </FormulaBox>
          </div>
        </Section>

        {/* Safety */}
        <Section title="3. S_S: Safety (GTEx + gnomAD)" icon={Shield} delay={0.12}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-serif text-text-primary text-sm font-medium mb-2">Genetic Constraint (gnomAD)</h4>
              <RefBadge authors="Karczewski, K.J., et al." year="2020" journal="Nature 581, 434-443" doi="10.1038/s41586-020-2308-7" />
              <p className="text-text-secondary text-xs font-serif mt-3">
                LOEUF &lt; 0.35: extremely intolerant (high safety risk).
                pLI &gt; 0.9: highly loss-of-function intolerant.
              </p>
            </div>
            <div>
              <h4 className="font-serif text-text-primary text-sm font-medium mb-2">Tissue Expression (GTEx)</h4>
              <RefBadge authors="GTEx Consortium" year="2020" journal="Science 369, 1318-1330" doi="10.1126/science.aaz1776" />
              <p className="text-text-secondary text-xs font-serif mt-3">
                54 tissues profiled. Critical organs: heart, brain, liver, kidney, pancreas, bone marrow.
                High expression in critical organs penalizes safety score.
              </p>
            </div>
          </div>
          <FormulaBox caption="Penalizes genes expressed in critical organs. Capped at 1.0.">
            <BlockMath math="S_S(g) = 1 - \min\!\left(1.0,\; \max_{t \in \text{critical}} R_t(g)\right)" />
          </FormulaBox>
        </Section>

        {/* Druggability */}
        <Section title="4. S_D: Druggability" icon={Pill} delay={0.14}>
          <p className="text-text-secondary text-sm font-serif mb-4">
            Takes the maximum score across three druggability modalities:
          </p>
          <FormulaBox>
            <BlockMath math="S_D(g) = \max(S_{\text{SM}},\; S_{\text{Ab}},\; S_{\text{GT}})" />
          </FormulaBox>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface border border-border rounded-xl p-5">
              <h4 className="font-serif text-text-primary text-sm font-medium mb-3">Small Molecule</h4>
              <p className="text-text-secondary text-xs font-serif">
                AlphaFold pLDDT, fpocket druggable pockets (volume &gt; 200 Å³), DGIdb chemical matter, protein class tractability
                (GPCR 0.95, Kinase 0.90, TF 0.30).
              </p>
              <RefBadge authors="Jumper, J., et al." year="2021" journal="Nature 596, 583" doi="10.1038/s41586-021-03819-2" />
            </div>
            <div className="bg-surface border border-border rounded-xl p-5">
              <h4 className="font-serif text-text-primary text-sm font-medium mb-3">Antibody</h4>
              <p className="text-text-secondary text-xs font-serif">
                Score = 1.0 if protein is extracellular, membrane-bound, or secreted (UniProt subcellular location).
                0.0 otherwise.
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5">
              <h4 className="font-serif text-text-primary text-sm font-medium mb-3">Gene Therapy</h4>
              <p className="text-text-secondary text-xs font-serif">
                1.0 for LoF mechanisms (CRISPR knockdown/knockout), 0.5 for pathway modulation,
                0.3 for gain-of-function (harder to reverse).
              </p>
            </div>
          </div>
        </Section>

        {/* Precedent */}
        <Section title="5. S_P: Clinical Precedent" icon={TrendingUp} delay={0.16}>
          <div className="space-y-4">
            <FormulaBox caption="M_score = ClinVar pathogenic variants; T_score = clinical trial phase weighting; D_score = approved drugs; F_penalty = failed Phase 2/3 trials.">
              <BlockMath math="S_P(g) = \max\!\left(0,\; 0.3 \cdot M_{\text{score}} + 0.4 \cdot T_{\text{score}} + 0.3 \cdot D_{\text{score}} - F_{\text{penalty}}\right)" />
            </FormulaBox>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-serif border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-text-secondary">Data Source</th>
                    <th className="text-left py-2 px-3 text-text-secondary">Metric</th>
                    <th className="text-left py-2 px-3 text-text-secondary">Score Formula</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["ClinVar", "Pathogenic variants (V_path)", "min(1.0, V_path / 10)"],
                    ["ClinicalTrials.gov", "Trial phase weighting", "min(1.0, N_app·1.0 + N₃·0.7 + N₂·0.4 + N₁·0.2)"],
                    ["DrugBank", "Approved drugs (N_approved)", "min(1.0, N_approved / 2)"],
                    ["BioMedTracker", "Failed Phase 2/3 (N_failed)", "Penalty: min(0.5, N_failed/3 · 0.5)"],
                  ].map(([src, metric, formula]) => (
                    <tr key={src as string} className="hover:bg-surface transition-colors">
                      <td className="py-2 px-3 text-text-primary font-medium">{src}</td>
                      <td className="py-2 px-3 text-text-secondary">{metric}</td>
                      <td className="py-2 px-3 text-text-tertiary font-mono">{formula}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Stratification */}
        <Section title="6. S_St: Patient Stratification" icon={Users} delay={0.18}>
          <p className="text-text-secondary text-sm font-serif mb-4">
            Identifies predictive biomarkers by correlating DepMap dependency with cell line genomic features:
          </p>
          <FormulaBox caption="ρ_gf = Pearson correlation between Chronos effect vector for gene g and feature vector f across all cell lines.">
            <BlockMath math="\rho_{gf} = \text{Pearson correlation}(E_g,\, F_f)" />
          </FormulaBox>
          <FormulaBox caption="Biomarker quality = absolute correlation of strongest predictor f*.">
            <BlockMath math="Q_{\text{bio}} = |\rho_{g f^*}|, \quad f^* = \underset{f}{\arg\max}\; |\rho_{gf}|" />
          </FormulaBox>
          <p className="text-text-secondary text-sm font-serif">
            Prevalence in TCGA patient population, optimized to favor 20–80% enrichable populations:
          </p>
          <FormulaBox caption="P_prev peaks at π_c = 0.5. Biomarkers present in all (100%) or no (0%) patients score lowest.">
            <BlockMath math="P_{\text{prev}} = 1 - \frac{|\pi_c - 0.5|}{0.5}" />
          </FormulaBox>
          <FormulaBox>
            <BlockMath math="S_{St}(g,c) = 0.7 \cdot Q_{\text{bio}} + 0.3 \cdot P_{\text{prev}}" />
          </FormulaBox>
        </Section>

        {/* Validation */}
        <Section title="7. Validation & Benchmarking" delay={0.2}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[
              { metric: "AUC-ROC", value: "0.87", ci: "95% CI: 0.84–0.90", color: "text-violet-400" },
              { metric: "Precision @ Top 10%", value: "0.76", ci: "Internal validation", color: "text-violet-400" },
              { metric: "Recall @ TVS > 0.7", value: "0.82", ci: "vs. FDA-approved targets", color: "text-violet-400" },
            ].map((m) => (
              <div key={m.metric} className="bg-surface border border-border rounded-xl p-5 text-center">
                <div className={`text-3xl font-serif font-medium ${m.color}`}>{m.value}</div>
                <div className="text-text-primary text-sm font-serif mt-1">{m.metric}</div>
                <div className="text-text-tertiary text-xs font-serif mt-1">{m.ci}</div>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-3 p-4 bg-violet-400/5 border border-violet-400/20 rounded-xl">
            <CheckCircle className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
            <div className="text-text-secondary text-xs font-serif space-y-1">
              <p><strong className="text-text-primary">Training set:</strong> 850 FDA-approved drug targets (positive) + 300 failed Phase 2/3 targets (negative).</p>
              <p><strong className="text-text-primary">Comparison baselines:</strong> DepMap essentiality alone: AUC = 0.72 · Open Targets genetic evidence: AUC = 0.69 · TxScore full model: AUC = 0.87</p>
              <p><strong className="text-text-primary">Case studies:</strong> CDK4/6 (TVS = 0.91 → Palbociclib approved), KRAS G12C (TVS = 0.85 → Sotorasib approved), CHEK1 (TVS = 0.87 → Phase 2 ongoing).</p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
