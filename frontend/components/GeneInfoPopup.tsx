'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Loader2 } from 'lucide-react';

export interface GeneInfoData {
  symbol: string;
  name: string;
  entrezId: number | null;
  ensemblId: string | null;
  uniprotId: string | null;
  summary: string | null;
  aliases: string[];
  location: { chromosome: string; start: number; end: number; strand: string } | null;
  pathways: { source: string; name: string; id: string }[] | null;
  goTerms: {
    BP: { id: string; term: string }[];
    MF: { id: string; term: string }[];
    CC: { id: string; term: string }[];
  };
  proteinDomains: { source: string; id: string; name: string }[] | null;
  links: {
    ncbi: string | null;
    ensembl: string | null;
    uniprot: string | null;
    genecards: string | null;
  };
}

interface GeneInfoPopupProps {
  geneSymbol: string;
  onClose: () => void;
}

type TabId = 'overview' | 'pathways' | 'function';

export default function GeneInfoPopup({ geneSymbol, onClose }: GeneInfoPopupProps) {
  const [data, setData] = useState<GeneInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/gene-info?symbol=${encodeURIComponent(geneSymbol)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Gene not found' : 'Failed to load gene info');
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [geneSymbol]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-surface dark:bg-gray-900 rounded-2xl shadow-elevated border border-border dark:border-gray-700 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-gradient-to-r from-[#6ABF36] to-[#5AA82F] px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium text-black">
              {data?.symbol ?? geneSymbol}
              {data?.name && (
                <span className="ml-2 font-normal text-sm hidden sm:inline">{data.name}</span>
              )}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-black/10 text-black transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
              <Loader2 className="w-10 h-10 text-[#6ABF36] animate-spin mb-4" strokeWidth={1.5} />
              <p className="font-serif">Loading gene information…</p>
            </div>
          )}

          {error && !loading && (
            <div className="px-6 py-12 text-center">
              <p className="text-error font-serif">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 px-4 py-2 rounded-xl bg-accent/20 text-accent font-serif hover:bg-accent/30"
              >
                Close
              </button>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex border-b border-border dark:border-gray-700">
                {(['overview', 'pathways', 'function'] as TabId[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 px-4 py-3 font-serif text-sm capitalize transition-colors ${
                      activeTab === tab
                        ? 'text-[#6ABF36] border-b-2 border-[#6ABF36] bg-[#6ABF36]/5'
                        : 'text-text-secondary hover:text-text-primary hover:bg-background/50'
                    }`}
                  >
                    {tab === 'function' ? 'Function' : tab}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <AnimatePresence mode="wait">
                  {activeTab === 'overview' && (
                    <motion.div
                      key="overview"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      className="space-y-6"
                    >
                      {data.summary && (
                        <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                          <h3 className="text-sm font-serif font-medium text-text-secondary mb-2">Summary</h3>
                          <p className="text-text-primary font-serif text-sm leading-relaxed">{data.summary}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {data.entrezId != null && (
                          <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                            <span className="text-xs text-text-tertiary font-serif">Entrez ID</span>
                            <p className="font-mono text-text-primary">{data.entrezId}</p>
                          </div>
                        )}
                        {data.ensemblId && (
                          <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                            <span className="text-xs text-text-tertiary font-serif">Ensembl</span>
                            <p className="font-mono text-text-primary text-sm truncate">{data.ensemblId}</p>
                          </div>
                        )}
                        {data.uniprotId && (
                          <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                            <span className="text-xs text-text-tertiary font-serif">UniProt</span>
                            <p className="font-mono text-text-primary">{data.uniprotId}</p>
                          </div>
                        )}
                      </div>
                      {data.location && (
                        <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                          <h3 className="text-sm font-serif font-medium text-text-secondary mb-2">Genomic location</h3>
                          <p className="font-mono text-text-primary text-sm">
                            Chr {data.location.chromosome}: {data.location.start?.toLocaleString()}–
                            {data.location.end?.toLocaleString()} ({data.location.strand ?? '?'})
                          </p>
                        </div>
                      )}
                      {data.aliases?.length > 0 && (
                        <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                          <h3 className="text-sm font-serif font-medium text-text-secondary mb-2">Aliases</h3>
                          <div className="flex flex-wrap gap-2">
                            {data.aliases.slice(0, 15).map((a) => (
                              <span
                                key={a}
                                className="px-2 py-1 rounded-lg bg-accent/10 text-accent text-xs font-mono"
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {data.proteinDomains && data.proteinDomains.length > 0 && (
                        <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                          <h3 className="text-sm font-serif font-medium text-text-secondary mb-2">Protein domains</h3>
                          <ul className="space-y-1 text-sm">
                            {data.proteinDomains.slice(0, 10).map((d, i) => (
                              <li key={i} className="font-mono text-text-primary">
                                {d.source}: {d.id} {d.name && `— ${d.name}`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700">
                        <h3 className="text-sm font-serif font-medium text-text-secondary mb-3">External links</h3>
                        <div className="flex flex-wrap gap-2">
                          {data.links.ncbi && (
                            <a
                              href={data.links.ncbi}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#6ABF36]/10 text-[#6ABF36] hover:bg-[#6ABF36]/20 font-serif text-sm transition-colors"
                            >
                              NCBI <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {data.links.ensembl && (
                            <a
                              href={data.links.ensembl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#6ABF36]/10 text-[#6ABF36] hover:bg-[#6ABF36]/20 font-serif text-sm transition-colors"
                            >
                              Ensembl <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {data.links.uniprot && (
                            <a
                              href={data.links.uniprot}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#6ABF36]/10 text-[#6ABF36] hover:bg-[#6ABF36]/20 font-serif text-sm transition-colors"
                            >
                              UniProt <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {data.links.genecards && (
                            <a
                              href={data.links.genecards}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#6ABF36]/10 text-[#6ABF36] hover:bg-[#6ABF36]/20 font-serif text-sm transition-colors"
                            >
                              GeneCards <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeTab === 'pathways' && (
                    <motion.div
                      key="pathways"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                    >
                      {data.pathways && data.pathways.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {data.pathways.map((p, i) => (
                            <span
                              key={i}
                              className="px-4 py-2 rounded-xl border border-[#6ABF36]/30 bg-[#6ABF36]/5 text-text-primary font-serif text-sm"
                            >
                              <span className="text-text-tertiary text-xs">{p.source}</span>{' '}
                              {p.name} ({p.id})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-text-tertiary font-serif">No pathway data available.</p>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'function' && (
                    <motion.div
                      key="function"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      className="space-y-6"
                    >
                      {(['BP', 'MF', 'CC'] as const).map((cat) => {
                        const terms = data.goTerms?.[cat] ?? [];
                        if (terms.length === 0) return null;
                        return (
                          <div
                            key={cat}
                            className="rounded-xl bg-background dark:bg-gray-800 p-4 border border-border dark:border-gray-700"
                          >
                            <h3 className="text-sm font-serif font-medium text-text-secondary mb-2">
                              {cat === 'BP' ? 'Biological process' : cat === 'MF' ? 'Molecular function' : 'Cellular component'}
                            </h3>
                            <ul className="space-y-1.5">
                              {terms.slice(0, 15).map((t, i) => (
                                <li key={i} className="text-sm text-text-primary font-serif">
                                  <span className="font-mono text-[#6ABF36]">{t.id}</span> {t.term}
                                </li>
                              ))}
                              {terms.length > 15 && (
                                <li className="text-text-tertiary text-sm">+{terms.length - 15} more</li>
                              )}
                            </ul>
                          </div>
                        );
                      })}
                      {!data.goTerms?.BP?.length && !data.goTerms?.MF?.length && !data.goTerms?.CC?.length && (
                        <p className="text-text-tertiary font-serif">No GO terms available.</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
