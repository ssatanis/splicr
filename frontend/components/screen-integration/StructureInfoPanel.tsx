"use client";

import type { StructureDetailMetadata, ResidueInfo, DomainInfo } from '@/lib/screenStructureTypes';
import { ExternalLink } from 'lucide-react';

export interface StructureInfoPanelProps {
  metadata: StructureDetailMetadata | null;
  selectedResidue: ResidueInfo | null;
  domains?: DomainInfo[];
  onDomainClick?: (domain: DomainInfo) => void;
}

export default function StructureInfoPanel({
  metadata,
  selectedResidue,
  domains = [],
  onDomainClick,
}: StructureInfoPanelProps) {
  if (!metadata && !selectedResidue) {
    return (
      <div className="text-sm text-text-tertiary p-4">
        Load a structure in the viewer to see details here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {metadata && (
        <>
          <div>
            <h3 className="font-serif font-semibold text-text-primary text-lg">{metadata.pdbId}</h3>
            <p className="text-sm text-text-secondary mt-0.5">{metadata.title}</p>
            <p className="text-xs text-text-tertiary mt-1">
              {metadata.organism} · {metadata.method}
              {metadata.resolution != null && ` · ${metadata.resolution} \u00C5`}
            </p>
            {metadata.depositionDate && (
              <p className="text-xs text-text-tertiary">Deposited: {metadata.depositionDate}</p>
            )}
            {metadata.doi && (
              <a
                href={`https://doi.org/${metadata.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1"
              >
                DOI
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Composition</h4>
            <ul className="text-sm text-text-secondary space-y-1">
              {metadata.chains.map((ch) => (
                <li key={ch.id}>
                  Chain {ch.id}: {ch.type}, {ch.length} {ch.type === 'Protein' ? 'residues' : 'bases'}
                </li>
              ))}
              <li>Total atoms: {metadata.totalAtoms.toLocaleString()}</li>
              {metadata.ligands && metadata.ligands.length > 0 && (
                <li>Ligands: {metadata.ligands.join(', ')}</li>
              )}
            </ul>
          </div>
        </>
      )}

      {selectedResidue && (
        <div className="border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
            Current selection
          </h4>
          <p className="font-mono text-sm text-text-primary">
            {selectedResidue.residue} {selectedResidue.resno} (Chain {selectedResidue.chainId})
          </p>
          {selectedResidue.bFactor != null && (
            <p className="text-xs text-text-tertiary mt-0.5">
              B-factor: {selectedResidue.bFactor} \u00C5\u00B2
            </p>
          )}
          {selectedResidue.nearbyResidues && selectedResidue.nearbyResidues.length > 0 && (
            <>
              <p className="text-xs font-medium text-text-tertiary mt-2">Nearby (5 \u00C5)</p>
              <ul className="text-xs text-text-secondary mt-1 space-y-0.5">
              {selectedResidue.nearbyResidues.map((nr, i) => (
                <li key={i}>
                  {nr.residue} {nr.resno} ({nr.distance.toFixed(1)} \u00C5)
                  {nr.interaction && ` — ${nr.interaction}`}
                </li>
              ))}
              </ul>
            </>
          )}
          {selectedResidue.functionalAnnotation && (
            <p className="text-xs text-text-secondary mt-2 italic">
              {selectedResidue.functionalAnnotation}
            </p>
          )}
        </div>
      )}

      {domains.length > 0 && (
        <div className="border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
            Domains & motifs
          </h4>
          <div className="flex flex-wrap gap-1">
            {domains.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onDomainClick?.(d)}
                className="px-2 py-1 rounded text-xs font-medium bg-background border border-border text-text-secondary hover:bg-accent/20 hover:text-text-primary transition-colors"
                title={`${d.name} (${d.start}-${d.end})`}
              >
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
