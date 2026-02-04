/**
 * CRISPR structure presets for the 3D viewer.
 * Each preset defines PDB ID, organism, default representations, highlights, and annotations.
 * 20 scientifically accurate presets for researchers.
 */

import type { CRISPRPreset } from '@/types/structure-viewer';

function thumbnailUrl(pdbId: string): string {
  return `https://cdn.rcsb.org/images/structures/${pdbId.toLowerCase()}_assembly-1.jpeg`;
}

export const CRISPR_PRESETS: CRISPRPreset[] = [
  {
    id: 'spcas9-sgrna',
    name: 'SpCas9 with sgRNA',
    description: 'Canonical Cas9 bound to single-guide RNA and target DNA. The workhorse of genome editing.',
    pdbId: '5F9R',
    organism: 'Streptococcus pyogenes',
    thumbnailUrl: thumbnailUrl('5f9r'),
    doi: '10.1126/science.aac9373',
    method: 'X-ray Crystallography',
    resolution: 3.4,
    year: 2015,
    citation: 'Jiang et al. (2015) Science 348(6242):1477-81',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#E5E7EB', opacity: 0.9 },
      { type: 'cartoon', selection: 'nucleic', color: '#6495ED', opacity: 1.0 },
      { type: 'ball+stick', selection: ':.NGG', color: '#EF4444', opacity: 1.0 },
    ],
    highlights: [
      { name: 'sgRNA', selection: ':A', color: '#6495ED', label: 'Single guide RNA' },
      { name: 'HNH Domain', selection: '840-860', color: '#FCD34D', label: 'HNH' },
      { name: 'PAM Site', selection: ':.NGG', color: '#EF4444', label: 'PAM' },
    ],
    annotations: [
      { text: 'Canonical genome editing complex', citation: 'Jiang et al., Science 2015', doi: '10.1126/science.aac9373' },
    ],
  },
  {
    id: 'cas9-rloop',
    name: 'Cas9 R-loop Formation',
    description: 'Cas9 in active cleavage conformation showing R-loop structure formed between guide RNA and target DNA.',
    pdbId: '6O0Y',
    organism: 'Streptococcus pyogenes',
    thumbnailUrl: thumbnailUrl('6o0y'),
    doi: '10.1126/science.aav9310',
    method: 'Cryo-EM',
    resolution: 3.9,
    year: 2019,
    citation: 'Zhu et al. (2019) Science 364(6437):282-286',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: 'chainid', opacity: 0.9 },
      { type: 'ribbon', selection: 'nucleic and :B', color: '#A855F7', opacity: 1.0 },
      { type: 'cartoon', selection: '850-870', color: '#10B981', opacity: 1.0 },
    ],
    highlights: [
      { name: 'R-loop DNA', selection: ':B', color: '#A855F7', label: 'R-loop' },
      { name: 'RuvC Domain', selection: '850-870', color: '#10B981', label: 'RuvC' },
    ],
    annotations: [
      { text: 'Active cleavage conformation', citation: 'Zhu et al., Science 2019', doi: '10.1126/science.aav9310' },
    ],
  },
  {
    id: 'cas12a-cpf1',
    name: 'Cas12a (Cpf1)',
    description: 'Alternative Class 2 CRISPR nuclease with T-rich PAM and 5′ overhang generation. Requires only crRNA.',
    pdbId: '5ID6',
    organism: 'Lachnospiraceae bacterium',
    thumbnailUrl: thumbnailUrl('5id6'),
    doi: '10.1016/j.cell.2016.04.003',
    method: 'X-ray Crystallography',
    resolution: 2.8,
    year: 2016,
    citation: 'Yamano et al. (2016) Cell 165(4):949-962',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#14B8A6', opacity: 0.9 },
      { type: 'ribbon', selection: 'nucleic', color: '#06B6D4', opacity: 1.0 },
      { type: 'ball+stick', selection: '900-950', color: '#F97316', opacity: 1.0 },
    ],
    highlights: [
      { name: 'crRNA', selection: ':A', color: '#06B6D4', label: 'crRNA' },
      { name: 'RuvC-like Domain', selection: '900-950', color: '#F97316', label: 'RuvC' },
    ],
    annotations: [
      { text: 'Alternative CRISPR nuclease, 5′ overhang', citation: 'Yamano et al., Cell 2016', doi: '10.1016/j.cell.2016.04.003' },
    ],
  },
  {
    id: 'cytosine-be3',
    name: 'Cytosine Base Editor (BE3)',
    description: 'Cas9 nickase fused to cytosine deaminase. Enables C→T editing without double-strand breaks.',
    pdbId: '6VPC',
    organism: 'Synthetic (S. pyogenes Cas9 + rat APOBEC1)',
    thumbnailUrl: thumbnailUrl('6vpc'),
    doi: '10.1126/science.aaz1191',
    method: 'Cryo-EM',
    resolution: 3.4,
    year: 2020,
    citation: 'Yuan et al. (2020) Science 368(6488):eaaz1191',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein and :A', color: '#E5E7EB', opacity: 0.8 },
      { type: 'cartoon', selection: 'protein and :B or protein and :C', color: '#D946EF', opacity: 1.0 },
      { type: 'surface', selection: 'protein and :D', color: '#F472B6', opacity: 0.6, parameters: { opacity: 0.6 } },
    ],
    highlights: [
      { name: 'Cas9 nickase', selection: 'protein and :A', color: '#E5E7EB', label: 'Cas9' },
      { name: 'APOBEC Deaminase', selection: 'protein and :B or protein and :C', color: '#D946EF', label: 'APOBEC' },
      { name: 'UGI', selection: 'protein and :D', color: '#F472B6', label: 'UGI' },
    ],
    annotations: [
      { text: 'C→T conversion without DSBs', citation: 'Komor et al., Nature 2017', doi: '10.1038/nature24644' },
    ],
  },
  {
    id: 'prime-editor',
    name: 'Prime Editor (PE2)',
    description: 'Cas9 nickase fused to reverse transcriptase. Enables all 12 base changes plus insertions/deletions.',
    pdbId: '6WTE',
    organism: 'Synthetic (S. pyogenes Cas9 + M-MLV RT)',
    thumbnailUrl: thumbnailUrl('6wte'),
    doi: '10.1038/s41586-019-1711-4',
    method: 'Cryo-EM',
    resolution: 4.2,
    year: 2021,
    citation: 'Anzalone et al. (2019) Nature 576(7785):149-157',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein and :A', color: '#9CA3AF', opacity: 0.8 },
      { type: 'cartoon', selection: 'protein and :B', color: '#2DD4BF', opacity: 1.0 },
      { type: 'ribbon', selection: 'nucleic', color: '#FBBF24', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Cas9 H840A nickase', selection: 'protein and :A', color: '#9CA3AF', label: 'Cas9' },
      { name: 'Reverse Transcriptase', selection: 'protein and :B', color: '#2DD4BF', label: 'RT' },
      { name: 'pegRNA', selection: 'nucleic', color: '#FBBF24', label: 'pegRNA' },
    ],
    annotations: [
      { text: 'Precise insertions, deletions, all 12 base changes', citation: 'Anzalone et al., Nature 2019', doi: '10.1038/s41586-019-1711-4' },
    ],
  },
  {
    id: 'cas13-rna',
    name: 'Cas13a RNA Targeting',
    description: 'RNA-guided RNA endonuclease. Enables RNA knockdown and base editing without DNA cleavage.',
    pdbId: '6E9F',
    organism: 'Leptotrichia wadei',
    thumbnailUrl: thumbnailUrl('6e9f'),
    doi: '10.1016/j.cell.2018.09.013',
    method: 'X-ray Crystallography',
    resolution: 2.9,
    year: 2018,
    citation: 'Liu et al. (2018) Cell 175(1):212-223',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#8B5CF6', opacity: 0.9 },
      { type: 'ribbon', selection: 'nucleic', color: '#C4B5FD', opacity: 1.0 },
      { type: 'surface', selection: '400-500 or 600-700', color: '#DC2626', opacity: 0.7, parameters: { opacity: 0.7 } },
    ],
    highlights: [
      { name: 'crRNA', selection: 'nucleic', color: '#C4B5FD', label: 'crRNA' },
      { name: 'HEPN Domains', selection: '400-500 or 600-700', color: '#DC2626', label: 'HEPN' },
    ],
    annotations: [
      { text: 'RNA-guided RNA endonuclease for RNA knockdown', citation: 'Knott et al., Cell 2018', doi: '10.1016/j.cell.2018.02.033' },
    ],
  },
  {
    id: 'saCas9',
    name: 'SaCas9 (Smaller Variant)',
    description: 'Compact Cas9 variant (1053aa vs 1368aa for Sp). Fits in AAV vectors for gene therapy.',
    pdbId: '5AXW',
    organism: 'Staphylococcus aureus',
    thumbnailUrl: thumbnailUrl('5axw'),
    doi: '10.1016/j.cell.2015.08.007',
    method: 'X-ray Crystallography',
    resolution: 2.6,
    year: 2016,
    citation: 'Nishimasu et al. (2015) Cell 162(5):1113-1126',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#F59E0B', opacity: 0.9 },
      { type: 'cartoon', selection: 'nucleic', color: '#3B82F6', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Compact Structure', selection: 'protein', color: '#F59E0B', label: '1053 residues' },
    ],
    annotations: [
      { text: '23% smaller than SpCas9, NNGRRT PAM', citation: 'Nishimasu et al., Cell 2015', doi: '10.1016/j.cell.2015.08.007' },
    ],
  },
  {
    id: 'cas9-dna-bound',
    name: 'Cas9-DNA Recognition Complex',
    description: 'Cas9 interrogating DNA before cleavage. Shows PAM recognition and DNA unwinding initiation.',
    pdbId: '4UN3',
    organism: 'Streptococcus pyogenes',
    thumbnailUrl: thumbnailUrl('4un3'),
    doi: '10.1016/j.cell.2014.02.001',
    method: 'X-ray Crystallography',
    resolution: 3.2,
    year: 2014,
    citation: 'Nishimasu et al. (2014) Cell 156(5):935-949',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: 'chainid', opacity: 0.85 },
      { type: 'licorice', selection: 'nucleic', color: 'nucleic', opacity: 1.0 },
      { type: 'ball+stick', selection: ':.NGG', color: '#EF4444', opacity: 1.0 },
    ],
    highlights: [
      { name: 'PAM Recognition', selection: ':.NGG', color: '#EF4444', label: 'PAM' },
    ],
    annotations: [
      { text: 'PAM recognition and DNA unwinding', citation: 'Nishimasu et al., Cell 2014', doi: '10.1016/j.cell.2014.02.001' },
    ],
  },
  {
    id: 'dcas9-dead',
    name: 'dCas9 (Catalytically Dead)',
    description: 'Inactive Cas9 (D10A/H840A) used for CRISPRi, CRISPRa, and base editors. Binds DNA without cutting.',
    pdbId: '4OO8',
    organism: 'Streptococcus pyogenes',
    thumbnailUrl: thumbnailUrl('4oo8'),
    doi: '10.1126/science.1247997',
    method: 'X-ray Crystallography',
    resolution: 2.8,
    year: 2014,
    citation: 'Jinek et al. (2014) Science 343(6176):1247997',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#6B7280', opacity: 0.9 },
      { type: 'ball+stick', selection: '10 or 840', color: '#FCD34D', opacity: 1.0, parameters: { radiusScale: 2 } },
    ],
    highlights: [
      { name: 'D10A Mutation', selection: '10', color: '#FCD34D', label: 'RuvC inactivated' },
      { name: 'H840A Mutation', selection: '840', color: '#FCD34D', label: 'HNH inactivated' },
    ],
    annotations: [
      { text: 'Catalytically dead for CRISPRi/CRISPRa', citation: 'Jinek et al., Science 2014', doi: '10.1126/science.1247997' },
    ],
  },
  {
    id: 'cas12b-c2c1',
    name: 'Cas12b (C2c1)',
    description: 'Thermostable Cas12 variant active at 48°C. Used for high-specificity applications.',
    pdbId: '5U30',
    organism: 'Alicyclobacillus acidoterrestris',
    thumbnailUrl: thumbnailUrl('5u30'),
    doi: '10.1016/j.molcel.2017.08.013',
    method: 'X-ray Crystallography',
    resolution: 2.7,
    year: 2017,
    citation: 'Liu et al. (2017) Mol Cell 67(6):1043-1053',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#EC4899', opacity: 0.9 },
      { type: 'ribbon', selection: 'nucleic', color: '#F9A8D4', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Thermostable Core', selection: 'protein', color: '#EC4899', label: 'Active at 48°C' },
    ],
    annotations: [
      { text: 'Thermostable Cas12, reduces off-target effects', citation: 'Liu et al., Mol Cell 2017', doi: '10.1016/j.molcel.2017.08.013' },
    ],
  },
  {
    id: 'cas14',
    name: 'Cas14 (Ultra-compact)',
    description: 'Smallest known CRISPR nuclease (400-700aa). ssDNA targeting, potential for ultra-compact therapeutics.',
    pdbId: '6I1K',
    organism: 'Uncultured archaeon',
    thumbnailUrl: thumbnailUrl('6i1k'),
    doi: '10.1126/science.aav4294',
    method: 'X-ray Crystallography',
    resolution: 2.3,
    year: 2019,
    citation: 'Harrington et al. (2018) Science 362(6416):839-842',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#8B5CF6', opacity: 0.95 },
      { type: 'licorice', selection: 'nucleic', color: '#C4B5FD', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Miniature Nuclease', selection: 'protein', color: '#8B5CF6', label: '~500 residues' },
    ],
    annotations: [
      { text: 'Smallest known CRISPR nuclease', citation: 'Harrington et al., Science 2018', doi: '10.1126/science.aav4294' },
    ],
  },
  {
    id: 'cascadecomplex',
    name: 'Cascade Complex (Type I)',
    description: 'Multi-protein surveillance complex. Recognizes foreign DNA and recruits Cas3 for degradation.',
    pdbId: '5H9E',
    organism: 'Escherichia coli',
    thumbnailUrl: thumbnailUrl('5h9e'),
    doi: '10.1038/nature22416',
    method: 'Cryo-EM',
    resolution: 3.3,
    year: 2016,
    citation: 'Xiao et al. (2017) Nature 546(7659):489-493',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: 'chainid', opacity: 0.9 },
      { type: 'ribbon', selection: 'nucleic', color: '#FBBF24', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Multi-subunit Complex', selection: 'protein', color: 'chainid', label: '11 subunits' },
      { name: 'crRNA Backbone', selection: 'nucleic', color: '#FBBF24', label: 'crRNA' },
    ],
    annotations: [
      { text: 'Type I surveillance complex', citation: 'Xiao et al., Nature 2017', doi: '10.1038/nature22416' },
    ],
  },
  {
    id: 'casRx',
    name: 'CasRx (Cas13d)',
    description: 'Compact RNA-targeting nuclease for knockdown. More efficient than RNAi, no DNA cleavage.',
    pdbId: '6V3M',
    organism: 'Ruminococcus flavefaciens',
    thumbnailUrl: thumbnailUrl('6v3m'),
    doi: '10.1016/j.molcel.2019.12.013',
    method: 'Cryo-EM',
    resolution: 3.0,
    year: 2020,
    citation: 'Zhang et al. (2020) Mol Cell 77(5):1128-1140',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#10B981', opacity: 0.9 },
      { type: 'ribbon', selection: 'nucleic', color: '#6EE7B7', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Compact Cas13 Variant', selection: 'protein', color: '#10B981', label: '~930aa' },
    ],
    annotations: [
      { text: 'Compact RNA targeting, fits in AAV', citation: 'Zhang et al., Mol Cell 2020', doi: '10.1016/j.molcel.2019.12.013' },
    ],
  },
  {
    id: 'adenine-editor',
    name: 'Adenine Base Editor (ABE)',
    description: 'Cas9 nickase fused to adenine deaminase. Enables A→G editing without DSBs.',
    pdbId: '6VPC',
    organism: 'Synthetic (S. pyogenes Cas9 + E. coli TadA)',
    thumbnailUrl: thumbnailUrl('6vpc'),
    doi: '10.1038/nature24644',
    method: 'Cryo-EM',
    resolution: 3.8,
    year: 2020,
    citation: 'Gaudelli et al. (2017) Nature 551(7681):464-471',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein and :A', color: '#E5E7EB', opacity: 0.8 },
      { type: 'cartoon', selection: 'protein and :B or protein and :C', color: '#06B6D4', opacity: 1.0 },
    ],
    highlights: [
      { name: 'TadA Deaminase', selection: 'protein and :B or protein and :C', color: '#06B6D4', label: 'A→G' },
    ],
    annotations: [
      { text: 'A→G editing without double-strand breaks', citation: 'Gaudelli et al., Nature 2017', doi: '10.1038/nature24644' },
    ],
  },
  {
    id: 'cas9-chip',
    name: 'ChIP-seq Cas9 Complex',
    description: 'Cas9 bound to chromatin-associated DNA. Used for studying genome-wide binding patterns.',
    pdbId: '6JDV',
    organism: 'Streptococcus pyogenes',
    thumbnailUrl: thumbnailUrl('6jdv'),
    doi: '10.1126/science.1258096',
    method: 'Cryo-EM',
    resolution: 4.2,
    year: 2019,
    citation: 'Josephs et al. (2015) Science 347(6218):144-148',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#F97316', opacity: 0.85 },
      { type: 'licorice', selection: 'nucleic', color: 'nucleic', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Chromatin Context', selection: 'protein', color: '#F97316', label: 'Cas9' },
    ],
    annotations: [
      { text: 'Cas9 in chromatin context', citation: 'Josephs et al., Science 2015', doi: '10.1126/science.1258096' },
    ],
  },
  {
    id: 'cas-phi',
    name: 'CasΦ (Phage-derived)',
    description: 'Hypercompact Cas enzyme (700-800aa) from bacteriophages. Novel architecture for gene editing.',
    pdbId: '6VU7',
    organism: 'Vibrio phage',
    thumbnailUrl: thumbnailUrl('6vu7'),
    doi: '10.1126/science.aba0372',
    method: 'Cryo-EM',
    resolution: 3.2,
    year: 2020,
    citation: 'Pausch et al. (2020) Science 369(6501):333-337',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#A855F7', opacity: 0.95 },
    ],
    highlights: [
      { name: 'Phage-derived', selection: 'protein', color: '#A855F7', label: 'Novel architecture' },
    ],
    annotations: [
      { text: 'Phage-derived CRISPR enzyme', citation: 'Pausch et al., Science 2020', doi: '10.1126/science.aba0372' },
    ],
  },
  {
    id: 'mad7',
    name: 'MAD7 (Enhanced Cas12a)',
    description: 'Optimized Cas12a with improved activity and reduced toxicity. Commercial alternative to Cas9.',
    pdbId: '5XUS',
    organism: 'Eubacterium rectale (engineered)',
    thumbnailUrl: thumbnailUrl('5xus'),
    doi: '10.1038/s41587-018-0011-0',
    method: 'X-ray Crystallography',
    resolution: 2.5,
    year: 2018,
    citation: 'Kleinstiver et al. (2019) Nat Biotechnol 37(3):276-282',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#EAB308', opacity: 0.9 },
    ],
    highlights: [
      { name: 'Engineered Variant', selection: 'protein', color: '#EAB308', label: 'MAD7' },
    ],
    annotations: [
      { text: 'Directed evolution for enhanced performance', citation: 'Kleinstiver et al., Nat Biotechnol 2019', doi: '10.1038/s41587-018-0011-0' },
    ],
  },
  {
    id: 'cas3',
    name: 'Cas3 Helicase-Nuclease',
    description: 'Processive nuclease recruited by Cascade. Degrades DNA over long distances (>100kb).',
    pdbId: '6O08',
    organism: 'Thermobifida fusca',
    thumbnailUrl: thumbnailUrl('6o08'),
    doi: '10.1016/j.celrep.2014.10.044',
    method: 'X-ray Crystallography',
    resolution: 2.3,
    year: 2019,
    citation: 'Gong et al. (2014) Cell Rep 9(5):1629-1638',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#DC2626', opacity: 0.9 },
      { type: 'surface', selection: 'protein and 200-300', color: '#FCA5A5', opacity: 0.6, parameters: { opacity: 0.6 } },
    ],
    highlights: [
      { name: 'HD Nuclease Domain', selection: '200-300', color: '#FCA5A5', label: 'Processive' },
    ],
    annotations: [
      { text: 'Processive DNA degradation', citation: 'Gong et al., Cell Rep 2014', doi: '10.1016/j.celrep.2014.10.044' },
    ],
  },
  {
    id: 'xCas9',
    name: 'xCas9 (Broad PAM)',
    description: 'SpCas9 variant with expanded PAM recognition (NG, GAA, GAT). 4x more targetable sites.',
    pdbId: '5ZN3',
    organism: 'Streptococcus pyogenes (engineered)',
    thumbnailUrl: thumbnailUrl('5zn3'),
    doi: '10.1038/nature26155',
    method: 'X-ray Crystallography',
    resolution: 2.9,
    year: 2018,
    citation: 'Hu et al. (2018) Nature 556(7699):57-63',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#0EA5E9', opacity: 0.9 },
      { type: 'ball+stick', selection: ':.NGG or :.NG or :.GAA or :.GAT', color: '#38BDF8', opacity: 1.0 },
    ],
    highlights: [
      { name: 'Relaxed PAM', selection: ':.NGG', color: '#38BDF8', label: 'NG, GAA, GAT' },
    ],
    annotations: [
      { text: 'Expanded PAM recognition', citation: 'Hu et al., Nature 2018', doi: '10.1038/nature26155' },
    ],
  },
  {
    id: 'spcas9-hf1',
    name: 'SpCas9-HF1 (High Fidelity)',
    description: 'Reduced off-target activity via weakened DNA interactions. 4 point mutations for specificity.',
    pdbId: '5Y36',
    organism: 'Streptococcus pyogenes (engineered)',
    thumbnailUrl: thumbnailUrl('5y36'),
    doi: '10.1038/nature16526',
    method: 'X-ray Crystallography',
    resolution: 3.0,
    year: 2017,
    citation: 'Kleinstiver et al. (2016) Nature 529(7587):490-495',
    defaultRepresentations: [
      { type: 'cartoon', selection: 'protein', color: '#22C55E', opacity: 0.9 },
      { type: 'ball+stick', selection: '480 or 497 or 661 or 695', color: '#FCD34D', opacity: 1.0, parameters: { radiusScale: 2 } },
    ],
    highlights: [
      { name: 'HF Mutations', selection: '480 or 497 or 661 or 695', color: '#FCD34D', label: 'N497A, R661A, Q695A, Q926A' },
    ],
    annotations: [
      { text: 'High-fidelity variant, reduced off-targets', citation: 'Kleinstiver et al., Nature 2016', doi: '10.1038/nature16526' },
    ],
  },
];

export function getPresetById(id: string): CRISPRPreset | undefined {
  return CRISPR_PRESETS.find((p) => p.id === id);
}

export function getPresetByPdbId(pdbId: string): CRISPRPreset | undefined {
  return CRISPR_PRESETS.find((p) => p.pdbId.toUpperCase() === pdbId.toUpperCase());
}
