'use client';

import { useState } from 'react';
import { Key, ExternalLink, Code, BookOpen, Download, Globe, ChevronDown, ChevronRight } from 'lucide-react';
import APIKeyManager from '@/components/APIKeyManager';

const RATE_LIMITS: Record<string, string> = {
  Standard: '100/min',
  Pro: '500/min',
  Enterprise: '2000/min',
};

export function APIIntegrationsSettings() {
  const [externalOpen, setExternalOpen] = useState(true);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <Key className="w-6 h-6" />
          Developer & Integrations
        </h2>
        <p className="text-sm text-text-secondary">
          Manage API keys, check rate limits, and configure external tool connections
        </p>
      </div>

      {/* API Key Manager (includes rate limits) */}
      <APIKeyManager />

      {/* External Tools */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setExternalOpen(!externalOpen)}
          className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-background/50 transition-colors"
        >
          {externalOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <Code className="w-5 h-5 text-text-secondary" />
          <span className="font-serif text-text-primary">Integrations & SDKs</span>
        </button>
        {externalOpen && (
          <div className="px-6 pb-6 pt-0 border-t border-border space-y-6">
            <div className="mt-6">
              <h4 className="text-sm font-serif text-text-primary mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Python Client
              </h4>
              <pre className="p-4 bg-background border border-border rounded-lg text-sm text-text-primary overflow-x-auto">
                {`pip install splicr
# or: pip install splicr-sdk`}
              </pre>
              <p className="text-xs text-text-tertiary mt-1">Use your API key in scripts or environment.</p>
            </div>
            <div>
              <h4 className="text-sm font-serif text-text-primary mb-2">R package</h4>
              <pre className="p-4 bg-background border border-border rounded-lg text-sm text-text-primary overflow-x-auto">
                {`# Install from GitHub or CRAN
install.packages("splicr")
# Or: remotes::install_github("splicr/splicr-r")`}
              </pre>
            </div>
            <div>
              <h4 className="text-sm font-serif text-text-primary mb-2 flex items-center gap-2">
                <Download className="w-4 h-4" />
                Jupyter Notebook examples
              </h4>
              <button
                type="button"
                className="px-4 py-2 bg-accent text-text-primary rounded-lg text-sm font-medium hover:opacity-90"
              >
                Download examples
              </button>
            </div>
            <div>
              <h4 className="text-sm font-serif text-text-primary mb-2 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Galaxy instance (optional)
              </h4>
              <input
                type="url"
                placeholder="https://usegalaxy.org or custom URL"
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" />
              <span className="text-sm text-text-primary">UCSC Genome Browser session export</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
