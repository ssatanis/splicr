/**
 * Types for Screen-to-Structure Integration Panel
 * Bridges CRISPR screening results with protein structure and literature context.
 */

export type ScreenType = 'knockout' | 'activation' | 'interference';

export interface AnalysisConnection {
  analysisId: string;
  analysisName: string;
  screenType: ScreenType;
  completedDate: string;
  totalGenes: number;
  significantHits: number;
  cellLine: string;
  condition: string;
}

export interface ScreenHitGene {
  gene_name: string;
  log_fold_change: number;
  fdr: number;
  pvalue: number;
  rank: number;
}

/** RCSB PDB search result entry */
export interface StructureMatch {
  identifier: string;
  score?: number;
  title?: string;
  resolution?: number;
  method?: string;
  organism?: string;
  deposition_date?: string;
  citation?: { title?: string; pmid?: string; doi?: string };
}

/** AlphaFold DB match */
export interface AlphaFoldMatch {
  uniprotId: string;
  url: string;
  pLDDT?: number;
  gene?: string;
}

/** Combined structure option for a gene */
export type StructureOption =
  | { type: 'pdb'; identifier: string; resolution?: number; method?: string; title?: string }
  | { type: 'alphafold'; identifier: string; uniprotId: string; pLDDT?: number; url: string };

export interface ResidueInfo {
  residue: string;
  chainId: string;
  resno: number;
  bFactor?: number;
  nearbyResidues?: { residue: string; chainId: string; resno: number; distance: number; interaction?: string }[];
  functionalAnnotation?: string;
}

export interface DomainInfo {
  id: string;
  name: string;
  start: number;
  end: number;
  source: string;
  description?: string;
}

export interface StructureDetailMetadata {
  pdbId: string;
  title: string;
  organism: string;
  method: 'X-ray crystallography' | 'NMR' | 'Cryo-EM' | 'Predicted';
  resolution?: number;
  rValue?: number;
  rFree?: number;
  depositionDate?: string;
  doi?: string;
  chains: { id: string; type: string; length: number; description?: string }[];
  totalAtoms: number;
  ligands?: string[];
}

export interface LiteratureCard {
  pmid?: string;
  title: string;
  authors?: string;
  journal?: string;
  year?: number;
  citationCount?: number;
  doi?: string;
  abstract?: string;
}

export interface DrugTargetInfo {
  gene: string;
  drugName: string;
  status?: string;
  source?: string;
}

export interface PathwayMembership {
  id: string;
  name: string;
  source: 'Reactome' | 'KEGG';
  url?: string;
}

export interface IntegrationPanelState {
  connectedAnalysis: AnalysisConnection | null;
  selectedGenes: Set<string>;
  structureMappings: Map<string, StructureOption[]>;
  loadingGenes: Set<string>;
  activeTab: 'analysis' | 'structure' | 'literature';
  selectedResidue: ResidueInfo | null;
}

/** User-configurable panel options */
export interface ScreenIntegrationConfig {
  panelWidth: number;
  fdrThreshold: number;
  lfcThreshold: number;
  maxHitsToShow: number;
  viewerRepresentation: 'cartoon' | 'surface' | 'ribbon' | 'ball+stick';
  viewerColorScheme: 'chainid' | 'element' | 'residueindex' | 'sstruc';
  showAlphaFoldFirst: boolean;
  showExperimentalFirst: boolean;
  exportIncludeThumbnails: boolean;
  exportTopN: number;
}

export const DEFAULT_INTEGRATION_CONFIG: ScreenIntegrationConfig = {
  panelWidth: 360,
  fdrThreshold: 0.05,
  lfcThreshold: 1,
  maxHitsToShow: 20,
  viewerRepresentation: 'cartoon',
  viewerColorScheme: 'chainid',
  showAlphaFoldFirst: false,
  showExperimentalFirst: true,
  exportIncludeThumbnails: true,
  exportTopN: 10,
};
