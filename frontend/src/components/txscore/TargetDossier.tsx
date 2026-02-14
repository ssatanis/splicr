'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Share2, Download, AlertTriangle, Shield } from 'lucide-react';
import { useGeneOverview } from '@/hooks/useTxScore';
import dynamic from 'next/dynamic';
import { generateDossierPDF } from '@/utils/pdfGenerator';

// Use dynamic imports to avoid SSR issues
const StructureViewerCanvas = dynamic(() => import('@/components/StructureViewerCanvas'), { ssr: false });
const GeneNetworkVisualization = dynamic(() => import('@/components/GeneNetworkVisualization'), { ssr: false });

interface TargetDossierProps {
    geneSymbol: string | null;
    onClose: () => void;
}

const Tabs = ({ active, onChange }: { active: string; onChange: (t: string) => void }) => {
    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'safety', label: 'Safety & Selectivity' },
        { id: 'tractability', label: 'Tractability & Modality' },
        { id: 'evidence', label: 'Clinical Evidence' },
    ];

    return (
        <div className="flex border-b border-border mb-6">
            {tabs.map((t) => (
                <button
                    key={t.id}
                    onClick={() => onChange(t.id)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active === t.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
};

export default function TargetDossier({ geneSymbol, onClose }: TargetDossierProps) {
    const [activeTab, setActiveTab] = useState('overview');
    const { data: profile, isLoading } = useGeneOverview(geneSymbol || '');

    if (!geneSymbol) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-6xl h-[85vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
                    id="dossier-content"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="dossier-title"
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                        <div>
                            <h2 id="dossier-title" className="text-2xl font-serif font-bold flex items-center gap-3">
                                {geneSymbol}
                                {isLoading && <span className="text-sm font-sans font-normal text-muted-foreground animate-pulse">Loading...</span>}
                            </h2>
                            <p className="text-sm text-muted-foreground">{profile?.gene?.gene_name || 'Loading gene details...'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => generateDossierPDF('dossier-content', geneSymbol)}
                                className="p-2 hover:bg-muted rounded-full transition-colors"
                                title="Export PDF"
                                aria-label="Export Dossier as PDF"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-full transition-colors"
                                aria-label="Close dossier"
                                title="Close"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {!profile && isLoading ? (
                            <div className="flex bg-muted/20 h-full items-center justify-center rounded-lg">
                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                            </div>
                        ) : profile ? (
                            <>
                                <Tabs active={activeTab} onChange={setActiveTab} />

                                {activeTab === 'overview' && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        {/* Summary Cards */}
                                        <div className="space-y-6">
                                            <section className="bg-muted/30 p-4 rounded-lg border border-border">
                                                <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Key Scores</h3>
                                                <div className="space-y-4">
                                                    {profile.txscores?.[0] ? (
                                                        <>
                                                            <div>
                                                                <div className="flex justify-between mb-1">
                                                                    <span className="text-sm">TxScore (TVS)</span>
                                                                    <span className="font-bold">{profile.txscores[0].tvs.toFixed(2)}</span>
                                                                </div>
                                                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                                                    <div className="h-full bg-primary" style={{ width: `${(profile.txscores[0].tvs || 0) * 100}%` }} />
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                                                <div className="p-2 bg-background rounded border border-border">
                                                                    <div className="font-bold text-emerald-500">{profile.txscores[0].efficacy_score.toFixed(2)}</div>
                                                                    <div className="text-muted-foreground text-[10px]">Efficacy</div>
                                                                </div>
                                                                <div className="p-2 bg-background rounded border border-border">
                                                                    <div className="font-bold text-blue-500">{profile.txscores[0].safety_score.toFixed(2)}</div>
                                                                    <div className="text-muted-foreground text-[10px]">Safety</div>
                                                                </div>
                                                                <div className="p-2 bg-background rounded border border-border">
                                                                    <div className="font-bold text-amber-500">{profile.txscores[0].druggability_score.toFixed(2)}</div>
                                                                    <div className="text-muted-foreground text-[10px]">Druggable</div>
                                                                </div>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="text-sm text-muted-foreground">No scores available.</div>
                                                    )}
                                                </div>
                                            </section>

                                            <section className="bg-muted/30 p-4 rounded-lg border border-border">
                                                <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Target Info</h3>
                                                <dl className="space-y-2 text-sm">
                                                    <div className="flex justify-between">
                                                        <dt className="text-muted-foreground">Protein Class</dt>
                                                        <dd>{profile.gene?.protein_class || 'Unknown'}</dd>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <dt className="text-muted-foreground">Location</dt>
                                                        <dd>{profile.gene?.chromosome}:{profile.gene?.start_position}</dd>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <dt className="text-muted-foreground">Uniprot</dt>
                                                        <dd className="font-mono">{profile.gene?.uniprot_id}</dd>
                                                    </div>
                                                </dl>
                                            </section>
                                        </div>

                                        {/* Central Viz - Network */}
                                        <div className="md:col-span-2 min-h-[400px] border border-border rounded-lg bg-black/5 overflow-hidden relative">
                                            <div className="absolute top-2 left-2 z-10 bg-background/80 px-2 py-1 rounded text-xs shadow-sm border border-border">
                                                Interaction Network
                                            </div>
                                            <div className="w-full h-full flex items-center justify-center">
                                                {/* Pass synthesized genes array for the component */}
                                                <GeneNetworkVisualization
                                                    genes={[{ gene: geneSymbol, logFoldChange: 0 } as any]}
                                                    height={400}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'safety' && (
                                    <div className="space-y-6">
                                        <div className="flex items-start gap-4 p-4 bg-blue-500/10 text-blue-600 rounded-lg border border-blue-500/20">
                                            <Shield className="w-5 h-5 shrink-0 mt-0.5" />
                                            <div>
                                                <h3 className="font-medium">Safety Assessment</h3>
                                                <p className="text-sm opacity-90">Analysis of expression in critical tissues and genetic constraint.</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="border border-border rounded-lg p-4">
                                                <h4 className="font-medium mb-4">Tissue Expression (GTEx)</h4>
                                                <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                                                    {profile.gtex?.length > 0 ? profile.gtex.slice(0, 10).map((t: any, i: number) => (
                                                        <div key={i} className="flex items-center gap-2 text-sm">
                                                            <span className="w-32 truncate" title={t.tissue_name}>{t.tissue_name}</span>
                                                            <div className="flex-1 h-2 bg-muted rounded-full">
                                                                <div className="h-full bg-slate-500" style={{ width: `${Math.min(100, (t.median_tpm / 100) * 100)}%` }} />
                                                            </div>
                                                            <span className="w-12 text-right font-mono text-xs">{t.median_tpm.toFixed(1)}</span>
                                                        </div>
                                                    )) : <div className="text-muted-foreground text-sm">No expression data available.</div>}
                                                </div>
                                            </div>

                                            <div className="border border-border rounded-lg p-4">
                                                <h4 className="font-medium mb-4">Genetic Constraint (gnomAD)</h4>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="p-4 bg-muted/50 rounded text-center">
                                                        <div className="text-3xl font-light">{profile.constraint?.loeuf?.toFixed(2) ?? 'N/A'}</div>
                                                        <div className="text-xs text-muted-foreground uppercase mt-1">LOEUF Score</div>
                                                        <div className="text-[10px] text-muted-foreground mt-2">Lower = More Constrained</div>
                                                    </div>
                                                    <div className="p-4 bg-muted/50 rounded text-center">
                                                        <div className="text-3xl font-light">{profile.constraint?.pli?.toFixed(2) ?? 'N/A'}</div>
                                                        <div className="text-xs text-muted-foreground uppercase mt-1">pLI Score</div>
                                                        <div className="text-[10px] text-muted-foreground mt-2">Higher = Intolerant</div>
                                                    </div>
                                                </div>
                                                {profile.constraint?.loeuf < 0.35 && (
                                                    <div className="mt-4 flex items-center gap-2 text-amber-600 text-sm bg-amber-500/10 p-3 rounded">
                                                        <AlertTriangle className="w-4 h-4" />
                                                        <span>High genetic constraint implies potential toxicity.</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'tractability' && (
                                    <div className="h-full flex flex-col space-y-4">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-medium">3D Structure & Binding Pockets</h3>
                                            <div className="text-sm text-muted-foreground">
                                                AlphaFold pLDDT: <span className="font-bold text-foreground">{profile.structure?.mean_plddt?.toFixed(1) ?? 'N/A'}</span>
                                            </div>
                                        </div>
                                        <div className="flex-1 border border-border rounded-lg overflow-hidden relative min-h-[500px] bg-black/10">
                                            {profile.structure?.structure_url || profile.structure?.uniprot_id ? (
                                                <StructureViewerCanvas
                                                    structureSource={profile.structure?.structure_url ?
                                                        { type: 'file', identifier: profile.structure.structure_url } :
                                                        { type: 'alphafold', identifier: profile.structure.uniprot_id }
                                                    }
                                                />
                                            ) : (
                                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                                    No structure available
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'evidence' && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="border border-border rounded-lg p-4">
                                                <h4 className="font-medium mb-4 flex items-center justify-between">
                                                    <span>Approved Drugs</span>
                                                    <span className="text-xs bg-muted px-2 py-1 rounded">{profile.drugs?.approved?.length || 0}</span>
                                                </h4>
                                                {profile.drugs?.approved?.length > 0 ? (
                                                    <ul className="space-y-2">
                                                        {profile.drugs.approved.map((d: any, i: number) => (
                                                            <li key={i} className="text-sm p-2 bg-muted/30 rounded flex justify-between">
                                                                <span className="font-medium">{d.drug_name}</span>
                                                                <span className="text-muted-foreground text-xs">{d.indication || 'Approved'}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-sm text-muted-foreground italic">No approved drugs found.</p>
                                                )}
                                            </div>

                                            <div className="border border-border rounded-lg p-4">
                                                <h4 className="font-medium mb-4 flex items-center justify-between">
                                                    <span>Clinical Trials</span>
                                                    <span className="text-xs bg-muted px-2 py-1 rounded">{profile.trials?.all?.length || 0}</span>
                                                </h4>
                                                {profile.trials?.all?.length > 0 ? (
                                                    <ul className="space-y-2 max-h-60 overflow-y-auto">
                                                        {profile.trials.all.slice(0, 10).map((t: any, i: number) => (
                                                            <li key={i} className="text-sm p-2 border-b border-border/50 last:border-0">
                                                                <div className="font-medium truncate">{t.title}</div>
                                                                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                                                                    <span>{t.phase || 'N/A'}</span>
                                                                    <span className={t.status === 'Completed' ? 'text-green-600' : ''}>{t.status}</span>
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-sm text-muted-foreground italic">No clinical trials found.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : null}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
