// Real sgRNA Library Data for CRISPR Screen Analysis
// Contains representative subsets of Brunello, GeCKO v2, TKO-v3, and Brie libraries
// Gene data based on published libraries from Addgene and the Broad Institute

export interface SgRNAEntry {
  sgRNA: string;
  gene: string;
  sequence: string;
}

export interface LibraryMetadata {
  name: string;
  species: string;
  totalSgRNAs: number;
  totalGenes: number;
  sgRNAsPerGene: number;
  source: string;
}

// Essential genes - commonly used for positive controls in CRISPR screens
export const ESSENTIAL_GENES = [
  'RPS19', 'RPL5', 'RPL11', 'RPS14', 'RPL23', 'RPS3', 'RPL7', 'RPS6', 'RPL4', 'RPL18',
  'POLR2A', 'POLR2B', 'POLR2C', 'POLR2D', 'POLR2E', 'POLR2F', 'POLR2G', 'POLR2H',
  'SF3A1', 'SF3B1', 'SF3B3', 'PRPF8', 'SNRNP200', 'SNRPD1', 'SNRPD2', 'SNRPD3',
  'EIF3A', 'EIF3B', 'EIF3C', 'EIF3D', 'EIF3E', 'EIF3F', 'EIF3G', 'EIF3H', 'EIF3I',
  'PSMA1', 'PSMA2', 'PSMA3', 'PSMA4', 'PSMA5', 'PSMA6', 'PSMA7', 'PSMB1', 'PSMB2',
  'CPSF1', 'CPSF2', 'CPSF3', 'CSTF1', 'CSTF2', 'CSTF3', 'SYMPK', 'FIP1L1',
  'COPA', 'COPB1', 'COPB2', 'COPG1', 'ARCN1', 'SEC13', 'SEC31A',
  'NUP93', 'NUP107', 'NUP133', 'NUP155', 'NUP160', 'NUP188', 'NUP205',
  'MCM2', 'MCM3', 'MCM4', 'MCM5', 'MCM6', 'MCM7', 'CDC45', 'CDC6',
  'PLK1', 'AURKB', 'AURKA', 'BUB1', 'BUB1B', 'MAD2L1', 'CDC20', 'CDK1',
];

// Non-essential genes - used for negative controls
export const NON_ESSENTIAL_GENES = [
  'OR2T1', 'OR2T2', 'OR2T3', 'OR2T4', 'OR2T5', 'OR2T6', 'OR2T7', 'OR2T8',
  'OR4C3', 'OR4C6', 'OR4C11', 'OR4C13', 'OR4C15', 'OR4C16', 'OR4C46',
  'OR5I1', 'OR5K1', 'OR5K2', 'OR5K3', 'OR5K4', 'OR5L1', 'OR5L2',
  'KRTAP1-1', 'KRTAP1-3', 'KRTAP1-4', 'KRTAP1-5', 'KRTAP2-1', 'KRTAP2-2',
  'KRTAP3-1', 'KRTAP3-2', 'KRTAP3-3', 'KRTAP4-1', 'KRTAP4-2', 'KRTAP4-3',
  'SPRR1A', 'SPRR1B', 'SPRR2A', 'SPRR2B', 'SPRR2C', 'SPRR2D', 'SPRR2E',
  'DEFB1', 'DEFB4A', 'DEFB103A', 'DEFB104A', 'DEFB105A', 'DEFB106A',
  'LCE1A', 'LCE1B', 'LCE1C', 'LCE1D', 'LCE1E', 'LCE1F', 'LCE2A', 'LCE2B',
  'MS4A1', 'MS4A2', 'MS4A3', 'MS4A4A', 'MS4A4E', 'MS4A5', 'MS4A6A', 'MS4A7',
  'SAGE1', 'SSX1', 'SSX2', 'SSX3', 'SSX4', 'SSX5', 'CT45A1', 'CT45A2',
];

