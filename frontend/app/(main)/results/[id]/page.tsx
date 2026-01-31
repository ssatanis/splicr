"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import Button from "@/components/Button";
import VolcanoPlot from "@/components/VolcanoPlot";
import QCCharts from "@/components/QCCharts";
import InteractiveDataTable from "@/components/InteractiveDataTable";
import InteractiveHeatmap from "@/components/InteractiveHeatmap";
import GeneNetworkVisualization from "@/components/GeneNetworkVisualization";
import TimeCourseVisualization from "@/components/TimeCourseVisualization";
import PathwayEnrichmentChart from "@/components/PathwayEnrichmentChart";
import DrugGeneInteractionTable from "@/components/DrugGeneInteractionTable";
import DepMapComparison from "@/components/DepMapComparison";
import SyntheticLethalityPredictor from "@/components/SyntheticLethalityPredictor";
import GeneInfoPopup from "@/components/GeneInfoPopup";
import DrugGeneFinder from "@/components/DrugGeneFinder";
import CollaborationSidebar from "@/components/CollaborationSidebar";
import ReportBuilderModal from "@/components/ReportBuilderModal";
import FigureCustomizationModal from "@/components/FigureCustomizationModal";
import AdvancedAnalysisPanel from "@/components/AdvancedAnalysisPanel";
import ShareAnalysisModal from "@/components/ShareAnalysisModal";
import { useUser } from "@/lib/context/UserContext";
import { realApi } from "@/lib/realApi";
import { Analysis, AnalysisResults } from "@/lib/types";
import { exportAsPDF, exportAsDOCX, exportAsLatex, exportComputationalLog, exportAsZIP } from "@/lib/exportUtils";
import { generatePDF } from "@/lib/export/pdfGenerator";
import {
  Download,
  Share2,
  Trash2,
  Edit2,
  Save,
  X,
  FileText,
  TrendingUp,
  BarChart3,
  Activity,
  Database,
  Star,
  File,
  FileCode,
  Archive,
  Terminal,
  Eye,
  Table,
  Grid3X3,
  Network,
  Clock,
  FlaskConical,
  MessageSquare,
} from "lucide-react";

type TabType = "overview" | "volcano" | "heatmap" | "network" | "timecourse" | "advanced" | "top-hits" | "qc" | "rankings" | "raw-data" | "logs";

interface LogEntry {
  timestamp: string;
  step: string;
  message: string;
  progress: number;
  level: 'info' | 'warning' | 'error' | 'success';
}

