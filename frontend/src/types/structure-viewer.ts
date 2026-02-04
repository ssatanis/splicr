/**
 * TypeScript interfaces for the 3D structure viewer control panel
 * and CRISPR preset library. Aligned with NGL selection syntax and representation types.
 */

/** Structure search result from RCSB or AlphaFold */
export interface StructureMatchResult {
  identifier: string;
  score?: number;
  title?: string;
  resolution?: number;
  method?: string;
  organism?: string;
  deposition_date?: string;
  citation?: { title?: string; pmid?: string; doi?: string };
}

export type RepresentationType =
  | 'cartoon'
  | 'backbone'
  | 'ball+stick'
  | 'licorice'
  | 'surface'
  | 'ribbon'
  | 'spacefill';

export type ColorSchemeType =
  | 'chainid'
  | 'element'
  | 'sstruc'
  | 'hydrophobicity'
  | 'bfactor'
  | 'residueindex'
  | 'uniform'
  | 'custom';

export type QualityLevel = 'low' | 'medium' | 'high';

/** NGL representation config for a single display (e.g. protein cartoon, PAM ball+stick) */
export interface RepresentationConfig {
  type: 'cartoon' | 'surface' | 'ball+stick' | 'licorice' | 'ribbon' | 'spacefill' | 'backbone';
  selection: string; // NGL selection syntax, e.g. ":A", ":B and nucleic"
  color: string | ColorSchemeType; // hex "#6495ED" or scheme name
  opacity?: number;
  parameters?: Record<string, unknown>;
}

/** Highlight for a specific region (e.g. PAM sequence, HNH active site) */
export interface HighlightConfig {
  name: string;
  selection: string;
  color: string;
  label?: string;
}

/** Annotation shown on the structure or in UI */
export interface AnnotationConfig {
  text: string;
  position?: string; // NGL selection for label anchor
  citation?: string;
  doi?: string;
}

export interface CRISPRPreset {
  id: string;
  name: string;
  description: string;
  pdbId: string;
  organism: string;
  thumbnailUrl: string;
  defaultRepresentations: RepresentationConfig[];
  highlights: HighlightConfig[];
  annotations: AnnotationConfig[];
  doi?: string;
  method?: string;
  resolution?: number;
  year?: number;
  citation?: string;
}

export interface ControlPanelState {
  activePreset: string | null;
  representation: RepresentationType;
  colorScheme: ColorSchemeType;
  quality: QualityLevel;
  visibleComponents: Set<string>;
  customSelection: string;
  /** For uniform color scheme */
  uniformColor?: string;
}

/** Residue/atom info shown when user clicks on the structure */
export interface ResidueSelectionInfo {
  residueNumber: number;
  residueName: string;
  chainId: string;
  atomName?: string;
  element?: string;
  bFactor?: number;
  coordinates?: { x: string; y: string; z: string };
  nearbyResidues?: NearbyResidue[];
  annotation?: string;
}

/** Nearby residue within a radius (e.g. 5Å) */
export interface NearbyResidue {
  residueName: string;
  residueNumber: number;
  chain: string;
  distance: string;
  interaction?: string;
}

export interface StructureControlPanelProps {
  onPresetSelect: (preset: CRISPRPreset) => void;
  onRepresentationChange: (type: RepresentationType) => void;
  onColorSchemeChange: (scheme: ColorSchemeType, uniformColor?: string) => void;
  onVisibilityToggle: (component: string, visible: boolean) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  currentState: ControlPanelState;
  isLoading?: boolean;
  /** Residue counts per component for badges (e.g. "Guide RNA": 98) */
  componentCounts?: Record<string, number>;
  /** Allow loading presets; disabled when viewing uploaded file */
  presetsEnabled?: boolean;
  /** Callback when user selects a file to load */
  onFileSelect?: (file: File) => void;
}
