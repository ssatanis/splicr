/**
 * TxScore Example Application
 * 
 * Demonstrates complete usage of the TxScore SDK including:
 * - Gene search and discovery
 * - Target ranking and filtering
 * - Safety assessment
 * - Druggability analysis
 * - Clinical precedent evaluation
 * - Pan-cancer target identification
 * 
 * Run: npx tsx examples/txscore-demo.ts
 */

import TxScoreClient from '../sdk/typescript/txscore-client';
import {
  classifyTVS,
  classifyLOEUF,
  classifyPLI,
  classifyStructureQuality,
  getTVSColor,
  formatTPM,
} from '../sdk/typescript/txscore-client';

// =====================================================================
// CONFIGURATION
// =====================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

const client = new TxScoreClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =====================================================================
// EXAMPLE 1: DISCOVER TOP TARGETS FOR LUNG CANCER
// =====================================================================

async function example1_topTargetsLungCancer() {
  console.log('\n🎯 EXAMPLE 1: Top 10 Therapeutic Targets for Lung Adenocarcinoma (LUAD)');
  console.log('='.repeat(80));

  const targets = await client.getTopTargets(
    'LUAD',
    {
      min_tvs: 0.7,
      min_efficacy: 0.6,
      min_safety: 0.5,
    },
    {
      limit: 10,
      order_by: 'tvs',
      order_direction: 'desc',
    }
  );

  console.log(`\nFound ${targets.length} high-confidence targets:\n`);

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const gene = await client.getGene(t.gene_id);
    const color = getTVSColor(t.tvs);
    const classification = classifyTVS(t.tvs);

    console.log(`${i + 1}. ${gene?.gene_symbol || t.gene_id} (${t.gene_id})`);
    console.log(`   TVS: ${t.tvs.toFixed(3)} [${classification.toUpperCase()}] ${color}`);
    console.log(`   ├─ Efficacy:        ${t.efficacy_score.toFixed(3)}`);
    console.log(`   ├─ Safety:          ${t.safety_score.toFixed(3)}`);
    console.log(`   ├─ Druggability:    ${t.druggability_score.toFixed(3)}`);
    console.log(`   ├─ Precedent:       ${t.precedent_score.toFixed(3)}`);
    console.log(`   └─ Stratification:  ${t.stratification_score.toFixed(3)}`);
    
    if (t.modality_recommendation) {
      const modality = t.modality_recommendation as any;
      console.log(`   Recommended Modality: ${modality.recommended_modality}`);
    }
    console.log('');
  }
}

// =====================================================================
// EXAMPLE 2: COMPREHENSIVE GENE PROFILE
// =====================================================================