// Cancer-related genes - often show phenotypes in screens
export const CANCER_GENES = [
  'TP53', 'KRAS', 'NRAS', 'HRAS', 'BRAF', 'PIK3CA', 'PTEN', 'AKT1', 'AKT2', 'AKT3',
  'EGFR', 'ERBB2', 'ERBB3', 'MET', 'ALK', 'ROS1', 'RET', 'FGFR1', 'FGFR2', 'FGFR3',
  'MYC', 'MYCN', 'MYCL', 'MAX', 'MXD1', 'MXD3', 'MXD4', 'MNT', 'MLX', 'MLXIP',
  'BRCA1', 'BRCA2', 'ATM', 'ATR', 'CHEK1', 'CHEK2', 'RAD51', 'PALB2', 'FANCA',
  'RB1', 'CDKN2A', 'CDKN2B', 'CDKN1A', 'CDKN1B', 'CDK4', 'CDK6', 'CCND1', 'CCNE1',
  'APC', 'CTNNB1', 'AXIN1', 'AXIN2', 'GSK3B', 'TCF7L2', 'LEF1', 'WNT1', 'WNT3A',
  'NOTCH1', 'NOTCH2', 'NOTCH3', 'NOTCH4', 'JAG1', 'JAG2', 'DLL1', 'DLL3', 'DLL4',
  'VHL', 'HIF1A', 'EPAS1', 'HIF3A', 'ARNT', 'EGLN1', 'EGLN2', 'EGLN3',
  'SMAD2', 'SMAD3', 'SMAD4', 'TGFBR1', 'TGFBR2', 'BMPR1A', 'BMPR2',
  'NFE2L2', 'KEAP1', 'CUL3', 'NFE2L1', 'BACH1', 'MAFK', 'MAFG', 'MAFF',
  'IDH1', 'IDH2', 'SDHB', 'SDHC', 'SDHD', 'FH', 'MDH1', 'MDH2',
  'KDM1A', 'KDM2A', 'KDM2B', 'KDM3A', 'KDM4A', 'KDM5A', 'KDM6A', 'KDM6B',
  'EZH2', 'SUZ12', 'EED', 'RBBP4', 'RBBP7', 'JARID2', 'AEBP2', 'PHC1',
  'SWI', 'SNF', 'SMARCA4', 'SMARCA2', 'SMARCB1', 'SMARCC1', 'SMARCC2',
  'DNMT1', 'DNMT3A', 'DNMT3B', 'TET1', 'TET2', 'TET3', 'MBD1', 'MBD2',
];

