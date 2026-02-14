"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Activity, ArrowLeft, Zap, Shield, Target, CheckCircle, AlertCircle } from "lucide-react";
import 'katex/dist/katex.min.css';
import { BlockMath, InlineMath } from 'react-katex';

function Section({ title, icon: Icon, color = "text-emerald-400", children, delay = 0 }: {
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
      {doi && <> — <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{doi}</a></>}
    </div>
  );
}

const componentRows = [
  ["S₁", "Base Editability", "0.25", "Can base editors (ABE, CBE) fix this variant?"],
  ["S₂", "Prime Editability", "0.25", "Can prime editors fix this variant?"],
  ["S₃", "Therapeutic Window", "0.20", "Disease vs. normal tissue selectivity"],
  ["S₄", "Cell-Type Specificity", "0.15", "Editing efficiency in the target tissue"],
  ["S₅", "Off-Target Safety", "0.10", "Patient-specific off-target risk"],
  ["S₆", "Deliverability", "0.05", "Can editors reach the target cells?"],
];

export default function TEADocs() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="mb-12">
        <Link href="/docs" className="flex items-center gap-2 text-text-tertiary hover:text-accent transition-colors text-sm font-serif mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Documentation
        </Link>
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-emerald-400/10 rounded-xl">
            <Activity className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-5xl font-serif text-text-primary">Editability Atlas (TEA)</h1>
            <p className="text-emerald-400 text-sm font-serif mt-1">EDIT Score & Therapeutic Window Prediction</p>
          </div>
        </div>
        <p className="text-xl text-text-secondary font-serif leading-relaxed max-w-3xl">
          The Therapeutic Editability Atlas predicts the feasibility of correcting pathogenic variants using base
          editing, prime editing, or CRISPR nucleases. It integrates sequence context, chromatin accessibility,
          DNA repair pathway activity, and tissue-specific delivery into a unified EDIT score.
        </p>
      </motion.div>

      <div className="space-y-16">
        {/* Core Innovation */}
        <Section title="1. Core Innovation: The EDIT Score" icon={Zap} delay={0.05}>
          <p className="text-text-secondary font-serif leading-relaxed">
            The EDIT score aggregates six orthogonal components into a 0–100 score predicting clinical success
            probability. It is the world's first AI-powered, multi-dimensional clinical translation predictor for
            CRISPR gene therapy.
          </p>
          <FormulaBox caption="Where v = variant (chr:pos:ref:alt), t = target tissue, g = patient genome (VCF, optional). Scores are normalized to [0,1].">
            <BlockMath math="\text{EDIT}(v,t,g) = \sum_{i=1}^{6} w_i \cdot S_i(v,t,g)" />
          </FormulaBox>

          {/* Component table */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm font-serif border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Component</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Description</th>
                  <th className="text-right py-3 px-4 text-text-secondary font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {componentRows.map(([symbol, name, weight, desc]) => (
                  <tr key={symbol as string} className="hover:bg-surface transition-colors">
                    <td className="py-3 px-4 text-emerald-400 font-mono text-xs font-medium">{symbol}</td>
                    <td className="py-3 px-4">
                      <div className="text-text-primary font-medium">{name}</div>
                      <div className="text-text-tertiary text-xs mt-0.5">{desc}</div>
                    </td>
                    <td className="py-3 px-4 text-right text-text-primary font-mono text-xs">{weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              { range: "EDIT > 80", label: "High confidence", color: "border-green-400/40 bg-green-400/5 text-green-400", action: "Proceed to IND-enabling studies" },
              { range: "EDIT 60-80", label: "Moderate", color: "border-blue-400/40 bg-blue-400/5 text-blue-400", action: "Optimize pegRNA/editor" },
              { range: "EDIT 40-60", label: "Low", color: "border-amber-400/40 bg-amber-400/5 text-amber-400", action: "Consider ASO/small molecule" },
              { range: "EDIT < 40", label: "Not recommended", color: "border-red-400/40 bg-red-400/5 text-red-400", action: "Not recommended" },
            ].map((tier) => (
              <div key={tier.range} className={`border ${tier.color} rounded-xl p-4`}>
                <div className={`text-sm font-mono font-medium ${tier.color.split(' ')[2]}`}>{tier.range}</div>
                <div className="text-text-primary text-xs font-serif font-medium mt-1">{tier.label}</div>
                <div className="text-text-tertiary text-xs font-serif mt-1">{tier.action}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Base Editability */}
        <Section title="2. Component S₁: Base Editability" delay={0.1}>
          <p className="text-text-secondary text-sm font-serif mb-2">
            Applicable to C→T and A→G substitutions. Uses an XGBoost regressor trained on 50,000+ base edits from:
          </p>
          <RefBadge
            authors="Arbab, M., et al."
            year="2020"
            journal="Cell 182, 463-480"
            doi="10.1016/j.cell.2020.05.070"
          />
          <div className="mt-4 space-y-4">
            <p className="text-text-secondary text-sm font-serif">
              Features extracted from a 50 bp window: GC content, nucleotide one-hot encoding, PAM availability
              (SpCas9 NGG, SaCas9 NNGRRT, Cas9-NG), distance from target base to nick site, chromatin accessibility
              (ENCODE DNase-seq), and DNA shape parameters (minor groove width, propeller twist, roll).
            </p>
            <FormulaBox caption="A_chr = chromatin accessibility score ∈ [0,1] from ENCODE DNase-seq for the target tissue.">
              <BlockMath math="S_1 = P(\text{Edit Success} \mid \text{Features}) \times A_{\text{chr}}" />
            </FormulaBox>
            <p className="text-text-secondary text-xs font-serif">
              Optimal PAM distance: positions 5–7 from the nick site. Accessibility from Meuleman et al. (2020) <em>Nature</em> 584, 244.
            </p>
          </div>
        </Section>

        {/* Prime Editability */}
        <Section title="3. Component S₂: Prime Editability" delay={0.12}>
          <p className="text-text-secondary text-sm font-serif mb-2">
            Applicable to any variant type (SNV, indel, insertion). Uses PRIDICT2.0 deep learning model:
          </p>
          <RefBadge
            authors="Mathis, N., et al."
            year="2023"
            journal="Nature Biotechnology 41, 1528-1536"
            doi="10.1038/s41587-023-01678-y"
          />
          <div className="mt-4 space-y-4">
            <p className="text-text-secondary text-sm font-serif">
              pegRNA design parameters: RT template length 10–16 nt (optimal 13 nt), PBS length 10–15 nt (Tm 30–40°C).
              Spacer selected 0–30 bp from edit site on either strand.
            </p>
            <FormulaBox caption="CNN-LSTM model trained on ~200,000 pegRNAs. σ = sigmoid activation.">
              <BlockMath math="S_2 = \sigma\!\left(\text{CNN-LSTM}(\text{pegRNA}_{\text{seq}},\, \text{PBS},\, \text{RTT},\, \text{chromatin})\right)" />
            </FormulaBox>
          </div>
        </Section>

        {/* Therapeutic Window */}
        <Section title="4. Component S₃: Therapeutic Window" icon={Target} color="text-emerald-400" delay={0.14}>
          <p className="text-text-secondary text-sm font-serif mb-4">
            Quantifies selectivity: editing efficiency in the disease tissue vs. critical normal organs.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-serif text-text-primary text-sm font-medium mb-2">Genetic Disease (e.g., sickle cell)</h4>
              <FormulaBox caption="ε = 0.01 to avoid division by zero.">
                <BlockMath math="S_3 = \frac{\text{Edit}_{\text{disease}}}{\text{Edit}_{\text{normal}} + \epsilon}" />
              </FormulaBox>
            </div>
            <div>
              <h4 className="font-serif text-text-primary text-sm font-medium mb-2">Cancer Targets (DepMap)</h4>
              <FormulaBox>
                <BlockMath math="S_3 = \frac{|\text{Chronos}_{\text{tumor}}|}{|\text{Chronos}_{\text{normal}}| + \epsilon}" />
              </FormulaBox>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-serif mt-2">
            {[
              { val: "S₃ > 10", label: "Excellent window", color: "text-green-400" },
              { val: "S₃ = 5–10", label: "Good, proceed with caution", color: "text-blue-400" },
              { val: "S₃ = 3–5", label: "Narrow, careful dosing", color: "text-amber-400" },
              { val: "S₃ < 3", label: "High toxicity risk", color: "text-red-400" },
            ].map((t) => (
              <div key={t.val} className="bg-surface border border-border rounded-lg p-2 text-center">
                <div className={`font-mono font-medium ${t.color}`}>{t.val}</div>
                <div className="text-text-tertiary mt-0.5">{t.label}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Off-Target Safety */}
        <Section title="5. Component S₅: Off-Target Safety" icon={Shield} delay={0.16}>
          <RefBadge authors="Bae, S., et al." year="2014" journal="Bioinformatics 30, 1473-1475" doi="10.1093/bioinformatics/btu048" />
          <div className="mt-4 space-y-4">
            <p className="text-text-secondary text-sm font-serif">
              Cas-OFFinder searches hg38 for all sgRNA matches with ≤4 mismatches. Cutting Frequency Determination
              (CFD) scores weight each mismatch by position and type:
            </p>
            <FormulaBox caption="M_ij = mismatch penalty at position i for mismatch type j (from Doench et al. 2016, Nature Biotechnology).">
              <BlockMath math="\text{CFD} = \prod_{i=1}^{20} M_{ij}" />
            </FormulaBox>
            <FormulaBox caption="w_ot = 1.0 for coding exon, 0.5 for regulatory element, 0.1 otherwise. High-risk: CFD > 0.2 in accessible chromatin.">
              <BlockMath math="S_5 = 1 - \left( \frac{\sum_{\text{ot}} w_{\text{ot}} \cdot \text{CFD}_{\text{ot}} \cdot A_{\text{chr,ot}}}{N_{\text{high-risk}}} \right)" />
            </FormulaBox>
            <div className="flex items-start gap-3 p-4 bg-emerald-400/5 border border-emerald-400/20 rounded-xl">
              <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-text-secondary text-xs font-serif">
                Patient VCF upload enables personalized off-target analysis: patient-specific SNPs that create
                new PAM sites or improve mismatch scores are flagged as elevated risk.
              </p>
            </div>
          </div>
        </Section>

        {/* Deliverability */}
        <Section title="6. Component S₆: Deliverability" delay={0.18}>
          <p className="text-text-secondary text-sm font-serif mb-4">
            Takes the maximum transduction efficiency across all applicable delivery modalities for the target tissue:
          </p>
          <FormulaBox caption="E_{m,t} = transduction efficiency for modality m in tissue t. Modalities: AAV1-9, LNP, Ex vivo electroporation.">
            <BlockMath math="S_6 = \max_{m \in \{\text{AAV, LNP, Ex vivo}\}} E_{m,t}" />
          </FormulaBox>
          <p className="text-text-secondary text-sm font-serif mb-3">
            Cargo size penalty is applied when the editor exceeds AAV packaging capacity:
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs font-serif">
            {[
              { cond: "≤ 4.7 kb", mult: "× 1.0", color: "border-green-400/30", note: "Single AAV" },
              { cond: "≤ 7.0 kb", mult: "× 0.5", color: "border-amber-400/30", note: "Dual AAV" },
              { cond: "> 7.0 kb", mult: "× 0.2", color: "border-red-400/30", note: "High risk" },
            ].map((row) => (
              <div key={row.cond} className={`border ${row.color} bg-background rounded-xl p-3 text-center`}>
                <div className="font-mono text-text-primary">{row.cond}</div>
                <div className="font-mono text-accent mt-1">{row.mult}</div>
                <div className="text-text-tertiary mt-1">{row.note}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Output JSON */}
        <Section title="7. Output Format" delay={0.2}>
          <div className="bg-background rounded-xl border border-border p-5 font-mono text-xs text-text-secondary overflow-x-auto">
            <pre>{`{
  "variant": "HBB:c.20A>T (E6V)",
  "edit_score": 87,
  "optimal_strategy": "Base Editing (ABE8e)",
  "predicted_efficiency": {
    "value": 76,
    "ci_lower": 71,
    "ci_upper": 81,
    "tissue": "Hematopoietic Stem Cells"
  },
  "therapeutic_window": 12.3,
  "off_target_risk": "Low (2 sites, non-coding)",
  "clinical_success_probability": 68,
  "recommended_editor": {
    "name": "ABE8e",
    "pam": "NG",
    "delivery": "AAV6 ex vivo"
  }
}`}</pre>
          </div>
        </Section>
      </div>
    </div>
  );
}
