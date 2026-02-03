/**
 * PyMOL-Style Color Schemes and Representation Presets
 * 
 * Replicates PyMOL's vibrant, professional-quality color schemes and built-in presets.
 * All colors match PyMOL's defaults for a familiar experience.
 */

import type * as NGL from 'ngl';

// ═══════════════════════════════════════════════════════════════════════════════
// PYMOL CHAIN COLORS ("chainbow" scheme)
// ═══════════════════════════════════════════════════════════════════════════════

export const PYMOL_CHAIN_COLORS: Record<string, number> = {
  A: 0x3366CC, // Blue
  B: 0x00CCCC, // Cyan
  C: 0x00CC00, // Green
  D: 0xCCCC00, // Yellow/lime
  E: 0xFF9900, // Orange
  F: 0xFF0000, // Red
  G: 0xCC00CC, // Magenta
  H: 0x9966CC, // Purple
  I: 0xFF66CC, // Pink
  J: 0x66CCFF, // Sky blue
  K: 0xCCFF66, // Lime green
  L: 0xFF6666, // Light red
  M: 0x66FF66, // Light green
  N: 0xFFCC66, // Peach
  O: 0x66CCCC, // Teal
  P: 0xCC66CC, // Orchid
  // Fallback for chains beyond P
  default: 0xCCCCCC, // Gray
};

/**
 * Get PyMOL chain color by chain name
 */
export function getPyMOLChainColor(chainName: string): number {
  return PYMOL_CHAIN_COLORS[chainName] || PYMOL_CHAIN_COLORS.default;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PYMOL ELEMENT COLORS (CPK coloring)
// ═══════════════════════════════════════════════════════════════════════════════

export const PYMOL_ELEMENT_COLORS: Record<string, number> = {
  H: 0xFFFFFF, // White
  C: 0x33FF33, // Light gray (PyMOL uses light gray for carbon in CPK)
  N: 0x3333FF, // Blue
  O: 0xFF3333, // Red
  S: 0xFFFF33, // Yellow
  P: 0xFF9933, // Orange
  F: 0x33FF33, // Green
  CL: 0x33FF33, // Green
  BR: 0xCC3333, // Brown
  I: 0x9933CC, // Purple
  FE: 0xFF9933, // Orange
  CA: 0x33CC33, // Green
  MG: 0x339933, // Forest green
  ZN: 0x7D7D7D, // Gray
  CU: 0xCC9966, // Bronze
  default: 0xCC33CC, // Magenta (unknown elements)
};

// ═══════════════════════════════════════════════════════════════════════════════
// PYMOL SECONDARY STRUCTURE COLORS
// ═══════════════════════════════════════════════════════════════════════════════

export const PYMOL_SS_COLORS = {
  helix: 0xFF0000, // Red (α-helix)
  sheet: 0xFFFF00, // Yellow (β-sheet)
  turn: 0x0000FF, // Blue (turn)
  coil: 0x00FF00, // Green (coil/loop)
};

// ═══════════════════════════════════════════════════════════════════════════════
// PYMOL REPRESENTATION PRESETS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PyMOLPreset {
  id: string;
  name: string;
  description: string;
  apply: (component: any) => void; // NGL.StructureComponent
}