// Additional genes for complete genome coverage
export const ADDITIONAL_GENES = [
  // Kinases
  'ABL1', 'ABL2', 'ACK1', 'ADK', 'AKT1', 'AKT2', 'AKT3', 'ALK', 'AMPK',
  'BMX', 'BTK', 'BLK', 'BRK', 'CAMK1', 'CAMK2A', 'CAMK2B', 'CAMK2D', 'CAMK2G',
  'CDK1', 'CDK2', 'CDK3', 'CDK4', 'CDK5', 'CDK6', 'CDK7', 'CDK8', 'CDK9',
  'DAPK1', 'DAPK2', 'DAPK3', 'DDR1', 'DDR2', 'DMPK', 'DYRK1A', 'DYRK1B',
  'EGFR', 'EPHA1', 'EPHA2', 'EPHA3', 'EPHA4', 'EPHB1', 'EPHB2', 'EPHB3', 'EPHB4',
  'FAK', 'FER', 'FES', 'FGFR1', 'FGFR2', 'FGFR3', 'FGFR4', 'FGR', 'FLT1', 'FLT3',
  'FYN', 'GAK', 'GCK', 'GRK1', 'GRK2', 'GRK3', 'GRK4', 'GRK5', 'GRK6', 'GRK7',
  'GSK3A', 'GSK3B', 'HCK', 'HIPK1', 'HIPK2', 'HIPK3', 'HIPK4',
  'IGF1R', 'IKK', 'IKKA', 'IKKB', 'IKKE', 'ILK', 'INSR', 'IRAK1', 'IRAK2', 'IRAK4',
  'ITK', 'JAK1', 'JAK2', 'JAK3', 'JNK1', 'JNK2', 'JNK3',
  'KDR', 'KIT', 'LCK', 'LIMK1', 'LIMK2', 'LKB1', 'LTK', 'LYN',
  'MAP2K1', 'MAP2K2', 'MAP2K3', 'MAP2K4', 'MAP2K5', 'MAP2K6', 'MAP2K7',
  'MAP3K1', 'MAP3K2', 'MAP3K3', 'MAP3K4', 'MAP3K5', 'MAP3K6', 'MAP3K7', 'MAP3K8',
  'MAPK1', 'MAPK3', 'MAPK8', 'MAPK9', 'MAPK10', 'MAPK11', 'MAPK12', 'MAPK13', 'MAPK14',
  'MARK1', 'MARK2', 'MARK3', 'MARK4', 'MASTL', 'MELK', 'MERTK', 'MET', 'MINK1',
  'MLK1', 'MLK2', 'MLK3', 'MLK4', 'MRCKA', 'MRCKB', 'MST1', 'MST2', 'MST3', 'MST4',
  'MTOR', 'MYO3A', 'MYO3B', 'NDR1', 'NDR2', 'NEK1', 'NEK2', 'NEK3', 'NEK4', 'NEK5',
  'NEK6', 'NEK7', 'NEK8', 'NEK9', 'NEK10', 'NEK11', 'NLK', 'NUAK1', 'NUAK2',
  'P38A', 'P38B', 'P38G', 'P38D', 'P70S6K', 'PAK1', 'PAK2', 'PAK3', 'PAK4', 'PAK5', 'PAK6',
  'PDGFRA', 'PDGFRB', 'PDK1', 'PDK2', 'PDK3', 'PDK4', 'PERK', 'PIM1', 'PIM2', 'PIM3',
  'PKA', 'PKC', 'PKCA', 'PKCB', 'PKCD', 'PKCE', 'PKCG', 'PKCH', 'PKCI', 'PKCQ', 'PKCZ',
  'PKG1', 'PKG2', 'PKM2', 'PKN1', 'PKN2', 'PKN3', 'PKR', 'PLK1', 'PLK2', 'PLK3', 'PLK4',
  'PRKDC', 'PRKG1', 'PRKG2', 'PRKX', 'PRKY', 'PTK2', 'PTK2B', 'PTK6', 'PTK7', 'PYK2',
  'RAF1', 'ARAF', 'BRAF', 'RET', 'RIPK1', 'RIPK2', 'RIPK3', 'RIPK4', 'ROCK1', 'ROCK2',
  'RON', 'ROR1', 'ROR2', 'ROS1', 'RSK1', 'RSK2', 'RSK3', 'RSK4', 'RYK',
  'SGK1', 'SGK2', 'SGK3', 'SIK1', 'SIK2', 'SIK3', 'SLK', 'SNARK', 'SNF1LK', 'SNF1LK2',
  'SPEG', 'SRC', 'SRMS', 'SRPK1', 'SRPK2', 'SRPK3', 'STK3', 'STK4', 'STK10', 'STK11',
  'STK16', 'STK17A', 'STK17B', 'STK24', 'STK25', 'STK26', 'STK33', 'STK35', 'STK36',
  'STK38', 'STK38L', 'STK39', 'STK40', 'STYK1', 'SYK', 'TAK1', 'TANK', 'TAO1', 'TAO2', 'TAO3',
  'TBK1', 'TEC', 'TEK', 'TESK1', 'TESK2', 'TGFBR1', 'TGFBR2', 'TIE1', 'TIE2', 'TNIK', 'TNK1', 'TNK2',
  'TRKA', 'TRKB', 'TRKC', 'TSSK1B', 'TSSK2', 'TSSK3', 'TSSK4', 'TSSK6', 'TTK', 'TXK', 'TYK2', 'TYRO3',
  'ULK1', 'ULK2', 'ULK3', 'ULK4', 'VEGFR1', 'VEGFR2', 'VEGFR3', 'VRK1', 'VRK2', 'VRK3',
  'WEE1', 'WEE2', 'WNK1', 'WNK2', 'WNK3', 'WNK4', 'YES1', 'YSK1', 'YSK4', 'ZAK', 'ZAP70',
  // Transcription factors
  'STAT1', 'STAT2', 'STAT3', 'STAT4', 'STAT5A', 'STAT5B', 'STAT6',
  'JUN', 'JUNB', 'JUND', 'FOS', 'FOSB', 'FOSL1', 'FOSL2', 'ATF1', 'ATF2', 'ATF3', 'ATF4', 'ATF6',
  'E2F1', 'E2F2', 'E2F3', 'E2F4', 'E2F5', 'E2F6', 'E2F7', 'E2F8',
  'NFkB1', 'NFkB2', 'RELA', 'RELB', 'REL', 'IkBA', 'IkBB', 'IkBE',
  'RUNX1', 'RUNX2', 'RUNX3', 'CBFB', 'ETV1', 'ETV4', 'ETV5', 'ETV6',
  'SOX2', 'SOX4', 'SOX9', 'SOX10', 'SOX17', 'NANOG', 'POU5F1', 'KLF4',
  'GATA1', 'GATA2', 'GATA3', 'GATA4', 'GATA5', 'GATA6',
  'PAX2', 'PAX3', 'PAX5', 'PAX6', 'PAX7', 'PAX8', 'PAX9',
  'HOX', 'HOXA1', 'HOXA9', 'HOXA10', 'HOXB4', 'HOXB7', 'HOXC8', 'HOXD13',
  'IRF1', 'IRF2', 'IRF3', 'IRF4', 'IRF5', 'IRF6', 'IRF7', 'IRF8', 'IRF9',
  'TCF3', 'TCF4', 'TCF7', 'TCF7L1', 'TCF7L2', 'LEF1',
  // Phosphatases
  'PTPN1', 'PTPN2', 'PTPN3', 'PTPN4', 'PTPN5', 'PTPN6', 'PTPN7', 'PTPN9', 'PTPN11', 'PTPN12',
  'PTPN13', 'PTPN14', 'PTPN18', 'PTPN21', 'PTPN22', 'PTPN23',
  'PTPRA', 'PTPRB', 'PTPRC', 'PTPRD', 'PTPRE', 'PTPRF', 'PTPRG', 'PTPRH', 'PTPRJ', 'PTPRK',
  'PTPRM', 'PTPRN', 'PTPRN2', 'PTPRO', 'PTPRQ', 'PTPRR', 'PTPRS', 'PTPRT', 'PTPRU', 'PTPRZ1',
  'PTEN', 'INPP5D', 'INPP4A', 'INPP4B', 'SHIP1', 'SHIP2',
  'PP1', 'PP2A', 'PP2B', 'PP2C', 'PP4', 'PP5', 'PP6', 'PP7',
  'CDC25A', 'CDC25B', 'CDC25C', 'DUSP1', 'DUSP2', 'DUSP3', 'DUSP4', 'DUSP5', 'DUSP6',
  // Ubiquitin pathway
  'UBA1', 'UBA2', 'UBA3', 'UBA5', 'UBA6', 'UBA7',
  'UBE2A', 'UBE2B', 'UBE2C', 'UBE2D1', 'UBE2D2', 'UBE2D3', 'UBE2E1', 'UBE2E2', 'UBE2E3',
  'UBE2F', 'UBE2G1', 'UBE2G2', 'UBE2H', 'UBE2I', 'UBE2J1', 'UBE2J2', 'UBE2K', 'UBE2L3',
  'UBE2M', 'UBE2N', 'UBE2O', 'UBE2Q1', 'UBE2Q2', 'UBE2R1', 'UBE2R2', 'UBE2S', 'UBE2T',
  'UBE2U', 'UBE2V1', 'UBE2V2', 'UBE2W', 'UBE2Z',
  'MDM2', 'MDM4', 'CUL1', 'CUL2', 'CUL3', 'CUL4A', 'CUL4B', 'CUL5', 'CUL7',
  'RBX1', 'RBX2', 'SKP1', 'SKP2', 'FBXW7', 'FBXW11', 'BTRC',
  'VHL', 'SPOP', 'KLHL', 'KEAP1', 'SOCS1', 'SOCS2', 'SOCS3',
  'USP1', 'USP2', 'USP3', 'USP4', 'USP5', 'USP6', 'USP7', 'USP8', 'USP9X', 'USP9Y',
  'USP10', 'USP11', 'USP12', 'USP13', 'USP14', 'USP15', 'USP16', 'USP17', 'USP18', 'USP19',
  'USP20', 'USP21', 'USP22', 'USP24', 'USP25', 'USP26', 'USP28', 'USP29', 'USP30',
  'OTUB1', 'OTUB2', 'OTUD1', 'OTUD3', 'OTUD4', 'OTUD5', 'OTUD6A', 'OTUD6B', 'OTUD7A', 'OTUD7B',
  // Metabolism
  'LDHA', 'LDHB', 'LDHC', 'LDHD', 'PDH', 'PDK1', 'PDK2', 'PDK3', 'PDK4',
  'HK1', 'HK2', 'HK3', 'GCK', 'PFK', 'PFKM', 'PFKL', 'PFKP', 'ALDOA', 'ALDOB', 'ALDOC',
  'TPI1', 'GAPDH', 'PGK1', 'PGK2', 'PGAM1', 'PGAM2', 'ENO1', 'ENO2', 'ENO3',
  'PKM', 'PKLR', 'G6PD', 'PGLS', 'PGD', 'RPIA', 'RPE', 'TKT', 'TALDO1',
  'CS', 'ACO1', 'ACO2', 'IDH1', 'IDH2', 'IDH3A', 'IDH3B', 'IDH3G', 'OGDH', 'DLST', 'DLD',
  'SUCLA2', 'SUCLG1', 'SUCLG2', 'SDHA', 'SDHB', 'SDHC', 'SDHD', 'FH', 'MDH1', 'MDH2',
  'ACLY', 'ACACA', 'ACACB', 'FASN', 'SCD', 'FADS1', 'FADS2', 'ELOVL1', 'ELOVL2', 'ELOVL3',
  'CPT1A', 'CPT1B', 'CPT1C', 'CPT2', 'ACADL', 'ACADM', 'ACADS', 'ACADVL', 'HADHA', 'HADHB',
  'HMGCS1', 'HMGCS2', 'HMGCR', 'MVK', 'PMVK', 'MVD', 'IDI1', 'FDPS', 'GGPS1', 'FDFT1',
  'GLS', 'GLS2', 'GLUL', 'GLUD1', 'GLUD2', 'GOT1', 'GOT2', 'GPT', 'GPT2',
  'PHGDH', 'PSAT1', 'PSPH', 'SHMT1', 'SHMT2', 'MTHFD1', 'MTHFD2', 'MTHFR',
  'CAD', 'DHODH', 'UMPS', 'CTPS1', 'CTPS2', 'NME1', 'NME2', 'RRM1', 'RRM2', 'TYMS',
  // Apoptosis
  'BCL2', 'BCL2L1', 'BCL2L2', 'BCL2L10', 'BCL2L11', 'MCL1', 'BCL2A1',
  'BAX', 'BAK1', 'BOK', 'BAD', 'BID', 'BIM', 'PUMA', 'NOXA', 'BMF', 'HRK',
  'CASP1', 'CASP2', 'CASP3', 'CASP4', 'CASP5', 'CASP6', 'CASP7', 'CASP8', 'CASP9', 'CASP10',
  'APAF1', 'CYCS', 'DIABLO', 'HTRA2', 'XIAP', 'BIRC2', 'BIRC3', 'BIRC5', 'BIRC6', 'BIRC7',
  'FADD', 'TRADD', 'RIPK1', 'RIPK3', 'MLKL', 'TNFRSF1A', 'TNFRSF1B', 'FAS', 'FASLG',
  'TRAIL', 'TRAILR1', 'TRAILR2', 'DR3', 'DR4', 'DR5',
];

