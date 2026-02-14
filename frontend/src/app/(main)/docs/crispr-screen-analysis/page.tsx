"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Dna, ArrowLeft, BookOpen, FlaskConical, BarChart3, AlertCircle, CheckCircle, GitBranch } from "lucide-react";
import 'katex/dist/katex.min.css';
import { BlockMath, InlineMath } from 'react-katex';

function Section({ title, icon: Icon, children, delay = 0 }: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="space-y-6"
    >
      <h2 className="text-2xl font-serif text-text-primary flex items-center gap-3 pb-3 border-b border-border">
        {Icon && <Icon className="w-6 h-6 text-text-tertiary" />}
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
      {doi && <> — <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:underline">{doi}</a></>}
    </div>
  );
}

export default function CRISPRScreenDocs() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="mb-12">
        <Link href="/docs" className="flex items-center gap-2 text-text-tertiary hover:text-accent transition-colors text-sm font-serif mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Documentation
        </Link>
        <h1 className="text-5xl font-serif text-text-primary mb-2">CRISPR Screen Analysis</h1>
        <p className="text-text-secondary text-sm font-serif mt-1 mb-4">MAGeCK, BAGEL2 & DrugZ Statistical Framework</p>
        <p className="text-xl text-text-secondary font-serif leading-relaxed max-w-3xl">
          Pooled CRISPR screens identify essential genes through selective pressure. SplicR implements three
          gold-standard algorithms — MAGeCK, BAGEL2, and DrugZ — covering knockout, essentiality, and
          drug-resistance screen designs.
        </p>
      </motion.div>

      <div className="space-y-16">
        {/* Overview */}
        <Section title="1. Overview" icon={BookOpen} delay={0.05}>
          <p className="text-text-secondary font-serif leading-relaxed">
            CRISPR screens use pools of sgRNAs to knock out every gene in the genome simultaneously. After selective
            pressure (e.g., drug treatment, growth), sgRNA counts are sequenced. Genes whose sgRNAs are depleted
            are essential for survival under that condition. SplicR automates the full analysis pipeline from raw
            sequencing reads to ranked gene lists with statistical confidence estimates.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="bg-surface border border-border rounded-xl p-5">
              <h4 className="font-serif text-text-primary font-medium mb-2 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-text-tertiary" /> MAGeCK
              </h4>
              <p className="text-text-secondary text-sm font-serif">
                Negative binomial model with robust rank aggregation. Best for standard knockout screens.
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5">
              <h4 className="font-serif text-text-primary font-medium mb-2 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-text-tertiary" /> BAGEL2
              </h4>
              <p className="text-text-secondary text-sm font-serif">
                Bayesian essentiality classifier trained on reference gene sets. Outputs calibrated Bayes Factors.
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5">
              <h4 className="font-serif text-text-primary font-medium mb-2 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-text-tertiary" /> DrugZ
              </h4>
              <p className="text-text-secondary text-sm font-serif">
                Z-score normalization with empirical FDR. Designed for drug resistance and synthetic lethality screens.
              </p>
            </div>
          </div>
        </Section>

        {/* MAGeCK */}
        <Section title="2. MAGeCK Algorithm" icon={FlaskConical} delay={0.1}>
          <RefBadge
            authors="Li, W., et al."
            year="2014"
            journal="Genome Biology 15, 554"
            doi="10.1186/s13059-014-0554-4"
          />

          <div className="space-y-8 mt-6">
            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 1: Read Count Normalization</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                Raw read counts are normalized by the median ratio method to account for differences in sequencing depth
                across samples. For each sample <InlineMath math="j" />, a size factor is computed:
              </p>
              <FormulaBox caption="Size factor for sample j, where c_ij is the raw count for sgRNA i in sample j and m is the total number of samples.">
                <BlockMath math="\text{Size Factor}_j = \text{median}_i\!\left(\frac{c_{ij}}{\left(\prod_{j'=1}^{m} c_{ij'}\right)^{1/m}}\right)" />
              </FormulaBox>
              <p className="text-text-secondary text-sm font-serif">Normalized counts are then:</p>
              <FormulaBox>
                <BlockMath math="\tilde{c}_{ij} = \frac{c_{ij}}{\text{Size Factor}_j}" />
              </FormulaBox>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 2: Negative Binomial Model</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                For each sgRNA, read counts are modeled as a negative binomial distribution:
              </p>
              <FormulaBox>
                <BlockMath math="c_{ij} \sim \text{NB}(\mu_{ij},\, \alpha)" />
              </FormulaBox>
              <FormulaBox caption="β₁ = log fold change due to selection; α = dispersion estimated from control sgRNAs.">
                <BlockMath math="\log(\mu_{ij}) = \beta_0 + \beta_1 \cdot \text{Condition}_j + \log(\text{Size Factor}_j)" />
              </FormulaBox>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 3: Robust Rank Aggregation (RRA)</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                Individual sgRNA p-values are aggregated to gene-level scores using robust rank aggregation,
                which is resistant to a fraction of poorly-performing sgRNAs:
              </p>
              <FormulaBox caption="For gene g with n sgRNAs, p_k is the k-th smallest p-value and β(k, n-k+1, p_k) is the incomplete beta function.">
                <BlockMath math="\text{RRA Score}_g = \min_k \left\{ \frac{\beta(k,\, n-k+1,\, p_k)}{\binom{n}{k}} \right\}" />
              </FormulaBox>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 4: False Discovery Rate (FDR)</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                Benjamini-Hochberg correction is applied across all tested genes:
              </p>
              <FormulaBox caption="Where r_{g'} is the rank of gene g' and m is the total number of genes tested.">
                <BlockMath math="\text{FDR}_g = \min_{g' \ge g}\!\left\{ \frac{p_{g'} \cdot m}{r_{g'}} \right\}" />
              </FormulaBox>
              <div className="flex items-start gap-3 p-4 bg-surface border border-border rounded-xl mt-4">
                <CheckCircle className="w-4 h-4 text-text-tertiary mt-0.5 shrink-0" />
                <p className="text-text-secondary text-xs font-serif">
                  Default significance threshold: FDR &lt; 0.05. Adjustable to 0.01 (stringent) or 0.10 (exploratory)
                  in Tool Settings.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* BAGEL2 */}
        <Section title="3. BAGEL2 Algorithm" icon={BarChart3} delay={0.15}>
          <RefBadge
            authors="Kim, E. & Hart, T."
            year="2021"
            journal="Genome Medicine 13, 2"
            doi="10.1186/s13073-020-00809-3"
          />

          <div className="space-y-8 mt-6">
            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 1: Fold Change Calculation</h3>
              <FormulaBox caption="Default pseudo-count = 5 to stabilize low-count sgRNAs.">
                <BlockMath math="\text{FC}_{ij} = \log_2\!\left(\frac{\tilde{c}_{ij}^{\text{test}} + \text{pseudo}}{\tilde{c}_{ij}^{\text{control}} + \text{pseudo}}\right)" />
              </FormulaBox>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 2: Bayesian Classifier</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                For each gene <InlineMath math="g" />, the Bayes Factor compares how likely the observed fold changes
                are under the essential vs. non-essential model:
              </p>
              <FormulaBox caption="Distributions modeled as empirical kernel density estimates trained on CEG2 core essentials (~700 genes) and non-targeting controls.">
                <BlockMath math="\text{BF}_g = \frac{P(\text{FC}_g \mid \text{Essential})}{P(\text{FC}_g \mid \text{Non-essential})}" />
              </FormulaBox>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 3: Precision-Recall Calibration</h3>
              <FormulaBox caption="π = prior probability of essentiality, estimated from training data (~5% of genes are core essential).">
                <BlockMath math="P(\text{Essential} \mid \text{FC}_g) = \frac{\text{BF}_g \cdot \pi}{\text{BF}_g \cdot \pi + (1-\pi)}" />
              </FormulaBox>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="p-3 bg-surface border border-border rounded-lg">
                  <div className="text-xs font-serif text-text-secondary"><strong className="text-text-primary">BF &gt; 5</strong>: Essential</div>
                </div>
                <div className="p-3 bg-surface border border-border rounded-lg">
                  <div className="text-xs font-serif text-text-secondary"><strong className="text-text-primary">BF &lt; -5</strong>: Depleted</div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* DrugZ */}
        <Section title="4. DrugZ Algorithm" icon={GitBranch} delay={0.2}>
          <RefBadge
            authors="Colic, M., et al."
            year="2019"
            journal="Genome Medicine 11, 52"
            doi="10.1186/s13073-019-0665-3"
          />

          <div className="space-y-8 mt-6">
            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 1: Normalization</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                Read counts are normalized using the same median ratio method as MAGeCK.
                A pseudo-count of 0.5 is added to prevent division by zero:
              </p>
              <FormulaBox caption="NRC = normalized read count; pseudo = 0.5 (default).">
                <BlockMath math="\text{NRC}_{ij} = \frac{c_{ij} + \text{pseudo}}{\text{Size Factor}_j}" />
              </FormulaBox>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 2: Per-gene Z-score</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                For each gene <InlineMath math="g" /> with <InlineMath math="n" /> sgRNAs, the fold change
                of each guide is computed and aggregated into a gene-level Z-score:
              </p>
              <FormulaBox caption="FC_i = log₂ fold change of sgRNA i; μ and σ estimated from all non-targeting control guides.">
                <BlockMath math="Z_g = \frac{\bar{\text{FC}}_g - \mu_{\text{nt}}}{\sigma_{\text{nt}} / \sqrt{n}}" />
              </FormulaBox>
              <p className="text-text-secondary text-sm font-serif mt-3">
                Positive <InlineMath math="Z_g" /> indicates resistance (enrichment under drug); negative indicates
                sensitization (depletion under drug).
              </p>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-3">Step 3: Empirical FDR via Permutation</h3>
              <p className="text-text-secondary text-sm font-serif mb-4">
                A null distribution is constructed by randomly sampling <InlineMath math="n" /> non-targeting
                sgRNAs and computing pseudo-gene Z-scores. This is repeated 10,000 times:
              </p>
              <FormulaBox caption="FDR at threshold z: proportion of null Z-scores exceeding z, divided by proportion of observed gene Z-scores exceeding z.">
                <BlockMath math="\text{FDR}(z) = \frac{|\{Z_{\text{null}} \ge z\}| / N_{\text{perm}}}{|\{Z_g \ge z\}| / m}" />
              </FormulaBox>
              <div className="flex items-start gap-3 p-4 bg-surface border border-border rounded-xl mt-4">
                <CheckCircle className="w-4 h-4 text-text-tertiary mt-0.5 shrink-0" />
                <p className="text-text-secondary text-xs font-serif">
                  DrugZ is substantially faster than MAGeCK because it does not require negative binomial dispersion fitting.
                  Recommended for &ge;3 replicates to ensure stable Z-score estimates.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* Comparison Table */}
        <Section title="5. Algorithm Comparison" delay={0.25}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-serif border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Feature</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">MAGeCK</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">BAGEL2</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">DrugZ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Statistical model", "Negative binomial", "Bayesian (KDE)", "Z-score (normal)"],
                  ["Output metric", "P-value, FDR, LFC", "Bayes Factor", "Z-score, FDR"],
                  ["Speed", "Medium", "Fast", "Very fast"],
                  ["Best for", "General KO screens", "Essentiality screens", "Drug / synthetic lethality"],
                  ["Replicates required", "≥ 2", "≥ 2", "≥ 3 recommended"],
                  ["Training data needed", "No", "Yes (essential gene list)", "No"],
                  ["FDR approach", "Benjamini–Hochberg", "Precision–recall calibration", "Empirical (permutation)"],
                ].map(([feat, mageck, bagel, drugz]) => (
                  <tr key={feat as string} className="hover:bg-surface transition-colors">
                    <td className="py-3 px-4 text-text-primary font-medium">{feat}</td>
                    <td className="py-3 px-4 text-text-secondary text-xs">{mageck}</td>
                    <td className="py-3 px-4 text-text-secondary text-xs">{bagel}</td>
                    <td className="py-3 px-4 text-text-secondary text-xs">{drugz}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 p-5 bg-surface border border-border rounded-xl">
            <h4 className="font-serif text-text-primary font-medium mb-3">Algorithm selection guide</h4>
            <ol className="space-y-2 text-sm font-serif text-text-secondary">
              <li><span className="text-text-primary font-medium">1.</span> Drug or compound screen? → <strong>DrugZ</strong></li>
              <li><span className="text-text-primary font-medium">2.</span> Essentiality screen with known reference gene sets? → <strong>BAGEL2</strong></li>
              <li><span className="text-text-primary font-medium">3.</span> Standard knockout or CRISPRa/i screen? → <strong>MAGeCK</strong> (default)</li>
              <li><span className="text-text-primary font-medium">4.</span> Unsure? → Run all three and compare concordance across methods.</li>
            </ol>
          </div>
        </Section>

        {/* Input Formats */}
        <Section title="6. Input Data Formats" delay={0.3}>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-serif text-text-primary mb-2">Format 1: FASTQ Files (Raw Sequencing)</h3>
              <p className="text-text-secondary text-sm font-serif mb-3">
                Single-end or paired-end FASTQ. SplicR automatically trims adapters (Cutadapt), extracts sgRNA
                sequences via regex pattern matching, and aligns to the reference library.
              </p>
              <p className="text-text-secondary text-xs font-serif">
                Required: User-provided CSV reference library with columns: <code className="bg-background px-1 rounded text-accent">sgRNA_ID</code>,{" "}
                <code className="bg-background px-1 rounded text-accent">Sequence</code>,{" "}
                <code className="bg-background px-1 rounded text-accent">Gene</code>
              </p>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-2">Format 2: Count Matrix (Pre-aligned)</h3>
              <p className="text-text-secondary text-sm font-serif mb-3">CSV/TSV with the following structure:</p>
              <div className="bg-background rounded-xl border border-border p-4 font-mono text-xs text-text-secondary overflow-x-auto">
                <pre>{`sgRNA,Gene,Sample1_T0,Sample1_T14,Sample2_T0,Sample2_T14
sgRNA_001,BRCA2,1245,89,1302,102
sgRNA_002,BRCA2,1156,76,1198,91
sgRNA_003,TP53,2341,2298,2410,2380
...`}</pre>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-serif text-text-primary mb-2">Format 3: MAGeCK Summary (Re-analysis)</h3>
              <p className="text-text-secondary text-sm font-serif">
                Import existing MAGeCK output files for visualization and downstream TxScore analysis.
                Accepts <code className="bg-background px-1 rounded text-accent">.gene_summary.txt</code> and{" "}
                <code className="bg-background px-1 rounded text-accent">.sgrna_summary.txt</code> formats.
              </p>
            </div>
          </div>
        </Section>

        {/* QC Metrics */}
        <Section title="7. Quality Control Metrics" delay={0.35}>
          <p className="text-text-secondary text-sm font-serif mb-4">
            SplicR computes the following QC metrics and displays them on each analysis result page:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-serif border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Metric</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Expected Value</th>
                  <th className="text-left py-3 px-4 text-text-secondary font-medium">Interpretation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Library Coverage", "> 95% of sgRNAs at ≥ 30 reads", "Indicates adequate sequencing depth"],
                  ["Replicate Correlation", "Pearson r > 0.7", "Reproducibility between biological replicates"],
                  ["Core Essential Depletion", "Strongly negative LFC", "Screen worked; essentials are depleted"],
                  ["Non-targeting Control LFC", "Near 0", "No systematic bias in negative controls"],
                  ["Gini Index", "< 0.2 (lower = better)", "Library evenness; high Gini = skewed representation"],
                  ["Plasmid vs T0 Correlation", "r > 0.95", "Quality of library amplification"],
                ].map(([metric, expected, desc]) => (
                  <tr key={metric as string} className="hover:bg-surface transition-colors">
                    <td className="py-3 px-4 text-text-primary font-medium">{metric}</td>
                    <td className="py-3 px-4 text-accent font-mono text-xs">{expected}</td>
                    <td className="py-3 px-4 text-text-secondary text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-3 p-4 bg-surface border border-border rounded-xl mt-4">
            <AlertCircle className="w-4 h-4 text-text-tertiary mt-0.5 shrink-0" />
            <p className="text-text-secondary text-xs font-serif">
              Screens with library coverage below 80% or replicate correlation below 0.5 will display a warning
              banner. Results may be unreliable and downstream TxScore translation is flagged accordingly.
            </p>
          </div>
        </Section>

        {/* Built-in Libraries */}
        <Section title="8. Reference sgRNA Libraries" delay={0.4}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: "GeCKO v2 (Human)", guides: "123,411 sgRNAs", genes: "19,050 genes", note: "Genome-scale CRISPR knockout library" },
              { name: "Brunello v2", guides: "76,441 sgRNAs", genes: "19,114 genes", note: "Optimized genome-scale library, 4 sgRNAs/gene" },
              { name: "Brie (Human)", guides: "71,090 sgRNAs", genes: "17,661 genes", note: "High-fidelity essentiality library" },
              { name: "TKOv3", guides: "71,090 sgRNAs", genes: "18,053 genes", note: "Toronto KnockOut Library v3" },
              { name: "GeCKO v2 (Mouse)", guides: "130,209 sgRNAs", genes: "20,611 genes", note: "Mouse genome-scale knockout library" },
              { name: "Brie (Mouse)", guides: "78,637 sgRNAs", genes: "19,674 genes", note: "High-fidelity mouse essentiality library" },
            ].map((lib) => (
              <div key={lib.name} className="bg-surface border border-border rounded-xl p-5">
                <h4 className="font-serif text-text-primary font-medium mb-2">{lib.name}</h4>
                <div className="space-y-1 text-xs font-serif text-text-secondary">
                  <div>{lib.guides}</div>
                  <div>{lib.genes}</div>
                  <div className="text-text-tertiary italic">{lib.note}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-text-tertiary text-xs font-serif mt-3">
            Custom libraries can be uploaded as CSV with columns: sgRNA_ID, Sequence, Gene. Sequences are validated
            for length (18-22 nt) and unique mapping before analysis.
          </p>
        </Section>
      </div>
    </div>
  );
}
