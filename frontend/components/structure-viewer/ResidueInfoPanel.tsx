"use client";

import type { ResidueSelectionInfo } from '@/types/structure-viewer';
import { X } from 'lucide-react';

export interface ResidueInfoPanelProps {
  residue: ResidueSelectionInfo | null;
  onClose: () => void;
  pdbId?: string;
  className?: string;
}

const RESIDUE_DESCRIPTIONS: Record<string, string> = {
  ASP: 'Aspartate (D) — Acidic residue (pKa ~3.9). Negatively charged carboxylate side chain at physiological pH. Common in active sites and metal coordination.',
  GLU: 'Glutamate (E) — Acidic residue (pKa ~4.3). Essential catalytic residue in many enzymatic mechanisms. Participates in salt bridge formation.',
  ARG: 'Arginine (R) — Basic residue (pKa ~12.5). Positively charged guanidinium group. Critical for nucleic acid binding and electrostatic interactions.',
  LYS: 'Lysine (K) — Basic residue (pKa ~10.5). ε-amino group subject to post-translational modifications (acetylation, methylation, ubiquitination).',
  HIS: 'Histidine (H) — Imidazole side chain (pKa ~6.0). Protonation state variable at physiological pH. Common in catalytic triads and metal coordination.',
  CYS: 'Cysteine (C) — Thiol-containing residue. Forms disulfide bridges (cystine). Critical for protein folding and redox-sensitive regulation.',
  TYR: 'Tyrosine (Y) — Aromatic hydroxyl residue. Substrate for kinase-mediated phosphorylation. Important in signal transduction cascades.',
  PHE: 'Phenylalanine (F) — Hydrophobic aromatic residue. Typically buried in protein core. Essential for structural stability via π-π interactions.',
  TRP: 'Tryptophan (W) — Largest amino acid with indole side chain. Strong UV absorbance (280 nm). Fluorescent probe for protein conformational studies.',
  PRO: 'Proline (P) — Imino acid with cyclic structure. Restricts backbone conformational freedom. Induces β-turns and disrupts α-helices.',
  SER: 'Serine (S) — Polar hydroxyl residue. Phosphorylation target in signal transduction. Nucleophile in serine protease catalytic mechanisms.',
  THR: 'Threonine (T) — Polar β-hydroxyl residue. Substrate for O-linked glycosylation and phosphorylation. Stereocenter at Cβ position.',
  ASN: 'Asparagine (N) — Polar amide residue. N-glycosylation consensus site (Asn-X-Ser/Thr). Important for hydrogen bonding networks.',
  GLN: 'Glutamine (Q) — Polar amide residue. Involved in substrate recognition. Deamidation-prone under physiological conditions.',
  ALA: 'Alanine (A) — Small hydrophobic residue with methyl side chain. High α-helix propensity. Common in helical transmembrane domains.',
  GLY: 'Glycine (G) — Achiral residue without side chain. Highest conformational flexibility. Essential in tight turns and flexible loops.',
  VAL: 'Valine (V) — Branched aliphatic residue. High β-sheet propensity. Critical for hydrophobic core packing.',
  ILE: 'Isoleucine (I) — Branched aliphatic with β-branching. Stereocenter at Cβ. Strong hydrophobic character.',
  LEU: 'Leucine (L) — Branched aliphatic residue. Most abundant amino acid in proteins. Key for protein-protein interactions via leucine zippers.',
  MET: 'Methionine (M) — Sulfur-containing thioether residue. Translation initiation codon (AUG). Oxidation-sensitive.',
};

function getResidueDescription(resname: string): string {
  return RESIDUE_DESCRIPTIONS[resname] ?? `${resname} residue`;
}