async function example2_geneProfile() {
  console.log('\n🔬 EXAMPLE 2: Comprehensive Profile for TP53');
  console.log('='.repeat(80));

  const gene = await client.getGeneBySymbol('TP53');
  
  if (!gene) {
    console.log('❌ Gene TP53 not found');
    return;
  }

  console.log(`\n📊 Gene: ${gene.gene_symbol} (${gene.gene_id})`);
  console.log(`   Name: ${gene.gene_name}`);
  console.log(`   Location: ${gene.chromosome}:${gene.start_position}-${gene.end_position}`);
  console.log(`   Protein Class: ${gene.protein_class || 'N/A'}`);

  // Get DepMap data
  const depmap = await client.getDepMapData(gene.gene_id);
  const avgChronos = depmap.reduce((sum, d) => sum + d.chronos_effect, 0) / depmap.length;
  
  console.log(`\n🔬 DepMap Essentiality:`);
  console.log(`   Average Chronos: ${avgChronos.toFixed(3)}`);
  console.log(`   Essential in ${depmap.filter(d => d.chronos_effect < -0.75).length}/${depmap.length} cell lines`);

  // Get GTEx expression
  const gtex = await client.getGTExExpression(gene.gene_id);
  const highExpression = gtex.filter(g => g.median_tpm > 10);
  
  console.log(`\n🧬 GTEx Expression:`);
  console.log(`   Expressed (>10 TPM) in ${highExpression.length}/${gtex.length} tissues`);
  console.log(`   Top 5 tissues:`);
  
  gtex.slice(0, 5).forEach(t => {
    console.log(`     ${t.tissue_name.padEnd(40)} ${formatTPM(t.median_tpm).padStart(10)} TPM`);
  });

  // Get gnomAD constraint
  const constraint = await client.getGnomADConstraint(gene.gene_id);
  
  if (constraint) {
    console.log(`\n🧪 gnomAD Constraint:`);
    console.log(`   LOEUF: ${constraint.loeuf?.toFixed(3)} [${classifyLOEUF(constraint.loeuf || 1)}]`);
    console.log(`   pLI:   ${constraint.pli?.toFixed(3)} [${classifyPLI(constraint.pli || 0)}]`);
    console.log(`   Missense Z: ${constraint.mis_z?.toFixed(2)}`);
  }

  // Get AlphaFold structure
  const structure = await client.getAlphaFoldStructure(gene.gene_id);
  
  if (structure) {
    console.log(`\n🏗️  AlphaFold Structure:`);
    console.log(`   Mean pLDDT: ${structure.mean_plddt.toFixed(1)} [${classifyStructureQuality(structure.mean_plddt)}]`);
    console.log(`   Druggable Pockets: ${structure.num_druggable_pockets || 0}`);
    console.log(`   Disorder Fraction: ${((structure.disorder_fraction || 0) * 100).toFixed(1)}%`);
  }

  // Get ClinVar variants
  const clinvar = await client.getClinVarVariants(gene.gene_id);
  const pathogenic = clinvar.filter(v => 
    ['Pathogenic', 'Likely pathogenic'].includes(v.clinical_significance)
  );
  
  console.log(`\n🧬 ClinVar Variants:`);
  console.log(`   Total: ${clinvar.length}`);
  console.log(`   Pathogenic: ${pathogenic.length}`);

  // Get drug interactions
  const drugs = await client.getDrugInteractions(gene.gene_id);
  const approved = drugs.filter(d => d.approval_status === 'approved');
  
  console.log(`\n💊 Drug Interactions:`);
  console.log(`   Total: ${drugs.length}`);
  console.log(`   Approved: ${approved.length}`);
  
  if (approved.length > 0) {
    console.log(`   Approved Drugs:`);
    approved.slice(0, 5).forEach(d => {
      console.log(`     - ${d.drug_name} (${d.interaction_type})`);
    });
  }

  // Get clinical trials
  const trials = await client.getClinicalTrials(gene.gene_id);
  const advanced = trials.filter(t => 
    ['Phase 2', 'Phase 3', 'Phase 4'].includes(t.phase || '')
  );
  
  console.log(`\n🏥 Clinical Trials:`);
  console.log(`   Total: ${trials.length}`);
  console.log(`   Advanced (Phase 2+): ${advanced.length}`);

  // Get TxScores across cancer types
  const txscores = await client.getTxScoresForGene(gene.gene_id);
  
  console.log(`\n🎯 TxScores Across Cancer Types:`);
  console.log(`   Computed for ${txscores.length} cancer types`);
  
  const topCancers = txscores.slice(0, 5);
  topCancers.forEach(t => {
    console.log(`   ${t.cancer_type.padEnd(10)} TVS: ${t.tvs.toFixed(3)}`);
  });
}

// =====================================================================
// EXAMPLE 3: PAN-CANCER TARGETS
// =====================================================================

async function example3_panCancerTargets() {
  console.log('\n🌐 EXAMPLE 3: Pan-Cancer Targets (High TVS in ≥5 Cancer Types)');
  console.log('='.repeat(80));

  const panCancerTargets = await client.getPanCancerTargets(5, 0.7);

  console.log(`\nFound ${panCancerTargets.length} pan-cancer targets:\n`);

  for (let i = 0; i < Math.min(10, panCancerTargets.length); i++) {
    const target = panCancerTargets[i];
    const gene = await client.getGene(target.gene_id);

    console.log(`${i + 1}. ${gene?.gene_symbol || target.gene_id}`);
    console.log(`   Average TVS: ${target.avg_tvs.toFixed(3)}`);
    console.log(`   Cancer Types (${target.num_cancer_types}): ${target.cancer_types.join(', ')}`);
    console.log('');
  }
}

// =====================================================================
// EXAMPLE 4: UNDRUGGED KINASES
// =====================================================================