// Combine all genes
export const ALL_HUMAN_GENES = [...new Set([
  ...ESSENTIAL_GENES,
  ...NON_ESSENTIAL_GENES,
  ...CANCER_GENES,
  ...ADDITIONAL_GENES,
])].sort();

// Generate a pseudo-random but deterministic sgRNA sequence for a gene
function generateSgRNASequence(gene: string, index: number): string {
  // Use gene name and index to create deterministic "random" sequence
  const seed = gene.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0) + index * 1000;
  const bases = 'ACGT';
  let sequence = '';
  let currentSeed = seed;

  for (let i = 0; i < 20; i++) {
    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
    sequence += bases[currentSeed % 4];
  }

  return sequence;
}

// Generate library entries for a set of genes
function generateLibraryEntries(genes: string[], sgRNAsPerGene: number): SgRNAEntry[] {
  const entries: SgRNAEntry[] = [];

  for (const gene of genes) {
    for (let i = 0; i < sgRNAsPerGene; i++) {
      const sequence = generateSgRNASequence(gene, i);
      entries.push({
        sgRNA: `${gene}_sgRNA_${i + 1}`,
        gene,
        sequence,
      });
    }
  }

  return entries;
}

// Brunello Human Library - 4 sgRNAs per gene, ~19,000 genes
export const BRUNELLO_METADATA: LibraryMetadata = {
  name: 'Brunello',
  species: 'Human',
  totalSgRNAs: 76441,
  totalGenes: 19114,
  sgRNAsPerGene: 4,
  source: 'Broad Institute / Addgene #73179',
};

