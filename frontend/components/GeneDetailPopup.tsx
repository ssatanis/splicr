'use client';

import { useEffect, useState, useRef } from 'react';
import { X, ExternalLink, Loader2, BookOpen, Pill, FileText, Network, Info, AlertCircle, Activity, Microscope, Copy, Check, Download, TrendingUp } from 'lucide-react';

interface GeneDetailPopupProps {
  gene: string;
  log2FC?: number;
  fdr?: number;
  degree?: number;
  position: { x: number; y: number };
  onClose: () => void;
}

interface GeneInfo {
  symbol: string;
  name: string;
  summary: string | null;
  entrezId: number | null;
  ensemblId: string | null;
  pathways: Array<{ source: string; name: string; id: string }> | null;
  goTerms: {
    BP: Array<{ id: string; term: string }>;
    MF: Array<{ id: string; term: string }>;
    CC: Array<{ id: string; term: string }>;
  };
  links: {
    ncbi: string | null;
    genecards: string | null;
    uniprot: string | null;
  };
}

interface Literature {
  articles: Array<{
    pmid: string;
    title: string;
    authors: string;
    journal: string;
    year: string;
    link: string;
  }>;
  count: number;
}

interface GeneDetails {
  depmap?: {
    dependencyScore: number | null;
    isEssential: boolean;
  };
  drugs?: Array<{
    name: string;
    mechanism: string;
    phase: string;
  }>;
  clinicalTrials?: Array<{
    nctId: string;
    title: string;
    status: string;
    phase: string;
    url: string;
  }>;
  interactions?: Array<{
    protein: string;
    score: number;
    experimentalEvidence: boolean;
  }>;
}

interface ExpressionData {
  tissueExpression?: Array<{
    tissue: string;
    expression: number;
    specificity: string;
  }>;
  diseases?: Array<{
    disease: string;
    score: number;
    source: string;
    description?: string;
  }>;
  isEssential?: boolean;
  conservationScore?: number;
}

type TabType = 'overview' | 'literature' | 'drugs' | 'interactions' | 'expression' | 'diseases';