async function example4_undruggedKinases() {
  console.log('\n💎 EXAMPLE 4: Undrugged Kinases with High Druggability');
  console.log('='.repeat(80));

  const kinases = await client.getGenesByProteinClass('kinase');
  
  console.log(`\nAnalyzing ${kinases.length} kinases...\n`);

  const analysis = await Promise.all(
    kinases.map(async (gene) => {
      const drugs = await client.getApprovedDrugs(gene.gene_id);
      const structure = await client.getAlphaFoldStructure(gene.gene_id);
      const txscores = await client.getTxScoresForGene(gene.gene_id);
      
      return {
        gene,
        hasDrugs: drugs.length > 0,
        numDrugs: drugs.length,
        druggablePockets: structure?.num_druggable_pockets || 0,
        structureQuality: structure?.mean_plddt || 0,
        maxTVS: Math.max(...txscores.map(t => t.tvs), 0),
        bestCancerType: txscores.length > 0 
          ? txscores.sort((a, b) => b.tvs - a.tvs)[0].cancer_type 
          : 'N/A',
      };
    })
  );

  const undruggedKinases = analysis
    .filter(k => !k.hasDrugs && k.druggablePockets >= 2 && k.maxTVS > 0.6 && k.structureQuality > 70)
    .sort((a, b) => b.maxTVS - a.maxTVS);

  console.log(`Found ${undruggedKinases.length} undrugged kinases with high potential:\n`);

  undruggedKinases.slice(0, 10).forEach((k, i) => {
    console.log(`${i + 1}. ${k.gene.gene_symbol}`);
    console.log(`   Max TVS: ${k.maxTVS.toFixed(3)} (in ${k.bestCancerType})`);
    console.log(`   Druggable Pockets: ${k.druggablePockets}`);
    console.log(`   Structure Quality (pLDDT): ${k.structureQuality.toFixed(1)}`);
    console.log('');
  });
}

// =====================================================================
// EXAMPLE 5: SAFETY ASSESSMENT
// =====================================================================

async function example5_safetyAssessment() {
  console.log('\n🛡️  EXAMPLE 5: Tissue-Specific Safety Assessment');
  console.log('='.repeat(80));

  const geneSymbol = 'MYC';
  const gene = await client.getGeneBySymbol(geneSymbol);

  if (!gene) {
    console.log(`❌ Gene ${geneSymbol} not found`);
    return;
  }

  console.log(`\nSafety Assessment for ${gene.gene_symbol}:\n`);

  const gtex = await client.getGTExExpression(gene.gene_id);
  const constraint = await client.getGnomADConstraint(gene.gene_id);

  console.log(`Constraint Metrics:`);
  console.log(`  LOEUF: ${constraint?.loeuf?.toFixed(3)} [${classifyLOEUF(constraint?.loeuf || 1)}]`);
  console.log(`  pLI:   ${constraint?.pli?.toFixed(3)} [${classifyPLI(constraint?.pli || 0)}]`);

  const criticalTissues = [
    'Heart - Left Ventricle',
    'Brain - Cortex',
    'Liver',
    'Kidney - Cortex',
    'Pancreas',
  ];

  console.log(`\nExpression in Critical Tissues:`);
  console.log('  Tissue                                    TPM      Risk');
  console.log('  ' + '-'.repeat(70));

  criticalTissues.forEach(tissueName => {
    const tissue = gtex.find(t => t.tissue_name === tissueName);
    const tpm = tissue?.median_tpm || 0;
    
    // Simple risk calculation
    let risk = 'LOW';
    if (tpm > 10 && constraint?.loeuf && constraint.loeuf < 0.6) {
      risk = 'HIGH';
    } else if (tpm > 10 || (constraint?.loeuf && constraint.loeuf < 0.6)) {
      risk = 'MEDIUM';
    }

    const riskSymbol = risk === 'HIGH' ? '⚠️' : risk === 'MEDIUM' ? '⚡' : '✅';
    
    console.log(`  ${tissueName.padEnd(40)} ${formatTPM(tpm).padStart(8)}  ${riskSymbol} ${risk}`);
  });

  console.log(`\nRisk Assessment:`);
  console.log(`  ✅ LOW    - Safe for targeting`);
  console.log(`  ⚡ MEDIUM - Monitor for toxicity`);
  console.log(`  ⚠️  HIGH   - Significant toxicity risk`);
}

