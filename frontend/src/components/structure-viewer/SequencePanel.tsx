/**
 * PyMOL-Style Sequence Viewer Panel
 * 
 * Displays protein/nucleic acid sequences with secondary structure annotations.
 * Click residue → zoom to that position in 3D (just like PyMOL).
 */

"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Search, Dna } from 'lucide-react';
import * as NGL from 'ngl';

interface Residue {
  name: string; // Three-letter code (ALA, GLY, etc.)
  resno: number;
  sstruc: string; // 'h' = helix, 's' = sheet, 'c' = coil
  inscode?: string;
}

interface ChainData {
  chainname: string;
  residues: Residue[];
  type: 'protein' | 'nucleic' | 'other';
}

interface SequencePanelProps {
  component: any; // NGL.StructureComponent
  stage: any; // NGL.Stage
  onResidueClick?: (chainname: string, resno: number) => void;
}

// Three-letter to one-letter amino acid codes
const AA_CODE_MAP: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  // Modified/unusual
  MSE: 'M', // Selenomethionine
  HSD: 'H', HSE: 'H', HSP: 'H', // Histidine variants
};

// Nucleotide codes
const NA_CODE_MAP: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'U',
  DA: 'A', DC: 'C', DG: 'G', DT: 'T',
};

/**
 * Secondary structure colors (PyMOL style)
 */
const SS_COLORS = {
  h: '#FF0000', // Red (helix)
  s: '#FFFF00', // Yellow (sheet)
  t: '#0000FF', // Blue (turn)
  c: '#00FF00', // Green (coil)
  '-': '#888888', // Gray (undefined)
};

