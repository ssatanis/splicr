'use client';

import { useState } from 'react';
import { Pill, Loader2 } from 'lucide-react';

interface DrugTargetAnalyzerProps {
  pdbId: string;
}

export function DrugTargetAnalyzer({ pdbId }: DrugTargetAnalyzerProps) {
  const [targetResidue, setTargetResidue] = useState('');
  const [volume, setVolume] = useState('');
  const [surfaceArea, setSurfaceArea] = useState('');
  const [hpRatio, setHpRatio] = useState('');
  const [residues, setResidues] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAssess = async () => {
    const residue = targetResidue.trim();
    if (!residue) {
      setError('Target residue is required (e.g. binding pocket center)');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const pocketGeometry: Record<string, unknown> = {};
      if (volume.trim()) pocketGeometry.volume = Number(volume) || undefined;
      if (surfaceArea.trim()) pocketGeometry.surfaceArea = Number(surfaceArea) || undefined;
      if (hpRatio.trim()) pocketGeometry.hpRatio = hpRatio.trim();
      if (residues.trim()) {
        pocketGeometry.residues = residues.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      }

      const res = await fetch('/api/ai/druggability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdbId,
          targetResidue: residue,
          pocketGeometry,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to assess druggability. Please try again.');
      }
      setResult(data.text);
    } catch (err) {
      let errorMessage = 'Unable to complete the request. Please try again.';
      if (err instanceof Error) {
        if (err.message.includes('rate limit') || err.message.includes('quota') || err.message.includes('capacity')) {
          errorMessage = 'AI service is at capacity. Please wait a moment and try again.';
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
          Target residue / pocket center
        </label>
        <input
          type="text"
          value={targetResidue}
          onChange={(e) => setTargetResidue(e.target.value)}
          placeholder="e.g. K848 or binding pocket"
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm font-mono"
        />
      </div>
      <div className="text-xs text-text-tertiary font-serif">
        Optional pocket characteristics (improve assessment):
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
            Volume (Å³)
          </label>
          <input
            type="text"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="e.g. 500"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
            Surface (Å²)
          </label>
          <input
            type="text"
            value={surfaceArea}
            onChange={(e) => setSurfaceArea(e.target.value)}
            placeholder="e.g. 300"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
          Hydrophobic / hydrophilic ratio
        </label>
        <input
          type="text"
          value={hpRatio}
          onChange={(e) => setHpRatio(e.target.value)}
          placeholder="e.g. 0.6"
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
          Residues (comma-separated)
        </label>
        <input
          type="text"
          value={residues}
          onChange={(e) => setResidues(e.target.value)}
          placeholder="e.g. K848, E762, D839"
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm font-mono"
        />
      </div>
      <button
        type="button"
        onClick={handleAssess}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 font-serif text-sm"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Assessing…
          </>
        ) : (
          <>
            <Pill className="w-4 h-4" />
            Assess druggability
          </>
        )}
      </button>
      {error && (
        <p className="text-sm text-red-600 font-serif">{error}</p>
      )}
      {result && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-primary font-serif whitespace-pre-wrap leading-relaxed">
          {result}
        </div>
      )}
    </div>
  );
}
