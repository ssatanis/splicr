'use client';

import { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import type { PDBMetadataForAI } from '@/types/ai.types';

interface StructureExplainerProps {
  pdbId: string;
  metadata: PDBMetadataForAI | null;
}

export function StructureExplainer({ pdbId, metadata }: StructureExplainerProps) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExplain = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdbId,
          metadata: metadata ?? {},
          userQuestion: question.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to generate explanation. Please try again.');
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
        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1.5 font-serif">
          Optional question
        </label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Focus on the RuvC domain"
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-tertiary text-sm font-serif"
        />
      </div>
      <button
        type="button"
        onClick={handleExplain}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 font-serif text-sm"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Explaining…
          </>
        ) : (
          <>
            <BookOpen className="w-4 h-4" />
            Generate explanation
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
