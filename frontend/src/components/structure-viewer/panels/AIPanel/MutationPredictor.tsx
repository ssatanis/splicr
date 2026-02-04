'use client';

import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';

interface MutationPredictorProps {
  pdbId: string;
}

export function MutationPredictor({ pdbId }: MutationPredictorProps) {
  const [residue, setResidue] = useState('');
  const [mutation, setMutation] = useState('');
  const [context, setContext] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePredict = async () => {
    const r = residue.trim();
    const m = mutation.trim();
    if (!r || !m) {
      setError('Residue and mutation are required (e.g. D10, A)');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/mutation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdbId,
          residue: r,
          mutation: m,
          structuralContext: context.trim() || 'No additional context provided.',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to predict mutation effect. Please try again.');
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
            Residue
          </label>
          <input
            type="text"
            value={residue}
            onChange={(e) => setResidue(e.target.value)}
            placeholder="e.g. D10"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
            Mutation
          </label>
          <input
            type="text"
            value={mutation}
            onChange={(e) => setMutation(e.target.value)}
            placeholder="e.g. A"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm font-mono"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1 font-serif">
          Context (optional)
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="e.g. Catalytic residue in HNH nuclease domain"
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm font-serif resize-none"
        />
      </div>
      <button
        type="button"
        onClick={handlePredict}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 font-serif text-sm"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Predicting…
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4" />
            Predict effect
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