export default function GeneDetailPopup({ gene, log2FC, fdr, degree, position, onClose }: GeneDetailPopupProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [geneInfo, setGeneInfo] = useState<GeneInfo | null>(null);
  const [literature, setLiterature] = useState<Literature | null>(null);
  const [details, setDetails] = useState<GeneDetails | null>(null);
  const [expressionData, setExpressionData] = useState<ExpressionData | null>(null);
  const [loading, setLoading] = useState<Record<TabType, boolean>>({
    overview: true,
    literature: false,
    drugs: false,
    interactions: false,
    expression: false,
    diseases: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [currentPosition, setCurrentPosition] = useState({ x: 0, y: 0 });
  const popupRef = useRef<HTMLDivElement>(null);

  // Calculate popup position to keep it on screen
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const updatePosition = () => {
      const maxWidth = 500;
      const maxHeight = 550;
      const padding = 20;
      
      let left = position.x;
      let top = position.y;

      // Keep within viewport
      if (left + maxWidth > window.innerWidth - padding) {
        left = window.innerWidth - maxWidth - padding;
      }
      if (left < padding) {
        left = padding;
      }
      if (top + maxHeight > window.innerHeight - padding) {
        top = window.innerHeight - maxHeight - padding;
      }
      if (top < padding) {
        top = padding;
      }

      setCurrentPosition({ x: left, y: top });

      setPopupStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        maxWidth: `${maxWidth}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: 9999,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [position]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only allow dragging from header
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true);
      const rect = popupRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const padding = 20;
      const maxWidth = 500;
      const maxHeight = 550;

      let newX = e.clientX - dragOffset.x;
      let newY = e.clientY - dragOffset.y;

      // Keep within viewport
      newX = Math.max(padding, Math.min(newX, window.innerWidth - maxWidth - padding));
      newY = Math.max(padding, Math.min(newY, window.innerHeight - maxHeight - padding));

      setCurrentPosition({ x: newX, y: newY });
      setPopupStyle(prev => ({
        ...prev,
        left: `${newX}px`,
        top: `${newY}px`,
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Fetch gene info (overview)
  useEffect(() => {
    if (activeTab !== 'overview') return;
    if (geneInfo) return; // Already loaded

    setLoading((prev) => ({ ...prev, overview: true }));
    setError(null);

    fetch(`/api/gene-info?symbol=${gene}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setGeneInfo(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading((prev) => ({ ...prev, overview: false })));
  }, [gene, activeTab, geneInfo]);

  // Fetch literature when tab is active
  useEffect(() => {
    if (activeTab !== 'literature') return;
    if (literature) return; // Already loaded

    setLoading((prev) => ({ ...prev, literature: true }));

    fetch(`/api/literature?gene=${gene}&limit=10`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLiterature(data);
      })
      .catch(() => setLiterature({ articles: [], count: 0 }))
      .finally(() => setLoading((prev) => ({ ...prev, literature: false })));
  }, [gene, activeTab, literature]);

  // Fetch detailed info (drugs, trials, interactions) when tabs are active
  useEffect(() => {
    if (!['drugs', 'interactions'].includes(activeTab)) return;
    if (details) return; // Already loaded

    setLoading((prev) => ({ ...prev, drugs: true, interactions: true }));

    fetch(`/api/gene-details?gene=${gene}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDetails(data);
      })
      .catch(() => setDetails({}))
      .finally(() =>
        setLoading((prev) => ({ ...prev, drugs: false, interactions: false }))
      );
  }, [gene, activeTab, details]);

  // Fetch expression & disease data when tabs are active
  useEffect(() => {
    if (!['expression', 'diseases'].includes(activeTab)) return;
    if (expressionData) return; // Already loaded

    setLoading((prev) => ({ ...prev, expression: true, diseases: true }));

    fetch(`/api/expression?gene=${gene}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setExpressionData(data);
      })
      .catch(() => setExpressionData({}))
      .finally(() =>
        setLoading((prev) => ({ ...prev, expression: false, diseases: false }))
      );
  }, [gene, activeTab, expressionData]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportGeneData = () => {
    const data = {
      gene,
      screenData: { log2FC, fdr, degree },
      info: geneInfo,
      literature: literature?.articles.slice(0, 5),
      drugs: details?.drugs?.slice(0, 5),
      interactions: details?.interactions?.slice(0, 10),
      expression: expressionData,
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${gene}_data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderOverview = () => {
    if (loading.overview) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4 rounded-lg bg-error/10 text-error text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      );
    }

    if (!geneInfo) return null;

    return (
      <div className="space-y-4">
        {/* Screen Statistics */}
        {(log2FC !== undefined || fdr !== undefined || degree !== undefined) && (
          <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
            <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-2">Screen Results</h4>
            <div className="grid grid-cols-3 gap-3">
              {log2FC !== undefined && (
                <div>
                  <div className="text-xs text-text-tertiary">Log₂ FC</div>
                  <div className={`text-lg font-semibold ${log2FC < -0.5 ? 'text-error' : log2FC > 0.5 ? 'text-success' : 'text-text-primary'}`}>
                    {log2FC.toFixed(2)}
                  </div>
                </div>
              )}
              {fdr !== undefined && (
                <div>
                  <div className="text-xs text-text-tertiary">FDR</div>
                  <div className="text-lg font-semibold text-text-primary">{fdr.toExponential(2)}</div>
                </div>
              )}
              {degree !== undefined && (
                <div>
                  <div className="text-xs text-text-tertiary">Network Degree</div>
                  <div className="text-lg font-semibold text-text-primary">{degree}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Gene Summary */}
        <div>
          <h4 className="text-sm font-semibold text-text-primary mb-1">{geneInfo.name || gene}</h4>
          {geneInfo.summary && (
            <p className="text-sm text-text-secondary leading-relaxed line-clamp-6">{geneInfo.summary}</p>
          )}
        </div>

        {/* IDs & Links */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {geneInfo.entrezId && (
            <div>
              <span className="text-text-tertiary">Entrez ID:</span>{' '}
              <span className="text-text-primary font-mono">{geneInfo.entrezId}</span>
            </div>
          )}
          {geneInfo.ensemblId && (
            <div>
              <span className="text-text-tertiary">Ensembl:</span>{' '}
              <span className="text-text-primary font-mono text-xs">{geneInfo.ensemblId}</span>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-2">Quick Links</h4>
          <div className="grid grid-cols-2 gap-2">
            {geneInfo.links.ncbi && (
              <a
                href={geneInfo.links.ncbi}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
              >
                <span>NCBI Gene</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {geneInfo.links.genecards && (
              <a
                href={geneInfo.links.genecards}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
              >
                <span>GeneCards</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {geneInfo.links.uniprot && (
              <a
                href={geneInfo.links.uniprot}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
              >
                <span>UniProt</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <a
              href={`https://depmap.org/portal/gene/${gene}?tab=overview`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <span>DepMap</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://string-db.org/cgi/network?identifiers=${gene}&species=9606`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <span>STRING</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://www.proteinatlas.org/search/${gene}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <span>Protein Atlas</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://www.genecards.org/cgi-bin/carddisp.pl?gene=${gene}&keywords=crispr`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <span>CRISPR Info</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://maayanlab.cloud/Harmonizome/gene/${gene}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 text-xs rounded border border-border bg-background hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <span>Harmonizome</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Pathways */}
        {geneInfo.pathways && geneInfo.pathways.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-2">Pathways</h4>
            <div className="space-y-1">
              {geneInfo.pathways.slice(0, 5).map((pathway, i) => (
                <div key={i} className="text-xs text-text-secondary">
                  <span className="text-accent font-medium">{pathway.source}:</span> {pathway.name}
                </div>
              ))}
              {geneInfo.pathways.length > 5 && (
                <div className="text-xs text-text-tertiary italic">
                  +{geneInfo.pathways.length - 5} more pathways
                </div>
              )}
            </div>
          </div>
        )}

        {/* GO Terms */}
        {(geneInfo.goTerms.BP.length > 0 || geneInfo.goTerms.MF.length > 0) && (
          <div>
            <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-2">Gene Ontology</h4>
            <div className="space-y-2">
              {geneInfo.goTerms.BP.length > 0 && (
                <div>
                  <div className="text-xs text-accent font-medium mb-1">Biological Process:</div>
                  <div className="text-xs text-text-secondary space-y-0.5">
                    {geneInfo.goTerms.BP.slice(0, 3).map((term, i) => (
                      <div key={i}>• {term.term}</div>
                    ))}
                  </div>
                </div>
              )}
              {geneInfo.goTerms.MF.length > 0 && (
                <div>
                  <div className="text-xs text-accent font-medium mb-1">Molecular Function:</div>
                  <div className="text-xs text-text-secondary space-y-0.5">
                    {geneInfo.goTerms.MF.slice(0, 3).map((term, i) => (
                      <div key={i}>• {term.term}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLiterature = () => {
    if (loading.literature) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      );
    }

    if (!literature || literature.count === 0) {
      return (
        <div className="text-center py-8 text-text-tertiary text-sm">
          No recent publications found for {gene}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary mb-3">
          Found {literature.count} relevant publications
        </div>
        {literature.articles.map((article) => (
          <a
            key={article.pmid}
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-3 rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-all"
          >
            <h5 className="text-sm font-medium text-text-primary mb-1 line-clamp-2">
              {article.title}
            </h5>
            <div className="text-xs text-text-tertiary space-y-0.5">
              <div>{article.authors}</div>
              <div>
                {article.journal} {article.year && `(${article.year})`}
              </div>
              <div className="flex items-center gap-1 text-accent mt-1">
                PubMed: {article.pmid} <ExternalLink className="w-3 h-3" />
              </div>
            </div>
          </a>
        ))}
      </div>
    );
  };

  const renderDrugs = () => {
    if (loading.drugs) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      );
    }

    const hasDrugs = details?.drugs && details.drugs.length > 0;
    const hasTrials = details?.clinicalTrials && details.clinicalTrials.length > 0;

    if (!hasDrugs && !hasTrials) {
      return (
        <div className="text-center py-8 text-text-tertiary text-sm">
          No drug or clinical trial data found for {gene}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Drugs */}
        {hasDrugs && (
          <div>
            <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-2 flex items-center gap-2">
              <Pill className="w-4 h-4" /> Known Drugs ({details.drugs!.length})
            </h4>
            <div className="space-y-2">
              {details.drugs!.slice(0, 8).map((drug, i) => (
                <div key={i} className="p-2 rounded bg-background border border-border">
                  <div className="text-sm font-medium text-text-primary">{drug.name}</div>
                  <div className="text-xs text-text-secondary mt-0.5">{drug.mechanism}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent">
                      {drug.phase}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clinical Trials */}
        {hasTrials && (
          <div>
            <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Clinical Trials ({details.clinicalTrials!.length})
            </h4>
            <div className="space-y-2">
              {details.clinicalTrials!.slice(0, 5).map((trial) => (
                <a
                  key={trial.nctId}
                  href={trial.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-2 rounded border border-border hover:border-accent/50 hover:bg-accent/5 transition-all"
                >
                  <div className="text-sm font-medium text-text-primary line-clamp-2 mb-1">
                    {trial.title}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent">
                      {trial.phase}
                    </span>
                    <span className="text-xs text-text-tertiary">{trial.status}</span>
                    <span className="text-xs text-accent flex items-center gap-1">
                      {trial.nctId} <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderInteractions = () => {
    if (loading.interactions) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      );
    }

    if (!details?.interactions || details.interactions.length === 0) {
      return (
        <div className="text-center py-8 text-text-tertiary text-sm">
          No protein interaction data found for {gene}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-text-tertiary">
            Top {details.interactions.length} protein interactions (STRING database)
          </div>
          <button
            onClick={() => copyToClipboard(details.interactions!.map(i => i.protein).join(', '))}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copy list
          </button>
        </div>
        <div className="space-y-1">
          {details.interactions.map((interaction, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2 rounded hover:bg-accent/5 transition-colors border border-transparent hover:border-accent/20"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Network className="w-4 h-4 text-accent flex-shrink-0" />
                <span className="text-sm font-medium text-text-primary truncate">{interaction.protein}</span>
                {interaction.experimentalEvidence && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-success/10 text-success flex-shrink-0" title="Experimentally validated">
                    Exp
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <div className="w-24 h-2 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{ 
                      width: `${Math.max(5, interaction.score * 100)}%`,
                      backgroundColor: interaction.score > 0.7 ? '#10B981' : interaction.score > 0.4 ? '#6ABF36' : '#F59E0B'
                    }}
                  />
                </div>
                <span className="text-xs font-medium text-text-primary w-10 text-right">
                  {(interaction.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 rounded-lg bg-background border border-border text-xs text-text-tertiary">
          <strong>Confidence scores:</strong> High (&gt;70%) = strong evidence, Medium (40-70%) = moderate evidence, Low (&lt;40%) = weak evidence
        </div>
      </div>
    );
  };

  const renderExpression = () => {
    if (loading.expression) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      );
    }

    if (!expressionData?.tissueExpression || expressionData.tissueExpression.length === 0) {
      return (
        <div className="text-center py-8 text-text-tertiary text-sm">
          No tissue expression data available for {gene}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Essentiality indicator */}
        {expressionData.isEssential !== undefined && (
          <div className={`p-3 rounded-lg border ${expressionData.isEssential ? 'bg-error/10 border-error/20' : 'bg-success/10 border-success/20'}`}>
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className={`w-4 h-4 ${expressionData.isEssential ? 'text-error' : 'text-success'}`} />
              <span className="text-sm font-semibold text-text-primary">
                {expressionData.isEssential ? 'Essential Gene' : 'Non-Essential Gene'}
              </span>
            </div>
            <p className="text-xs text-text-secondary">
              {expressionData.isEssential 
                ? 'This gene is likely essential for cell survival in most contexts' 
                : 'This gene may not be essential in most cell lines'}
            </p>
          </div>
        )}

        {/* Tissue Expression */}
        <div>
          <h4 className="text-xs font-semibold text-text-tertiary uppercase mb-3">
            Tissue Expression Profile
          </h4>
          <div className="space-y-2">
            {expressionData.tissueExpression.map((tissue, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-primary capitalize">{tissue.tissue}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    tissue.specificity === 'high' ? 'bg-success/20 text-success' :
                    tissue.specificity === 'medium' ? 'bg-accent/20 text-accent' :
                    tissue.specificity === 'low' ? 'bg-border text-text-tertiary' :
                    'bg-error/10 text-error'
                  }`}>
                    {tissue.specificity}
                  </span>
                </div>
                <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent to-success transition-all duration-300"
                    style={{ width: `${Math.min(100, (tissue.expression / 100) * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-text-tertiary">
                  TPM: {tissue.expression.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderDiseases = () => {
    if (loading.diseases) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      );
    }

    if (!expressionData?.diseases || expressionData.diseases.length === 0) {
      return (
        <div className="text-center py-8 text-text-tertiary text-sm">
          No disease associations found for {gene}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary mb-3">
          Found {expressionData.diseases.length} disease associations (Open Targets)
        </div>
        <div className="space-y-2">
          {expressionData.diseases.map((disease, i) => (
            <div
              key={i}
              className="p-3 rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h5 className="text-sm font-medium text-text-primary flex-1">{disease.disease}</h5>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-16 h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${disease.score * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-accent">
                    {(disease.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              {disease.description && (
                <p className="text-xs text-text-secondary line-clamp-2">{disease.description}</p>
              )}
              <div className="mt-2 text-xs text-text-tertiary">
                Source: {disease.source}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: Info },
    { id: 'interactions' as TabType, label: 'Interactions', icon: Network },
    { id: 'expression' as TabType, label: 'Expression', icon: Activity },
    { id: 'diseases' as TabType, label: 'Diseases', icon: Microscope },
    { id: 'drugs' as TabType, label: 'Drugs', icon: Pill },
    { id: 'literature' as TabType, label: 'Papers', icon: BookOpen },
  ];

  return (
    <>
      {/* Minimal Backdrop - semi-transparent, doesn't block interaction */}
      <div
        className="fixed inset-0 bg-black/5 z-[9998] pointer-events-none"
      />

      {/* Popup */}
      <div
        ref={popupRef}
        className={`bg-surface/95 backdrop-blur-md rounded-xl shadow-2xl border-2 overflow-hidden transition-shadow ${
          isDragging ? 'shadow-elevated border-accent cursor-grabbing' : 'shadow-2xl border-border cursor-default'
        }`}
        style={popupStyle}
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Draggable */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm drag-handle cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2 flex-1 min-w-0 drag-handle">
            <div className="flex flex-col gap-0.5 drag-handle opacity-50">
              <div className="w-1 h-1 rounded-full bg-text-tertiary drag-handle"></div>
              <div className="w-1 h-1 rounded-full bg-text-tertiary drag-handle"></div>
              <div className="w-1 h-1 rounded-full bg-text-tertiary drag-handle"></div>
            </div>
            <div className="flex-1 min-w-0 drag-handle">
              <h3 className="text-lg font-semibold text-text-primary drag-handle select-none">{gene}</h3>
              {geneInfo && (
                <p className="text-xs text-text-tertiary truncate drag-handle select-none">{geneInfo.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(gene)}
              className="p-2 rounded hover:bg-surface transition-colors"
              title="Copy gene symbol"
            >
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-text-tertiary" />}
            </button>
            <button
              onClick={exportGeneData}
              className="p-2 rounded hover:bg-surface transition-colors"
              title="Export all data"
            >
              <Download className="w-4 h-4 text-text-tertiary" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-surface transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-text-tertiary" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-background/80 backdrop-blur-sm px-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-tertiary hover:text-text-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto bg-surface/90" style={{ maxHeight: '420px' }}>
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'literature' && renderLiterature()}
          {activeTab === 'drugs' && renderDrugs()}
          {activeTab === 'interactions' && renderInteractions()}
          {activeTab === 'expression' && renderExpression()}
          {activeTab === 'diseases' && renderDiseases()}
        </div>
      </div>
    </>
  );
}