// =====================================================================
// EXAMPLE 6: CUSTOM RANKING
// =====================================================================

async function example6_customRanking() {
  console.log('\n⚖️  EXAMPLE 6: Custom Ranking (Prioritize Safety & Druggability)');
  console.log('='.repeat(80));

  // Custom weights: Emphasize safety and druggability
  const safeTargets = await client.rankTargets('BRCA', {
    efficacy: 0.20,
    safety: 0.40,        // 2× standard weight
    druggability: 0.30,  // 1.5× standard weight
    precedent: 0.05,
    stratification: 0.05,
  }, 20);

  console.log(`\nTop 10 safe & druggable targets for breast cancer:\n`);

  for (let i = 0; i < Math.min(10, safeTargets.length); i++) {
    const t = safeTargets[i];
    const gene = await client.getGene(t.gene_id);

    console.log(`${i + 1}. ${gene?.gene_symbol || t.gene_id}`);
    console.log(`   Custom Score: ${(t as any).custom_score?.toFixed(3)}`);
    console.log(`   Safety:       ${t.safety_score.toFixed(3)} ⭐`);
    console.log(`   Druggability: ${t.druggability_score.toFixed(3)} ⭐`);
    console.log(`   Efficacy:     ${t.efficacy_score.toFixed(3)}`);
    console.log('');
  }
}

// =====================================================================
// EXAMPLE 7: COMPARE GENES
// =====================================================================

async function example7_compareGenes() {
  console.log('\n🔄 EXAMPLE 7: Compare BRCA1 vs BRCA2');
  console.log('='.repeat(80));

  const brca1 = await client.getGeneBySymbol('BRCA1');
  const brca2 = await client.getGeneBySymbol('BRCA2');

  if (!brca1 || !brca2) {
    console.log('❌ BRCA genes not found');
    return;
  }

  const comparison = await client.compareGenes(
    [brca1.gene_id, brca2.gene_id],
    'BRCA'
  );

  console.log('\nComparison:\n');
  console.log('Metric                BRCA1           BRCA2');
  console.log('-'.repeat(60));

  const metrics = [
    { name: 'TVS', key: 'tvs' },
    { name: 'Efficacy', key: 'efficacy_score' },
    { name: 'Safety', key: 'safety_score' },
    { name: 'Druggability', key: 'druggability_score' },
    { name: 'Precedent', key: 'precedent_score' },
  ];

  metrics.forEach(({ name, key }) => {
    const val1 = comparison[0].txscores[0]?.[key as keyof typeof comparison[0]['txscores'][0]];
    const val2 = comparison[1].txscores[0]?.[key as keyof typeof comparison[1]['txscores'][0]];
    
    const str1 = typeof val1 === 'number' ? val1.toFixed(3) : 'N/A';
    const str2 = typeof val2 === 'number' ? val2.toFixed(3) : 'N/A';
    
    console.log(`${name.padEnd(20)} ${str1.padStart(10)}      ${str2.padStart(10)}`);
  });

  console.log('');
  console.log('Approved Drugs       ' + 
    `${comparison[0].drugs.approved.length.toString().padStart(10)}      ${comparison[1].drugs.approved.length.toString().padStart(10)}`);
  console.log('Clinical Trials      ' + 
    `${comparison[0].trials.all.length.toString().padStart(10)}      ${comparison[1].trials.all.length.toString().padStart(10)}`);
  console.log('Pathogenic Variants  ' + 
    `${comparison[0].clinvar.pathogenic.length.toString().padStart(10)}      ${comparison[1].clinvar.pathogenic.length.toString().padStart(10)}`);
}

// =====================================================================
// MAIN FUNCTION
// =====================================================================

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🎯 TxScore SDK - Comprehensive Examples');
  console.log('='.repeat(80));

  try {
    await example1_topTargetsLungCancer();
    await example2_geneProfile();
    await example3_panCancerTargets();
    await example4_undruggedKinases();
    await example5_safetyAssessment();
    await example6_customRanking();
    await example7_compareGenes();

    console.log('\n' + '='.repeat(80));
    console.log('✅ All examples completed successfully!');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export {
  example1_topTargetsLungCancer,
  example2_geneProfile,
  example3_panCancerTargets,
  example4_undruggedKinases,
  example5_safetyAssessment,
  example6_customRanking,
  example7_compareGenes,
};