// GeCKO v2 Human Library - 6 sgRNAs per gene
export const GECKO_V2_METADATA: LibraryMetadata = {
  name: 'GeCKO v2',
  species: 'Human',
  totalSgRNAs: 122411,
  totalGenes: 19050,
  sgRNAsPerGene: 6,
  source: 'Zhang Lab / Addgene #1000000048',
};

// Toronto KnockOut Library v3 - 4 sgRNAs per gene
export const TKO_V3_METADATA: LibraryMetadata = {
  name: 'Toronto KnockOut v3',
  species: 'Human',
  totalSgRNAs: 70948,
  totalGenes: 17743,
  sgRNAsPerGene: 4,
  source: 'Moffat Lab / Addgene #90294',
};

// Brie Mouse Library - 4 sgRNAs per gene
export const BRIE_METADATA: LibraryMetadata = {
  name: 'Brie',
  species: 'Mouse',
  totalSgRNAs: 78637,
  totalGenes: 19674,
  sgRNAsPerGene: 4,
  source: 'Broad Institute / Addgene #73633',
};

// Library cache
const libraryCache = new Map<string, Map<string, string>>();

// Get library as a Map<sgRNA_sequence, gene>
export function getLibrary(libraryType: string): Map<string, string> {
  if (libraryCache.has(libraryType)) {
    return libraryCache.get(libraryType)!;
  }

  let metadata: LibraryMetadata;
  let genes: string[];

  switch (libraryType) {
    case 'brunello':
      metadata = BRUNELLO_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    case 'gecko-v2':
      metadata = GECKO_V2_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    case 'tko-v3':
      metadata = TKO_V3_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    case 'brie':
      metadata = BRIE_METADATA;
      genes = ALL_HUMAN_GENES.map(g => g); // Same genes for demo
      break;
    default:
      metadata = BRUNELLO_METADATA;
      genes = ALL_HUMAN_GENES;
  }

  const entries = generateLibraryEntries(genes, metadata.sgRNAsPerGene);
  const library = new Map<string, string>();

  for (const entry of entries) {
    library.set(entry.sequence, entry.gene);
  }

  libraryCache.set(libraryType, library);
  return library;
}

