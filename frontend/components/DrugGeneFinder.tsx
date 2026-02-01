'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Pill, ExternalLink } from 'lucide-react';

const MAX_GENES_TO_QUERY = 100; // Query up to 100 significant genes for drugs (varies by analysis)

interface DrugGeneFinderProps {
  /** All significant genes from this analysis (FDR < 0.05); we query up to MAX_GENES_TO_QUERY for drugs. */
  significantGenes: string[];
  /** Total genes in the screen/library (e.g. 18,166) for context. */
  totalGenesInScreen?: number;
}

interface DrugItem {
  name: string;
  conceptId: string | null;
  approved: boolean;
  antiNeoplastic?: boolean;
  interactionTypes: { type: string; directionality: string }[];
  sources: string[];
  pmids: string[];
}

interface GeneDrugResult {
  gene: string;
  geneName: string;
  totalInteractions: number;
  drugs: DrugItem[];
}

interface CombinationItem {
  drugA: string;
  drugB: string;
  targetedGenesA: string[];
  targetedGenesB: string[];
  mechanismA: string;
  mechanismB: string;
  synergyScore: number;
  rationale: string;
  evidenceStrength: string;
}

type TabId = 'drugs' | 'combinations';

export default function DrugGeneFinder({ significantGenes, totalGenesInScreen }: DrugGeneFinderProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('drugs');
  const [drugResults, setDrugResults] = useState<{
    results: GeneDrugResult[];
    summary: { totalGenes: number; totalDrugs: number; approvedDrugs: number };
  } | null>(null);
  const [combinations, setCombinations] = useState<CombinationItem[]>([]);

  const genes = significantGenes.slice(0, MAX_GENES_TO_QUERY);
  const hasGenes = genes.length > 0;
  const significantCount = significantGenes.length;

  const handleFindDrugs = async () => {
    if (!hasGenes) return;
    setLoading(true);
    setError(null);
    setDrugResults(null);
    setCombinations([]);
    try {
      const genesParam = genes.join(',');
      // Always force refresh to get fresh data from DGIdb API
      const [getRes, postRes] = await Promise.all([
        fetch(`/api/drug-gene?genes=${encodeURIComponent(genesParam)}&force=true`),
        genes.length >= 2
          ? fetch('/api/drug-gene', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ genes: genes.slice(0, 50) }),
            })
          : Promise.resolve(null),
      ]);
      if (!getRes.ok) {
        const errBody = await getRes.json().catch(() => ({}));
        throw new Error(errBody?.error ?? errBody?.details ?? 'Failed to fetch drug-gene data');
      }
      const getData = await getRes.json();
      const resultsList = getData.results ?? [];
      const summary = getData.summary ?? { totalGenes: 0, totalDrugs: 0, approvedDrugs: 0 };
      setDrugResults({ results: resultsList, summary });
      if (postRes?.ok) {
        const postData = await postRes.json();
        setCombinations(postData.combinations ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface dark:bg-gray-900 rounded-2xl shadow-card border border-border dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-border dark:border-gray-700">
        <h3 className="text-xl font-serif text-text-primary">Drug–gene finder</h3>
        <p className="text-sm text-text-secondary mt-1">
          Find FDA-approved drugs and predicted combinations for your significant genes.
        </p>
        {totalGenesInScreen != null || significantCount > 0 ? (
          <p className="text-xs text-text-tertiary mt-2">
            {totalGenesInScreen != null && (
              <>This analysis has <strong>{totalGenesInScreen.toLocaleString()}</strong> genes in the screen.</>
            )}
            {significantCount > 0 && (
              <> <strong>{significantCount.toLocaleString()}</strong> are significant (FDR &lt; 0.05). We search drugs for up to <strong>{MAX_GENES_TO_QUERY}</strong> of them.</>
            )}
          </p>
        ) : null}
        {hasGenes ? (
          <button
            type="button"
            onClick={handleFindDrugs}
            disabled={loading}
            className="mt-4 px-5 py-2.5 rounded-xl bg-[#6ABF36] hover:bg-[#5AA82F] text-white font-serif font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                Finding drugs…
              </>
            ) : (
              <>
                <Pill className="w-4 h-4" strokeWidth={2} />
                Find drugs
              </>
            )}
          </button>
        ) : (
          <p className="mt-4 text-text-tertiary font-serif text-sm">No significant genes (FDR &lt; 0.05) to search.</p>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 py-3 px-4 rounded-xl bg-error/10 text-error font-serif text-sm">
          {error}
        </div>
      )}

      {drugResults && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-6 py-4 bg-background/50 dark:bg-gray-800/50">
            <div className="rounded-xl p-4 border border-border dark:border-gray-700">
              <div className="text-2xl font-serif text-text-primary">{drugResults.summary.totalGenes}</div>
              <div className="text-xs text-text-secondary font-serif">Genes queried</div>
            </div>
            <div className="rounded-xl p-4 border border-border dark:border-gray-700">
              <div className="text-2xl font-serif text-text-primary">{drugResults.summary.totalDrugs}</div>
              <div className="text-xs text-text-secondary font-serif">Total drugs</div>
            </div>
            <div className="rounded-xl p-4 border border-border dark:border-gray-700">
              <div className="text-2xl font-serif text-[#6ABF36]">{drugResults.summary.approvedDrugs}</div>
              <div className="text-xs text-text-secondary font-serif">FDA approved</div>
            </div>
            <div className="rounded-xl p-4 border border-border dark:border-gray-700">
              <div className="text-2xl font-serif text-[#6ABF36]">{combinations.length}</div>
              <div className="text-xs text-text-secondary font-serif">Combinations</div>
            </div>
          </div>

          <div className="flex border-b border-border dark:border-gray-700">
            <button
              type="button"
              onClick={() => setActiveTab('drugs')}
              className={`flex-1 px-4 py-3 font-serif text-sm transition-colors ${
                activeTab === 'drugs'
                  ? 'text-[#6ABF36] border-b-2 border-[#6ABF36] bg-[#6ABF36]/5'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Individual drugs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('combinations')}
              className={`flex-1 px-4 py-3 font-serif text-sm transition-colors ${
                activeTab === 'combinations'
                  ? 'text-[#6ABF36] border-b-2 border-[#6ABF36] bg-[#6ABF36]/5'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Predicted combinations
            </button>
          </div>

          <div className="p-6">
            <AnimatePresence mode="wait">
              {activeTab === 'drugs' && (
                <motion.div
                  key="drugs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-8"
                >
                  {drugResults.results.map((row, idx) => (
                    <motion.div
                      key={row.gene}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="rounded-xl border border-border dark:border-gray-700 overflow-hidden"
                    >
                      <div className="px-4 py-3 bg-background dark:bg-gray-800 font-serif font-medium text-text-primary">
                        {row.gene}
                        {row.geneName !== row.gene && (
                          <span className="ml-2 text-sm font-normal text-text-secondary">{row.geneName}</span>
                        )}
                        <span className="ml-2 text-xs text-text-tertiary">({row.totalInteractions} drugs)</span>
                      </div>
                      <div className="p-4 flex flex-wrap gap-3">
                        {row.drugs.length === 0 ? (
                          <p className="text-text-tertiary text-sm font-serif">No drugs found.</p>
                        ) : (
                          row.drugs.slice(0, 30).map((drug, i) => (
                            <div
                              key={i}
                              className="rounded-xl p-4 border border-border dark:border-gray-700 bg-surface dark:bg-gray-900 hover:shadow-card transition-shadow min-w-[200px]"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-serif font-semibold text-[#6ABF36] text-text-primary">
                                  {drug.name}
                                </span>
                                {drug.approved && (
                                  <span className="shrink-0 px-2 py-0.5 rounded-lg bg-[#6ABF36]/20 text-[#6ABF36] text-xs font-serif">
                                    FDA
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 text-xs text-text-secondary font-serif">
                                {drug.interactionTypes?.map((t) => t.type).filter(Boolean).join(', ') || '—'}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {drug.pmids?.length > 0 && (
                                  <a
                                    href={`https://pubmed.ncbi.nlm.nih.gov/${drug.pmids[0]}/`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-[#6ABF36] hover:underline font-serif"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    PubMed
                                  </a>
                                )}
                                <a
                                  href={`https://go.drugbank.com/unearth/q?query=${encodeURIComponent(drug.name)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-[#6ABF36] hover:underline font-serif"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  DrugBank
                                </a>
                                <a
                                  href={`https://clinicaltrials.gov/search?term=${encodeURIComponent(drug.name)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-[#6ABF36] hover:underline font-serif"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Trials
                                </a>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {activeTab === 'combinations' && (
                <motion.div
                  key="combinations"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  {combinations.length === 0 ? (
                    <p className="text-text-tertiary font-serif">
                      No combinations (need at least 2 genes with approved drugs).
                    </p>
                  ) : (
                    combinations.map((combo, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="rounded-xl border border-border dark:border-gray-700 overflow-hidden bg-surface dark:bg-gray-900"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-background dark:bg-gray-800">
                          <div className="font-serif text-lg text-text-primary">
                            <span className="font-semibold text-[#6ABF36]">{combo.drugA}</span>
                            <span className="mx-2 text-text-secondary">+</span>
                            <span className="font-semibold text-[#6ABF36]">{combo.drugB}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-mono font-semibold text-[#6ABF36]">
                              {combo.synergyScore.toFixed(2)}
                            </span>
                            <span className="text-xs text-text-tertiary font-serif">synergy</span>
                            <span className="px-2 py-0.5 rounded-lg bg-[#6ABF36]/20 text-[#6ABF36] text-xs font-serif">
                              {combo.evidenceStrength}
                            </span>
                          </div>
                        </div>
                        <div className="p-4 border-t border-border dark:border-gray-700">
                          <p className="text-sm text-text-secondary font-serif mb-4">{combo.rationale}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="rounded-lg p-3 bg-background dark:bg-gray-800 border border-border dark:border-gray-700">
                              <div className="text-xs font-serif text-text-tertiary mb-1">Drug A targets</div>
                              <div className="font-mono text-sm text-text-primary">
                                {combo.targetedGenesA?.join(', ') ?? '—'}
                              </div>
                              <div className="text-xs text-text-secondary mt-1">{combo.mechanismA}</div>
                            </div>
                            <div className="rounded-lg p-3 bg-background dark:bg-gray-800 border border-border dark:border-gray-700">
                              <div className="text-xs font-serif text-text-tertiary mb-1">Drug B targets</div>
                              <div className="font-mono text-sm text-text-primary">
                                {combo.targetedGenesB?.join(', ') ?? '—'}
                              </div>
                              <div className="text-xs text-text-secondary mt-1">{combo.mechanismB}</div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}