export default function ResidueInfoPanel({
  residue,
  onClose,
  pdbId,
  className = '',
}: ResidueInfoPanelProps) {
  if (!residue) return null;

  const description = residue.annotation ?? getResidueDescription(residue.residueName);

  return (
    <div
      className={`absolute bottom-4 left-4 right-4 md:right-auto md:w-96 max-h-[80%] overflow-hidden flex flex-col bg-surface/95 backdrop-blur-sm border-2 border-accent/30 rounded-2xl shadow-xl z-20 ${className}`}
      role="dialog"
      aria-label="Residue information"
      style={{
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 215, 0, 0.15)',
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-accent/20 bg-gradient-to-r from-accent/10 to-transparent">
        <div>
          <h3 className="text-lg font-bold text-text-primary font-serif tracking-tight">
            {residue.residueName} {residue.residueNumber}
          </h3>
          <p className="text-xs text-accent font-semibold mt-0.5">Chain {residue.chainId} • Residue Index: {residue.residueNumber}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-accent/20 transition-all text-text-tertiary hover:text-accent hover:scale-110"
          aria-label="Close residue panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          {residue.atomName && (
            <div className="bg-background/80 rounded-lg p-3 border border-border/50">
              <dt className="text-xs text-text-tertiary font-medium uppercase tracking-wide mb-1">Atom</dt>
              <dd className="text-lg font-mono font-bold text-text-primary">{residue.atomName}</dd>
            </div>
          )}
          {residue.element && (
            <div className="bg-background/80 rounded-lg p-3 border border-border/50">
              <dt className="text-xs text-text-tertiary font-medium uppercase tracking-wide mb-1">Element</dt>
              <dd className="text-lg font-mono font-bold text-text-primary">{residue.element}</dd>
            </div>
          )}
          {residue.bFactor != null && (
            <div className="bg-background/80 rounded-lg p-3 border border-border/50">
              <dt className="text-xs text-text-tertiary font-medium uppercase tracking-wide mb-1">B-factor (Å²)</dt>
              <dd className="text-lg font-mono font-bold text-text-primary">{residue.bFactor.toFixed(2)}</dd>
              <dd className="text-[9px] text-text-tertiary mt-0.5">Thermal displacement</dd>
            </div>
          )}
          {pdbId && (
            <div className="bg-background/80 rounded-lg p-3 border border-border/50">
              <dt className="text-xs text-text-tertiary font-medium uppercase tracking-wide mb-1">Structure</dt>
              <dd className="text-base font-mono font-bold text-text-primary">{pdbId}</dd>
            </div>
          )}
        </div>
        {residue.coordinates && (
          <div className="bg-gradient-to-br from-accent/5 to-transparent rounded-lg p-4 border border-accent/20">
              <h4 className="text-xs font-bold text-accent uppercase tracking-wider mb-2 flex items-center">
              <svg className="w-3 h-3 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Cartesian Coordinates (Å)
            </h4>
            <div className="grid grid-cols-3 gap-2 text-xs font-mono">
              <div className="bg-surface/60 rounded px-2 py-1.5 border border-border/30">
                <span className="text-text-tertiary">x:</span> <span className="text-text-primary font-semibold">{residue.coordinates.x}</span>
              </div>
              <div className="bg-surface/60 rounded px-2 py-1.5 border border-border/30">
                <span className="text-text-tertiary">y:</span> <span className="text-text-primary font-semibold">{residue.coordinates.y}</span>
              </div>
              <div className="bg-surface/60 rounded px-2 py-1.5 border border-border/30">
                <span className="text-text-tertiary">z:</span> <span className="text-text-primary font-semibold">{residue.coordinates.z}</span>
              </div>
            </div>
          </div>
        )}
        <div className="bg-background/60 rounded-lg p-4 border border-border/50">
          <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2">
            Biochemical Properties
          </h4>
          <p className="text-xs text-text-secondary leading-relaxed">{description}</p>
        </div>
        {residue.nearbyResidues && residue.nearbyResidues.length > 0 && (
          <div className="bg-background/60 rounded-lg p-4 border border-border/50">
            <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 flex items-center">
              <svg className="w-3 h-3 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Spatial Microenvironment (5 Å radius)
            </h4>
            <ul className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
              {residue.nearbyResidues.slice(0, 12).map((nr, i) => (
                <li
                  key={`${nr.chain}-${nr.residueNumber}-${i}`}
                  className="flex items-center justify-between text-xs py-2 px-3 bg-surface/50 rounded-lg border border-border/30 hover:border-accent/30 hover:bg-accent/5 transition-all"
                >
                  <span className="font-mono font-semibold text-text-primary">
                    {nr.residueName} {nr.residueNumber}
                    <span className="text-accent ml-1.5">({nr.chain})</span>
                  </span>
                  <div className="flex flex-col items-end">
                    <span className="text-text-tertiary font-semibold">{nr.distance} Å</span>
                    {nr.interaction && (
                      <span className="text-[10px] text-accent/70 mt-0.5">{nr.interaction}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