export default function ResultsPage() {
  const params = useParams();
  const id = params?.id as string;
  const { analyses, refreshAnalyses } = useUser();
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [analysisFromApi, setAnalysisFromApi] = useState<Analysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [analysisName, setAnalysisName] = useState("");
  const [notes, setNotes] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
  const [collabSidebarOpen, setCollabSidebarOpen] = useState(false);
  const [reportBuilderOpen, setReportBuilderOpen] = useState(false);
  const [figureCustomizationOpen, setFigureCustomizationOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const runTriggeredRef = useRef<string | null>(null);

  const analysisFromList = analyses.find((a) => a.id === id);
  const analysis = analysisFromApi ?? analysisFromList;

  const significantGenes = (() => {
    if (!results) return [] as string[];
    const fromAll = results.allGenes?.filter((g) => g.fdr < 0.05).map((g) => g.gene);
    if (fromAll && fromAll.length > 0) return fromAll;
    const depleted = (results.topHits?.depleted ?? []).map((g) => g.gene);
    const enriched = (results.topHits?.enriched ?? []).map((g) => g.gene);
    return [...new Set([...depleted, ...enriched])];
  })();

  const loadResults = useCallback(async () => {
    setIsLoading(true);
    setAnalysisFromApi(null);
    try {
      const data = await realApi.getResults(id);
      if (data && typeof data === 'object' && 'analysis' in data && data.results === null) {
        setAnalysisFromApi(data.analysis);
        setResults(null);
      } else {
        setAnalysisFromApi(null);
        setResults(data as AnalysisResults | null);
      }
    } catch (error) {
      console.error("Error loading results:", error);
      setResults(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const loadNotes = useCallback(async () => {
    const note = await realApi.getNote(id);
    setNotes(note);
  }, [id]);

  useEffect(() => {
    loadResults();
    loadNotes();
    runTriggeredRef.current = null;
  }, [id, loadResults, loadNotes]);

  // Keep analyses list fresh so we have current status (e.g. running → complete)
  useEffect(() => {
    if (!id) return;
    refreshAnalyses();
  }, [id, refreshAnalyses]);

  // When status is "pending", start the pipeline once (run route runs it to completion)
  useEffect(() => {
    if (!id || !analysis || analysis.status !== "pending" || results) return;
    if (runTriggeredRef.current === id) return;
    runTriggeredRef.current = id;
    realApi.runAnalysis(id).then(() => {
      refreshAnalyses();
      loadResults();
    }).catch(console.error);
  }, [id, analysis?.status, results, refreshAnalyses, loadResults]);

  // Poll for progress when analysis is in progress so the progress bar and logs update
  useEffect(() => {
    const inProgress = analysis && (analysis.status === "running" || analysis.status === "queued" || analysis.status === "pending");
    if (!inProgress || results) return;
    const interval = setInterval(() => {
      refreshAnalyses();
      loadResults();
    }, 2000);
    return () => clearInterval(interval);
  }, [analysis?.id, analysis?.status, results, refreshAnalyses, loadResults]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showExportMenu && !(event.target as HTMLElement).closest('.export-menu-container')) {
        setShowExportMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  const saveNotes = async () => {
    await realApi.saveNote(id, notes);
  };

  const handleRetry = async () => {
    if (!id || isRetrying) return;
    setIsRetrying(true);
    try {
      await realApi.runAnalysis(id);
      await refreshAnalyses();
      await loadResults();
    } catch (e) {
      console.error("Retry failed:", e);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleExportCompletePDF = async () => {
    setShowExportMenu(false);
    if (!results || !analysis) return;
    const volcanoEl = document.getElementById('volcano-plot');
    try {
      const blob = await generatePDF({
        analysisName: analysis.name ?? 'Analysis',
        library: analysis.libraryType ?? '—',
        method: (analysis.algorithm ?? []).join(', ') || '—',
        results: results.allGenes ?? [],
        volcanoPlotElement: volcanoEl ?? undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${analysis.name ?? 'splicr'}-report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF export failed:', e);
    }
  };

  const handleExport = async (format: string) => {
    setShowExportMenu(false);
    if (format === 'pdf-complete') {
      await handleExportCompletePDF();
      return;
    }

    const analysisData = {
      id: id,
      date: new Date().toLocaleDateString(),
      user: 'researcher@cornell.edu',
      algorithms: analysis?.algorithm || ['MAGeCK', 'BAGEL2', 'DrugZ'],
      totalGenes: results?.summary.totalGenes || 0,
      significantHits: results?.summary.significantHits || 0,
      enriched: results?.summary.enriched || 0,
      depleted: results?.summary.depleted || 0,
      totalReads: results?.qcMetrics.totalReads?.toLocaleString() || '0',
      files: analysis?.fileKeys?.map((name: string, idx: number) => ({
        name,
        size: 'N/A',
        condition: analysis?.sampleLabels?.[idx]?.condition || 'Unknown',
        replicate: analysis?.sampleLabels?.[idx]?.replicate || idx + 1
      })) || [],
      topDepleted: results?.topHits.depleted.slice(0, 10).map((gene, idx) => ({
        gene: gene.gene,
        lfc: gene.logFoldChange,
        fdr: gene.fdr,
        pvalue: gene.pValue || 0.0001,
        rank: idx + 1
      })) || [],
      library: analysis?.libraryType || 'Brunello',
      logs: results?.logs || []
    };

    switch (format) {
      case 'pdf':
        await exportAsPDF(analysisData);
        break;
      case 'docx':
        await exportAsDOCX(analysisData);
        break;
      case 'latex':
        exportAsLatex(analysisData);
        break;
      case 'log':
        exportComputationalLog(analysisData);
        break;
      case 'zip':
        await exportAsZIP(analysisData);
        break;
      case 'csv':
        exportAsCSV(results);
        break;
    }
  };

  const exportAsCSV = (data: AnalysisResults | null) => {
    if (!data || !data.allGenes) return;

    const headers = ['Rank', 'Gene', 'sgRNA Count', 'Log2 FC', 'P-value', 'FDR'];
    const rows = data.allGenes.map((gene: any) => [
      gene.rank,
      gene.gene,
      gene.sgrnaCount,
      gene.logFoldChange.toFixed(4),
      gene.pValue.toExponential(3),
      gene.fdr.toFixed(6)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splicr-results-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (analysis) setAnalysisName(analysis.name);
  }, [analysis]);

  const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "volcano", label: "Volcano Plot", icon: TrendingUp },
    { id: "heatmap", label: "Heatmap", icon: Grid3X3 },
    { id: "network", label: "Gene Network", icon: Network },
    { id: "timecourse", label: "Time-Course", icon: Clock },
    { id: "advanced", label: "Advanced Analysis", icon: FlaskConical },
    { id: "top-hits", label: "Top Hits", icon: Star },
    { id: "qc", label: "QC Metrics", icon: BarChart3 },
    { id: "rankings", label: "Gene Rankings", icon: Table },
    { id: "raw-data", label: "Raw Data", icon: Database },
    { id: "logs", label: "Analysis Logs", icon: Terminal },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-[260px] min-h-screen">
        <div className="max-w-[1600px] mx-auto px-8 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-12">
            <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
              <div className="flex-1 min-w-0">
                {isEditingName ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      type="text"
                      value={analysisName}
                      onChange={(e) => setAnalysisName(e.target.value)}
                      className="text-3xl md:text-5xl font-serif text-text-primary bg-transparent border-b-2 border-text-primary focus:outline-none w-full max-w-md"
                      autoFocus
                    />
                    <button onClick={() => setIsEditingName(false)} className="p-2 hover:bg-accent rounded-lg transition-colors">
                      <Save className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                    <button onClick={() => setIsEditingName(false)} className="p-2 hover:bg-background rounded-lg transition-colors">
                      <X className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-3xl md:text-5xl font-serif text-text-primary">{analysisName || "Results"}</h1>
                    <button onClick={() => setIsEditingName(true)} className="p-2 hover:bg-background rounded-lg transition-colors opacity-0 hover:opacity-100">
                      <Edit2 className="w-5 h-5 text-text-secondary" strokeWidth={1.5} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  <span className="text-sm text-text-secondary font-serif">
                    {analysis?.createdAt && new Date(analysis.createdAt).toLocaleDateString()}
                  </span>
                  {analysis?.algorithm?.map((alg) => (
                    <span key={alg} className="px-3 py-1 bg-accent/20 rounded-lg text-xs font-serif text-text-primary">
                      {alg.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setReportBuilderOpen(true)}
                  className="inline-flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" strokeWidth={1.5} />
                  Create Report
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setFigureCustomizationOpen(true)}
                  className="inline-flex items-center gap-2"
                >
                  <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
                  Customize Figure
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setCollabSidebarOpen(true)}
                  className="inline-flex items-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
                  Collaboration
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShareModalOpen(true)}
                  className="inline-flex items-center gap-2"
                >
                  <Share2 className="w-4 h-4" strokeWidth={1.5} />
                  Share
                </Button>
                <Link href="/analyses">
                  <Button variant="secondary" size="md">
                    <Share2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Back to analyses
                  </Button>
                </Link>
                <div className="relative export-menu-container">
                  <Button variant="primary" size="md" onClick={() => setShowExportMenu(!showExportMenu)}>
                    <Download className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Download results
                  </Button>

                  {showExportMenu && (
                    <div className="absolute right-0 mt-2 w-64 bg-surface rounded-lg shadow-lg border border-border py-2 z-50">
                      <button
                        onClick={() => handleExport('csv')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <Table className="w-5 h-5 text-green-500" />
                        <div>
                          <div className="font-medium text-text-primary">CSV Data</div>
                          <div className="text-xs text-text-tertiary">Gene rankings table</div>
                        </div>
                      </button>

                      <button
                        onClick={() => handleExport('pdf-complete')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <FileText className="w-5 h-5 text-[#6ABF36]" />
                        <div>
                          <div className="font-medium text-text-primary">Complete PDF Report</div>
                          <div className="text-xs text-text-tertiary">Volcano plot + top hits table</div>
                        </div>
                      </button>
                      <button
                        onClick={() => handleExport('pdf')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <FileText className="w-5 h-5 text-red-500" />
                        <div>
                          <div className="font-medium text-text-primary">PDF Report</div>
                          <div className="text-xs text-text-tertiary">Summary + top depleted</div>
                        </div>
                      </button>

                      <button
                        onClick={() => handleExport('docx')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <File className="w-5 h-5 text-blue-500" />
                        <div>
                          <div className="font-medium text-text-primary">Word Document</div>
                          <div className="text-xs text-text-tertiary">Editable DOCX format</div>
                        </div>
                      </button>

                      <button
                        onClick={() => handleExport('latex')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <FileCode className="w-5 h-5 text-green-500" />
                        <div>
                          <div className="font-medium text-text-primary">LaTeX Source</div>
                          <div className="text-xs text-text-tertiary">Publication-ready .tex</div>
                        </div>
                      </button>

                      <button
                        onClick={() => handleExport('log')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <Terminal className="w-5 h-5 text-purple-500" />
                        <div>
                          <div className="font-medium text-text-primary">Computational Log</div>
                          <div className="text-xs text-text-tertiary">Pipeline execution details</div>
                        </div>
                      </button>

                      <div className="border-t border-border my-2"></div>

                      <button
                        onClick={() => handleExport('zip')}
                        className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors"
                      >
                        <Archive className="w-5 h-5 text-orange-500" />
                        <div>
                          <div className="font-medium text-text-primary">Complete Package</div>
                          <div className="text-xs text-text-tertiary">ZIP with all formats + data</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-2 mb-12 border-b border-border overflow-x-auto"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`flex items-center gap-2 px-6 py-4 font-serif transition-all duration-200 relative whitespace-nowrap ${
                    activeTab === tab.id ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={1.5} />
                  <span>{tab.label}</span>
                  {activeTab === tab.id && (
                    <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
                  )}
                </button>
              );
            })}
          </motion.div>

          <AnimatePresence mode="wait">
            {isLoading ? (
              <LoadingState key="loading" />
            ) : results ? (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === "overview" && <OverviewTab results={results} />}
                {activeTab === "volcano" && <VolcanoTab results={results} />}
                {activeTab === "heatmap" && <HeatmapTab results={results} />}
                {activeTab === "network" && <NetworkTab results={results} />}
                {activeTab === "timecourse" && <TimeCourseTab results={results} />}
                {activeTab === "advanced" && <AdvancedTab results={results} analysisId={id} onResultsUpdate={loadResults} />}
                {activeTab === "top-hits" && <TopHitsTab results={results} onGeneClick={setSelectedGene} />}
                {activeTab === "qc" && <QCTab results={results} />}
                {activeTab === "rankings" && <RankingsTab results={results} analysisId={id} onGeneClick={setSelectedGene} />}
                {activeTab === "raw-data" && <RawDataTab results={results} analysisId={id} />}
                {activeTab === "logs" && <LogsTab results={results} />}
              </motion.div>
            ) : (
              <div key="error" className="bg-surface rounded-2xl p-12 border border-border text-center">
                {analysis ? (
                  <>
                    <p className="text-text-primary font-serif text-lg">{analysis.name ?? "Analysis"}</p>
                    <p className="text-text-tertiary text-sm mt-1">
                      Status: <span className="capitalize">{analysis.status}</span>
                      {(analysis.status === "running" || analysis.status === "queued" || analysis.status === "pending") && typeof analysis.progress === "number" && ` · ${Math.round(analysis.progress)}%`}
                    </p>
                    {(analysis.status === "running" || analysis.status === "queued" || analysis.status === "pending") ? (
                      <>
                        <p className="text-text-secondary font-serif mt-4">Analysis in progress — results will appear when the run finishes.</p>
                        {(analysis.currentStep ?? analysis.status === "pending") && (
                          <p className="text-text-tertiary text-sm mt-2 font-medium">
                            {analysis.status === "pending" ? "Starting pipeline…" : analysis.currentStep ?? "Running…"}
                          </p>
                        )}
                        <div className="max-w-md mx-auto mt-6">
                          <div className="h-3 bg-background rounded-full overflow-hidden border border-border-light">
                            <motion.div
                              className="h-full bg-accent rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, Math.max(0, analysis.progress ?? 0))}%` }}
                              transition={{ duration: 0.5, ease: "easeOut" }}
                            />
                          </div>
                          <p className="text-text-tertiary text-xs mt-2">
                            {analysis.status === "pending" ? "Starting…" : "Still being analyzed"}
                          </p>
                        </div>
                        {analysis.logs && analysis.logs.length > 0 && (
                          <div className="max-w-lg mx-auto mt-6 text-left bg-background/50 rounded-lg border border-border p-4 max-h-32 overflow-y-auto">
                            <p className="text-text-tertiary text-xs font-medium mb-2">Recent steps</p>
                            <ul className="space-y-1 text-xs text-text-secondary">
                              {analysis.logs.slice(-5).map((log: { progress: number; message: string }, i: number) => (
                                <li key={i} className="flex items-center gap-2">
                                  <span className="text-text-tertiary shrink-0">{Math.round(log.progress)}%</span>
                                  <span>{log.message}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="flex items-center justify-center gap-4 mt-6">
                          <Button variant="outline" onClick={() => { refreshAnalyses(); loadResults(); }} disabled={isRetrying}>Refresh</Button>
                          <Link href="/analyses">
                            <Button variant="outline">Back to My analyses</Button>
                          </Link>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center gap-4 mt-6">
                        <Button variant="outline" onClick={handleRetry} disabled={isRetrying}>{isRetrying ? "Starting…" : "Retry"}</Button>
                        <Link href="/analyses" className="text-accent font-serif inline-block">Back to My analyses</Link>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-text-secondary font-serif">Could not load results.</p>
                    <div className="flex items-center justify-center gap-4 mt-6">
                      <Button variant="outline" onClick={handleRetry} disabled={isRetrying}>{isRetrying ? "Starting…" : "Retry"}</Button>
                      <Link href="/analyses" className="text-accent font-serif inline-block">Back to My analyses</Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </AnimatePresence>

          {results && significantGenes.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-12"
            >
              <DrugGeneFinder significantGenes={significantGenes} />
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-16"
          >
            <h3 className="text-2xl font-serif text-text-primary mb-6">Analysis notes</h3>
            <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                placeholder="Add notes about this analysis"
                className="w-full h-32 bg-transparent border-none resize-none font-serif text-text-primary focus:outline-none placeholder:text-text-tertiary"
              />
            </div>
          </motion.div>
        </div>
      </main>

      {selectedGene && (
        <GeneInfoPopup
          geneSymbol={selectedGene}
          onClose={() => setSelectedGene(null)}
        />
      )}

      <CollaborationSidebar
        analysisId={id}
        targetType="analysis"
        isOpen={collabSidebarOpen}
        onClose={() => setCollabSidebarOpen(false)}
      />

      <ReportBuilderModal
        open={reportBuilderOpen}
        onClose={() => setReportBuilderOpen(false)}
        analysisName={analysisName || analysis?.name || "Report"}
        analysisContext={
          results && analysis
            ? {
                analysisName: analysis.name ?? "Screen Analysis",
                libraryName: analysis.libraryType ?? "Brunello",
                method: (analysis.algorithm ?? ["MAGeCK"]).join(", "),
                totalGenes: results.summary?.totalGenes ?? 0,
                significantHits: results.summary?.significantHits ?? 0,
                enriched: results.summary?.enriched ?? 0,
                depleted: results.summary?.depleted ?? 0,
                fdrThreshold: 0.05,
                lfcThreshold: 1,
                topDepleted: results.topHits?.depleted?.slice(0, 20).map((g) => ({
                  gene: g.gene,
                  logFoldChange: g.logFoldChange,
                  fdr: g.fdr,
                })),
                topEnriched: results.topHits?.enriched?.slice(0, 20).map((g) => ({
                  gene: g.gene,
                  logFoldChange: g.logFoldChange,
                  fdr: g.fdr,
                })),
              }
            : undefined
        }
      />

      <FigureCustomizationModal
        open={figureCustomizationOpen}
        onClose={() => setFigureCustomizationOpen(false)}
        figureName={`${analysisName || analysis?.name || "volcano"}-volcano`}
        volcanoData={
          results?.volcanoData?.map((p) => ({
            gene: p.gene,
            log2FC: p.log2FC,
            negLog10P: p.negLog10P,
            fdr: p.fdr,
            isSignificant: p.isSignificant ?? false,
          })) ?? []
        }
      />

      <ShareAnalysisModal
        analysisId={id}
        analysisName={analysisName || analysis?.name || "Analysis"}
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-surface rounded-2xl p-32 shadow-card border border-border">
      <div className="flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-2 border-text-tertiary border-t-accent rounded-full animate-spin mb-6" />
        <p className="text-text-secondary font-serif">Loading results...</p>
      </div>
    </div>
  );
}

function OverviewTab({ results }: { results: AnalysisResults }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard label="Total genes" value={results.summary.totalGenes.toLocaleString()} />
        <SummaryCard label="Significant hits" value={results.summary.significantHits.toLocaleString()} color="text-accent" />
        <SummaryCard label="Enriched" value={results.summary.enriched.toLocaleString()} color="text-success" />
        <SummaryCard label="Depleted" value={results.summary.depleted.toLocaleString()} color="text-error" />
      </div>
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-6">Quality metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <QCMetric label="Read depth" value={`${(results.qcMetrics.totalReads / 1e6).toFixed(1)}M`} />
          <QCMetric label="Mapping rate" value={`${typeof results.qcMetrics.mappingRate === 'number' ? results.qcMetrics.mappingRate.toFixed(1) : results.qcMetrics.mappingRate}%`} />
          <QCMetric label="Zero count" value={`${typeof results.qcMetrics.zeroCounts === 'number' ? results.qcMetrics.zeroCounts.toFixed(1) : results.qcMetrics.zeroCounts}%`} />
          <QCMetric label="Coverage" value={`${typeof results.qcMetrics.libraryCoverage === 'number' ? results.qcMetrics.libraryCoverage.toFixed(1) : results.qcMetrics.libraryCoverage}%`} />
        </div>
      </div>
    </div>
  );
}

function VolcanoTab({ results }: { results: AnalysisResults }) {
  return (
    <div id="volcano-plot" className="w-full">
      <VolcanoPlot
        data={results.volcanoData ?? undefined}
        fdrThreshold={0.05}
        lfcThreshold={1.0}
      />
    </div>
  );
}

function HeatmapTab({ results }: { results: AnalysisResults }) {
  const sampleNames = results.qcMetrics?.sampleStats?.map((s) => s.name) ?? [];
  const correlations = results.qcMetrics?.correlations ?? [];
  const countMatrix = results.rawData?.countMatrix ?? {};
  return (
    <InteractiveHeatmap
      correlations={correlations}
      sampleNames={sampleNames}
      countMatrix={Object.keys(countMatrix).length > 0 ? countMatrix : undefined}
      height={560}
    />
  );
}

function NetworkTab({ results }: { results: AnalysisResults }) {
  const significantGenes = [
    ...(results.topHits?.depleted ?? []).slice(0, 25),
    ...(results.topHits?.enriched ?? []).slice(0, 25),
  ].map((g) => ({
    gene: g.gene,
    sgrnaCount: g.sgrnaCount,
    logFoldChange: g.logFoldChange,
    pValue: g.pValue,
    fdr: g.fdr,
    rank: g.rank,
  }));
  return (
    <GeneNetworkVisualization
      genes={significantGenes}
      maxGenes={50}
      requiredScore={400}
      height={560}
    />
  );
}

function TimeCourseTab({ results }: { results: AnalysisResults }) {
  const genes = (results.allGenes ?? [])
    .filter((g) => g.fdr < 0.1)
    .slice(0, 30)
    .map((g) => ({
      gene: g.gene,
      sgrnaCount: g.sgrnaCount,
      logFoldChange: g.logFoldChange,
      pValue: g.pValue,
      fdr: g.fdr,
      rank: g.rank,
    }));
  return (
    <TimeCourseVisualization
      genes={genes}
      maxGenes={15}
      height={520}
    />
  );
}

function AdvancedTab({
  results,
  analysisId,
  onResultsUpdate,
}: {
  results: AnalysisResults;
  analysisId: string;
  onResultsUpdate?: () => void;
}) {
  const significantGenes = (results.allGenes ?? [])
    .filter((g) => g.fdr < 0.05)
    .map((g) => g.gene)
    .slice(0, 200);
  const topDepleted = (results.topHits?.depleted ?? []).map((g) => g.gene).slice(0, 50);
  const topEnriched = (results.topHits?.enriched ?? []).map((g) => g.gene).slice(0, 50);
  const genesForPathwayAndDrug = [...new Set([...topDepleted, ...topEnriched])].slice(0, 100);
  const genesForDepMap = (results.allGenes ?? []).slice(0, 100).map((g) => ({
    gene: g.gene,
    sgrnaCount: g.sgrnaCount,
    logFoldChange: g.logFoldChange,
    pValue: g.pValue,
    fdr: g.fdr,
    rank: g.rank,
  }));
  const genesForSyntheticLethality = topDepleted.length >= 2 ? topDepleted : significantGenes.slice(0, 50);

  return (
    <div className="space-y-12">
      <section>
        <AdvancedAnalysisPanel analysisId={analysisId} onResultsUpdate={onResultsUpdate} />
      </section>
      <section>
        <h3 className="text-xl font-serif text-text-primary mb-4">Pathway enrichment</h3>
        <PathwayEnrichmentChart
          genes={genesForPathwayAndDrug}
          topN={10}
          pValueCutoff={0.05}
          height={420}
        />
      </section>
      <section>
        <h3 className="text-xl font-serif text-text-primary mb-4">Drug–gene interactions</h3>
        <DrugGeneInteractionTable genes={genesForPathwayAndDrug} limitPerGene={15} />
      </section>
      <section>
        <h3 className="text-xl font-serif text-text-primary mb-4">DepMap comparison</h3>
        <DepMapComparison genes={genesForDepMap} maxGenes={80} height={400} />
      </section>
      <section>
        <h3 className="text-xl font-serif text-text-primary mb-4">Genetic interaction predictor</h3>
        <SyntheticLethalityPredictor genes={genesForSyntheticLethality} minScore={0.4} />
      </section>
    </div>
  );
}

function TopHitsTab({ results, onGeneClick }: { results: AnalysisResults; onGeneClick?: (gene: string) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-6">Top 20 depleted genes</h3>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {results.topHits.depleted.length > 0 ? (
            results.topHits.depleted.map((gene, index) => (
              <div key={gene.gene} className="flex items-center justify-between p-4 bg-background rounded-xl hover:bg-error/5 transition-colors">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-serif text-text-tertiary w-8">{index + 1}</span>
                  {onGeneClick ? (
                    <button
                      type="button"
                      onClick={() => onGeneClick(gene.gene)}
                      className="font-serif text-text-primary font-medium text-[#6ABF36] hover:underline text-left"
                    >
                      {gene.gene}
                    </button>
                  ) : (
                    <span className="font-serif text-text-primary font-medium">{gene.gene}</span>
                  )}
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-sm text-error font-mono">LFC: {gene.logFoldChange.toFixed(2)}</span>
                  <span className="text-sm text-text-secondary font-mono">FDR: {gene.fdr.toFixed(4)}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-text-tertiary font-serif text-center py-8">No significant depleted genes found</p>
          )}
        </div>
      </div>
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-6">Top 20 enriched genes</h3>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {results.topHits.enriched.length > 0 ? (
            results.topHits.enriched.map((gene, index) => (
              <div key={gene.gene} className="flex items-center justify-between p-4 bg-background rounded-xl hover:bg-success/5 transition-colors">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-serif text-text-tertiary w-8">{index + 1}</span>
                  {onGeneClick ? (
                    <button
                      type="button"
                      onClick={() => onGeneClick(gene.gene)}
                      className="font-serif text-text-primary font-medium text-[#6ABF36] hover:underline text-left"
                    >
                      {gene.gene}
                    </button>
                  ) : (
                    <span className="font-serif text-text-primary font-medium">{gene.gene}</span>
                  )}
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-sm text-success font-mono">LFC: {gene.logFoldChange.toFixed(2)}</span>
                  <span className="text-sm text-text-secondary font-mono">FDR: {gene.fdr.toFixed(4)}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-text-tertiary font-serif text-center py-8">No significant enriched genes found</p>
          )}
        </div>
      </div>
    </div>
  );
}

function QCTab({ results }: { results: AnalysisResults }) {
  // Pass real QC data to the component
  const readCountData = results.qcMetrics.sampleStats?.map((s: any) => ({
    sample: s.name,
    reads: s.totalReads / 1e6
  })) || [];

  const coverageData = results.qcMetrics.sampleStats?.map((s: any) => ({
    sample: s.name,
    coverage: (s.uniqueSgRNAs / 77000) * 100 // Approximate library coverage
  })) || [];

  return (
    <QCCharts
      readCounts={readCountData}
      correlation={results.qcMetrics.correlations}
      coverage={coverageData}
      giniCoefficient={results.qcMetrics.giniCoefficient}
      sampleStats={results.qcMetrics.sampleStats}
    />
  );
}

function RankingsTab({
  results,
  analysisId,
  onGeneClick,
}: {
  results: AnalysisResults;
  analysisId: string;
  onGeneClick?: (gene: string) => void;
}) {
  return (
    <InteractiveDataTable
      data={results.allGenes || []}
      analysisId={analysisId}
      onGeneClick={onGeneClick}
    />
  );
}

function RawDataTab({ results, analysisId }: { results: AnalysisResults; analysisId: string }) {
  const [viewingData, setViewingData] = useState<string | null>(null);
  const [dataContent, setDataContent] = useState<any>(null);

  const handleViewData = (type: string) => {
    if (type === 'counts' && results.rawData?.countMatrix) {
      setDataContent(results.rawData.countMatrix);
      setViewingData('counts');
    } else if (type === 'genes' && results.allGenes) {
      setDataContent(results.allGenes);
      setViewingData('genes');
    }
  };

  const handleDownload = (type: string) => {
    let content = '';
    let filename = '';

    if (type === 'counts' && results.rawData?.countMatrix) {
      const data = results.rawData.countMatrix;
      const sgRNAs = Object.keys(data);
      const samples = sgRNAs.length > 0 ? Object.keys(data[sgRNAs[0]]) : [];

      content = ['sgRNA', ...samples].join('\t') + '\n';
      sgRNAs.forEach(sgRNA => {
        content += [sgRNA, ...samples.map(s => data[sgRNA][s])].join('\t') + '\n';
      });
      filename = `splicr-counts-${analysisId}.tsv`;
    } else if (type === 'genes' && results.allGenes) {
      content = 'Rank\tGene\tsgRNAs\tLog2FC\tP-value\tFDR\n';
      results.allGenes.forEach((gene: any) => {
        content += `${gene.rank}\t${gene.gene}\t${gene.sgrnaCount}\t${gene.logFoldChange.toFixed(4)}\t${gene.pValue.toExponential(3)}\t${gene.fdr.toFixed(6)}\n`;
      });
      filename = `splicr-gene-summary-${analysisId}.tsv`;
    }

    const blob = new Blob([content], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const files = [
    { name: "sgRNA Count Matrix", type: "counts", size: results.rawData?.countMatrix ? `${Object.keys(results.rawData.countMatrix).length} sgRNAs` : "N/A" },
    { name: "Gene Summary", type: "genes", size: results.allGenes ? `${results.allGenes.length} genes` : "N/A" },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-6">Raw data files</h3>
        <div className="space-y-3">
          {files.map((file) => (
            <div key={file.name} className="flex items-center justify-between p-6 bg-background rounded-xl hover:bg-accent/5 transition-colors">
              <div className="flex items-center gap-4">
                <FileText className="w-6 h-6 text-text-secondary" strokeWidth={1.5} />
                <div>
                  <div className="font-serif text-text-primary">{file.name}</div>
                  <div className="text-sm text-text-tertiary">{file.size}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => handleViewData(file.type)}>
                  <Eye className="w-4 h-4 mr-2" strokeWidth={1.5} />
                  View
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDownload(file.type)}>
                  <Download className="w-4 h-4" strokeWidth={1.5} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data Viewer Modal */}
      {viewingData && dataContent && (
        <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-serif text-text-primary">
              {viewingData === 'counts' ? 'sgRNA Count Matrix' : 'Gene Summary'}
            </h3>
            <Button variant="secondary" size="sm" onClick={() => setViewingData(null)}>
              <X className="w-4 h-4 mr-2" strokeWidth={1.5} />
              Close
            </Button>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            {viewingData === 'genes' ? (
              <table className="w-full">
                <thead className="bg-background sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Rank</th>
                    <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Gene</th>
                    <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">sgRNAs</th>
                    <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">Log₂ FC</th>
                    <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">P-value</th>
                    <th className="px-4 py-3 text-left text-sm font-serif text-text-secondary">FDR</th>
                  </tr>
                </thead>
                <tbody>
                  {dataContent.slice(0, 100).map((gene: any) => (
                    <tr key={gene.gene} className="border-b border-border-light hover:bg-background">
                      <td className="px-4 py-3 text-sm font-mono">{gene.rank}</td>
                      <td className="px-4 py-3 text-sm font-mono font-medium text-accent">{gene.gene}</td>
                      <td className="px-4 py-3 text-sm font-mono">{gene.sgrnaCount}</td>
                      <td className={`px-4 py-3 text-sm font-mono ${gene.logFoldChange < 0 ? 'text-error' : 'text-success'}`}>
                        {gene.logFoldChange.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">{gene.pValue.toExponential(2)}</td>
                      <td className="px-4 py-3 text-sm font-mono">{gene.fdr.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-text-secondary font-mono">
                <p className="mb-4">Count matrix with {Object.keys(dataContent).length} sgRNAs</p>
                <pre className="bg-background p-4 rounded-lg overflow-x-auto">
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(dataContent).slice(0, 10)
                    ),
                    null,
                    2
                  )}
                  {Object.keys(dataContent).length > 10 && '\n\n... and more'}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LogsTab({ results }: { results: AnalysisResults }) {
  const logs = results.logs || [];

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'success': return 'text-success';
      case 'error': return 'text-error';
      case 'warning': return 'text-warning';
      default: return 'text-text-secondary';
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'warning': return '⚠';
      default: return '→';
    }
  };

  return (
    <div className="bg-surface rounded-2xl shadow-card border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h3 className="text-xl font-serif text-text-primary">Analysis Pipeline Log</h3>
        <p className="text-sm text-text-secondary mt-2">Complete computational log with timestamps</p>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <div className="font-mono text-sm">
          {logs.length > 0 ? (
            logs.map((log: { timestamp: string; step: string; message: string; progress: number; level: string }, index: number) => (
              <div
                key={index}
                className={`px-6 py-3 border-b border-border-light hover:bg-background transition-colors ${
                  log.level === 'error' ? 'bg-error/5' : log.level === 'success' ? 'bg-success/5' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  <span className="text-text-tertiary whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`${getLevelColor(log.level)} w-4 flex-shrink-0`}>
                    {getLevelIcon(log.level)}
                  </span>
                  <span className="text-text-primary">{log.message}</span>
                  <span className="text-text-tertiary ml-auto whitespace-nowrap">
                    {log.progress}%
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-text-tertiary">
              No logs available for this analysis
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color = "text-text-primary" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
      <div className={`text-5xl font-serif ${color} mb-3`}>{value}</div>
      <div className="text-sm font-serif text-text-secondary">{label}</div>
    </div>
  );
}

function QCMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-serif text-text-primary mb-2">{value}</div>
      <div className="text-sm text-text-secondary font-serif">{label}</div>
    </div>
  );
}