export default function SequencePanel({
  component,
  stage,
  onResidueClick,
}: SequencePanelProps) {
  const [chains, setChains] = useState<ChainData[]>([]);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredResidue, setHoveredResidue] = useState<{
    chain: string;
    resno: number;
  } | null>(null);

  // Extract sequence data from NGL structure
  useEffect(() => {
    if (!component?.structure) return;

    const structure = component.structure;
    const chainMap = new Map<string, ChainData>();

    structure.eachChain((chain: any) => {
      const chainname = chain.chainname;
      const residues: Residue[] = [];
      let chainType: 'protein' | 'nucleic' | 'other' = 'other';

      chain.eachResidue((residue: any) => {
        // Determine chain type from first residue
        if (residues.length === 0) {
          if (AA_CODE_MAP[residue.resname]) {
            chainType = 'protein';
          } else if (NA_CODE_MAP[residue.resname]) {
            chainType = 'nucleic';
          }
        }

        residues.push({
          name: residue.resname,
          resno: residue.resno,
          sstruc: residue.sstruc || 'c', // Default to coil
          inscode: residue.inscode,
        });
      });

      if (residues.length > 0) {
        chainMap.set(chainname, {
          chainname,
          residues,
          type: chainType,
        });
      }
    });

    setChains(Array.from(chainMap.values()));
    
    // Auto-expand first chain
    if (chainMap.size > 0) {
      setExpandedChains(new Set([Array.from(chainMap.keys())[0]]));
    }
  }, [component]);

  // Toggle chain expansion
  const toggleChain = useCallback((chainname: string) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainname)) {
        next.delete(chainname);
      } else {
        next.add(chainname);
      }
      return next;
    });
  }, []);

  // Handle residue click
  const handleResidueClick = useCallback(
    (chainname: string, resno: number) => {
      if (onResidueClick) {
        onResidueClick(chainname, resno);
      }

      // Zoom to residue in 3D
      if (stage && component) {
        try {
          const selection = `${resno}:${chainname}`;
          const center = component.getCenter(selection);
          
          if (center) {
            stage.animationControls.zoomMove(
              center,
              0, // rotation
              500 // duration ms
            );
          }

          // Highlight residue temporarily
          const highlightRepr = component.addRepresentation('ball+stick', {
            sele: selection,
            color: 0xFFFF00, // Yellow (PyMOL selection color)
            radiusScale: 1.5,
            opacity: 0.9,
          });

          // Remove highlight after 2 seconds
          setTimeout(() => {
            if (highlightRepr?.remove) {
              highlightRepr.remove();
            }
          }, 2000);
        } catch (err) {
          console.error('Failed to zoom to residue:', err);
        }
      }
    },
    [stage, component, onResidueClick]
  );

  // Filter chains by search
  const filteredChains = useMemo(() => {
    if (!searchQuery) return chains;

    const query = searchQuery.toLowerCase();
    return chains
      .map((chain) => ({
        ...chain,
        residues: chain.residues.filter((res) => {
          const oneLetterCode =
            chain.type === 'protein'
              ? AA_CODE_MAP[res.name] || res.name
              : NA_CODE_MAP[res.name] || res.name;
          return (
            res.name.toLowerCase().includes(query) ||
            res.resno.toString().includes(query) ||
            oneLetterCode.toLowerCase().includes(query)
          );
        }),
      }))
      .filter((chain) => chain.residues.length > 0);
  }, [chains, searchQuery]);

  // Render residue as colored block
  const renderResidue = useCallback(
    (chain: ChainData, residue: Residue, index: number) => {
      const oneLetterCode =
        chain.type === 'protein'
          ? AA_CODE_MAP[residue.name] || 'X'
          : NA_CODE_MAP[residue.name] || residue.name;

      const isHovered =
        hoveredResidue?.chain === chain.chainname &&
        hoveredResidue?.resno === residue.resno;

      // Secondary structure color
      const ssColor = SS_COLORS[residue.sstruc as keyof typeof SS_COLORS] || SS_COLORS['-'];

      return (
        <button
          key={`${chain.chainname}-${residue.resno}-${index}`}
          onClick={() => handleResidueClick(chain.chainname, residue.resno)}
          onMouseEnter={() =>
            setHoveredResidue({ chain: chain.chainname, resno: residue.resno })
          }
          onMouseLeave={() => setHoveredResidue(null)}
          className={`relative group flex items-center justify-center w-7 h-7 text-xs font-mono font-semibold rounded transition-transform ${
            isHovered ? 'scale-110 z-10' : ''
          }`}
          style={{
            backgroundColor: ssColor,
            color: residue.sstruc === 's' || residue.sstruc === 'c' ? '#000' : '#FFF',
          }}
          title={`${residue.name} ${residue.resno} (${chain.chainname})`}
        >
          {oneLetterCode}
          
          {/* Tooltip on hover */}
          {isHovered && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-surface border border-border rounded shadow-lg whitespace-nowrap z-20 text-text-primary text-xs">
              <div className="font-medium">{residue.name} {residue.resno}</div>
              <div className="text-text-tertiary text-[10px]">
                Chain {chain.chainname} | {
                  residue.sstruc === 'h' ? 'Helix' :
                  residue.sstruc === 's' ? 'Sheet' :
                  residue.sstruc === 't' ? 'Turn' : 'Coil'
                }
              </div>
            </div>
          )}
        </button>
      );
    },
    [hoveredResidue, handleResidueClick]
  );

  if (chains.length === 0) {
    return null;
  }

  return (
    <div className="w-full bg-surface/95 backdrop-blur-sm border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Dna className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-serif font-semibold text-text-primary">
            Sequence Viewer
          </h3>
          <span className="text-xs text-text-tertiary">
            ({chains.length} chain{chains.length !== 1 ? 's' : ''})
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search residues..."
            className="w-40 pl-7 pr-2 py-1 text-xs rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 bg-background/50 border-b border-border text-xs">
        <span className="text-text-tertiary font-medium">Secondary Structure:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: SS_COLORS.h }} />
          <span className="text-text-secondary">Helix</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: SS_COLORS.s }} />
          <span className="text-text-secondary">Sheet</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: SS_COLORS.t }} />
          <span className="text-text-secondary">Turn</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: SS_COLORS.c }} />
          <span className="text-text-secondary">Coil</span>
        </div>
      </div>

      {/* Chain list */}
      <div className="max-h-64 overflow-y-auto">
        {filteredChains.map((chain) => {
          const isExpanded = expandedChains.has(chain.chainname);

          return (
            <div key={chain.chainname} className="border-b border-border last:border-b-0">
              {/* Chain header */}
              <button
                onClick={() => toggleChain(chain.chainname)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-background/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-text-tertiary" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  )}
                  <span className="text-sm font-mono font-semibold text-text-primary">
                    Chain {chain.chainname}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    ({chain.residues.length} residues, {chain.type})
                  </span>
                </div>
              </button>

              {/* Sequence */}
              {isExpanded && (
                <div className="px-3 pb-3">
                  <div className="flex flex-wrap gap-0.5 p-2 bg-background rounded-lg">
                    {chain.residues.map((residue, index) =>
                      renderResidue(chain, residue, index)
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredChains.length === 0 && searchQuery && (
        <div className="p-6 text-center text-text-tertiary text-sm">
          No residues match "{searchQuery}"
        </div>
      )}
    </div>
  );
}