export const PYMOL_PRESETS: PyMOLPreset[] = [
  {
    id: 'cartoon',
    name: 'Cartoon (PyMOL)',
    description: 'Protein cartoon with secondary structure coloring',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      // Protein cartoon with secondary structure colors
      component.addRepresentation('cartoon', {
        sele: 'protein',
        colorScheme: 'sstruc', // Secondary structure coloring
        quality: 'high',
        smoothSheet: true,
        radiusScale: 1.2, // Slightly thicker (PyMOL style)
      });
      
      // Nucleic acids with rainbow gradient
      component.addRepresentation('cartoon', {
        sele: 'nucleic',
        colorScheme: 'residueindex', // Rainbow gradient
        quality: 'high',
      });
      
      // Hetero atoms (ligands) as sticks
      component.addRepresentation('ball+stick', {
        sele: 'hetero and not water',
        colorScheme: 'element',
        multipleBond: 'symmetric',
      });
    },
  },
  {
    id: 'cartoon-chainbow',
    name: 'Cartoon + Chainbow',
    description: 'Protein cartoon colored by chain (PyMOL rainbow)',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('cartoon', {
        sele: 'protein',
        colorScheme: 'chainid', // Color by chain
        quality: 'high',
        smoothSheet: true,
        radiusScale: 1.2,
      });
      
      component.addRepresentation('cartoon', {
        sele: 'nucleic',
        colorScheme: 'chainid',
        quality: 'high',
      });
    },
  },
  {
    id: 'sticks',
    name: 'Sticks (PyMOL)',
    description: 'All atoms as sticks (licorice)',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('licorice', {
        sele: 'all and not water',
        colorScheme: 'element',
        radiusScale: 0.3,
        quality: 'high',
      });
      
      // Water as tiny dots
      component.addRepresentation('point', {
        sele: 'water',
        pointSize: 0.5,
        color: 0x0000FF, // Blue
      });
    },
  },
  {
    id: 'surface',
    name: 'Surface (PyMOL)',
    description: 'Molecular surface colored by chain',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('surface', {
        sele: 'protein',
        colorScheme: 'chainid',
        surfaceType: 'ms', // Molecular surface (like PyMOL)
        probeRadius: 1.4,
        smooth: 2, // Smoothing level
        opacity: 0.85,
        quality: 'high',
      });
    },
  },
  {
    id: 'ribbon-ligand',
    name: 'Protein + Ligand (PyMOL)',
    description: 'Protein cartoon with ligand and binding pocket',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      // Protein cartoon
      component.addRepresentation('cartoon', {
        sele: 'protein',
        colorScheme: 'chainid',
        quality: 'high',
        smoothSheet: true,
      });
      
      // Ligand as ball+stick
      component.addRepresentation('ball+stick', {
        sele: 'hetero and not water',
        colorScheme: 'element',
        multipleBond: 'symmetric',
        radiusScale: 1.0,
      });
      
      // Binding pocket residues (within 5Å of ligand)
      try {
        component.addRepresentation('licorice', {
          sele: '(protein within 5 of (hetero and not water))',
          colorScheme: 'element',
          radiusScale: 0.4,
        });
      } catch (e) {
        // No ligands present, skip binding pocket
      }
    },
  },
  {
    id: 'ball-stick',
    name: 'Ball & Stick',
    description: 'Classic ball-and-stick representation',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('ball+stick', {
        sele: 'all and not water',
        colorScheme: 'element',
        multipleBond: 'symmetric',
        radiusScale: 1.0,
      });
    },
  },
  {
    id: 'spacefill',
    name: 'Spacefill (VDW)',
    description: 'Van der Waals spheres (space-filling)',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('spacefill', {
        sele: 'all and not water',
        colorScheme: 'element',
        quality: 'high',
      });
    },
  },
  {
    id: 'backbone',
    name: 'Backbone',
    description: 'Cα trace (backbone only)',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('backbone', {
        sele: 'protein',
        colorScheme: 'residueindex',
        radiusScale: 0.3,
      });
      
      component.addRepresentation('backbone', {
        sele: 'nucleic',
        colorScheme: 'residueindex',
        radiusScale: 0.3,
      });
    },
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    description: 'Smooth ribbon trace',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('ribbon', {
        sele: 'polymer',
        colorScheme: 'sstruc',
        quality: 'high',
      });
    },
  },
  {
    id: 'putty',
    name: 'Putty (B-factor)',
    description: 'Tube thickness by B-factor (flexibility)',
    apply: (component: any) => {
      component.removeAllRepresentations();
      
      component.addRepresentation('tube', {
        sele: 'protein',
        colorScheme: 'bfactor',
        radiusType: 'bfactor',
        radiusScale: 0.02,
        quality: 'high',
      });
    },
  },
];

/**
 * Get preset by ID
 */
export function getPyMOLPresetById(id: string): PyMOLPreset | undefined {
  return PYMOL_PRESETS.find(p => p.id === id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTION UTILITIES (PYMOL-STYLE)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert PyMOL-style selection to NGL selection
 * Examples:
 *   "resi 100-120" → "100-120"
 *   "chain A" → ":A"
 *   "resn ALA" → "ALA"
 */
export function pymolToNGLSelection(pymolSelection: string): string {
  let nglSelection = pymolSelection;
  
  // "resi 100-120" → "100-120"
  nglSelection = nglSelection.replace(/resi\s+(\d+-?\d*)/g, '$1');
  
  // "chain A" → ":A"
  nglSelection = nglSelection.replace(/chain\s+([A-Z])/g, ':$1');
  
  // "resn ALA" → "ALA"
  nglSelection = nglSelection.replace(/resn\s+([A-Z]{3})/g, '$1');
  
  // "name CA" → ".CA"
  nglSelection = nglSelection.replace(/name\s+([A-Z0-9]+)/g, '.$1');
  
  return nglSelection;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE OPTIMIZATION (FOR LARGE STRUCTURES)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apply quality settings based on structure size (PyMOL technique)
 */
export function getOptimalQuality(atomCount: number): {
  quality: 'low' | 'medium' | 'high';
  sampleLevel: number;
  disablePicking: boolean;
} {
  if (atomCount > 100000) {
    // Very large structures (>100k atoms)
    return {
      quality: 'medium',
      sampleLevel: 1,
      disablePicking: true, // Disable clicking for speed
    };
  } else if (atomCount > 50000) {
    // Large structures (50-100k atoms)
    return {
      quality: 'medium',
      sampleLevel: 1,
      disablePicking: false,
    };
  } else {
    // Normal structures (<50k atoms)
    return {
      quality: 'high',
      sampleLevel: 2,
      disablePicking: false,
    };
  }
}