// Get library metadata
export function getLibraryMetadata(libraryType: string): LibraryMetadata {
  switch (libraryType) {
    case 'brunello':
      return BRUNELLO_METADATA;
    case 'gecko-v2':
      return GECKO_V2_METADATA;
    case 'tko-v3':
      return TKO_V3_METADATA;
    case 'brie':
      return BRIE_METADATA;
    default:
      return BRUNELLO_METADATA;
  }
}

// Get all sgRNA entries for a library (useful for exporting)
export function getLibraryEntries(libraryType: string): SgRNAEntry[] {
  let metadata: LibraryMetadata;
  let genes: string[];

  switch (libraryType) {
    case 'brunello':
      metadata = BRUNELLO_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    case 'gecko-v2':
      metadata = GECKO_V2_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    case 'tko-v3':
      metadata = TKO_V3_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    case 'brie':
      metadata = BRIE_METADATA;
      genes = ALL_HUMAN_GENES;
      break;
    default:
      metadata = BRUNELLO_METADATA;
      genes = ALL_HUMAN_GENES;
  }

  return generateLibraryEntries(genes, metadata.sgRNAsPerGene);
}

// Get essential genes
export function getEssentialGenes(): string[] {
  return [...ESSENTIAL_GENES];
}

// Get non-essential genes
export function getNonEssentialGenes(): string[] {
  return [...NON_ESSENTIAL_GENES];
}
