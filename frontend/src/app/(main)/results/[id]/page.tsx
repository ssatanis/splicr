"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams } from "next/navigation";
import Link from "next/link";
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
import DrugGeneFinder, { type DrugGeneFinderProps } from "@/components/DrugGeneFinder";
import CollaborationSidebar from "@/components/CollaborationSidebar";
import ReportBuilderModal from "@/components/ReportBuilderModal";
import FigureCustomizationModal from "@/components/FigureCustomizationModal";
import AdvancedAnalysisPanel from "@/components/AdvancedAnalysisPanel";
import ShareAnalysisModal from "@/components/ShareAnalysisModal";
import ScreenIntegrationPanel from "@/components/ScreenIntegrationPanel";
import QCStatusSummaryCard from "@/components/QCStatusSummaryCard";
import { useUser } from "@/lib/context/UserContext";
import { realApi } from "@/lib/realApi";
import { Analysis, AnalysisResults } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import type { QCMetrics as ComprehensiveQCMetrics } from "@/lib/analysis/qcMetrics";
import { assessGiniQuality } from "@/lib/analysis/qcMetrics";
import { exportAsPDF, exportAsDOCX, exportAsLatex, exportComputationalLog, exportAsZIP } from "@/lib/exportUtils";
import { generatePDF } from "@/lib/export/pdfGenerator";
import { createPortal } from "react-dom";
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
  Pill,
  ArrowLeft,
  Box,
  Info,
} from "lucide-react";

type TabType = "overview" | "volcano" | "heatmap" | "network" | "timecourse" | "advanced" | "top-hits" | "qc" | "rankings" | "raw-data" | "logs" | "drug-finder";

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
  const [integrationPanelOpen, setIntegrationPanelOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [queueWarning, setQueueWarning] = useState<string | null>(null);
  const runTriggeredRef = useRef<string | null>(null);
  const queuedAtRef = useRef<number | null>(null);
  const [headerRoot, setHeaderRoot] = useState<HTMLElement | null>(null);

  // Drug search state - lifted to parent to persist across tab switches
  const [drugSearchLoading, setDrugSearchLoading] = useState(false);
  const [drugSearchError, setDrugSearchError] = useState<string | null>(null);
  const [drugSearchResults, setDrugSearchResults] = useState<any | null>(null);
  const [drugSearchProgress, setDrugSearchProgress] = useState(0);
  const [drugSearchProgressMessage, setDrugSearchProgressMessage] = useState('');
  const drugSearchAbortController = useRef<AbortController | null>(null);

  const analysisFromList = analyses.find((a) => a.id === id);
  const analysis = analysisFromApi ?? analysisFromList;

  // Memoize significant genes calculation for performance
  const significantGenes = useMemo(() => {
    if (!results) return [] as string[];
    const fromAll = results.allGenes?.filter((g) => g.fdr < 0.05).map((g) => g.gene);
    if (fromAll && fromAll.length > 0) return fromAll;
    const depleted = (results.topHits?.depleted ?? []).map((g) => g.gene);
    const enriched = (results.topHits?.enriched ?? []).map((g) => g.gene);
    return [...new Set([...depleted, ...enriched])];
  }, [results]);

  const hitGenesForStructure = useMemo(() => {
    if (!results?.allGenes) return [];
    return [...results.allGenes]
      .filter((g) => g.fdr < 0.05)
      .sort((a, b) => Math.abs(b.logFoldChange) - Math.abs(a.logFoldChange))
      .slice(0, 20);
  }, [results?.allGenes]);

  // Optimized loadResults with better caching and deduplication
  const loadResults = useCallback(async () => {
    // Only show loading on initial load, not on polling updates
    const isInitialLoad = !results && !analysisFromApi;
    if (isInitialLoad) {
      setIsLoading(true);
    }
    
    try {
      const data = await realApi.getResults(id);
      if (data && typeof data === 'object' && 'analysis' in data && data.results === null) {
        // Only update if changed to avoid unnecessary re-renders
        setAnalysisFromApi((prev) => {
          const dataAnalysis = data.analysis;
          if (!prev || prev.id !== dataAnalysis.id || prev.status !== dataAnalysis.status || prev.progress !== dataAnalysis.progress) {
            return dataAnalysis;
          }
          return prev;
        });
        if (results !== null) {
          setResults(null);
        }
      } else {
        if (analysisFromApi !== null) {
          setAnalysisFromApi(null);
        }
        // Only update results if they've actually changed
        setResults((prev) => {
          const newResults = data as AnalysisResults | null;
          if (!prev && !newResults) return prev;
          if (!prev || !newResults) return newResults;
          // Simple check - in production you might want a deep comparison
          if (prev.summary?.totalGenes !== newResults.summary?.totalGenes ||
              prev.summary?.significantHits !== newResults.summary?.significantHits) {
            return newResults;
          }
          return prev;
        });
      }
    } catch (error) {
      console.error("Error loading results:", error);
      // Don't clear results on error if we already have them
      if (!results) {
        setResults(null);
      }
    } finally {
      if (isInitialLoad) {
        setIsLoading(false);
      }
    }
  }, [id, results, analysisFromApi]);

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
  // Only refresh on mount, not on every render
  useEffect(() => {
    if (!id) return;
    refreshAnalyses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When status is "pending", start the pipeline once (run route runs it to completion)
  useEffect(() => {
    if (!id || !analysis || analysis.status !== "pending" || results) return;
    if (runTriggeredRef.current === id) return;
    runTriggeredRef.current = id;
    realApi.runAnalysis(id).then(() => {
      refreshAnalyses();
      loadResults();
    }).catch(console.error);
  }, [id, analysis, results, refreshAnalyses, loadResults]);

  // Poll for progress when analysis is in progress (worker uses status 'processing', UI treats as running)
  const inProgressStatuses = ["running", "queued", "pending", "processing"] as const;
  const isInProgress = analysis && (results == null) && inProgressStatuses.includes(analysis.status as typeof inProgressStatuses[number]);

  if (analysis?.status === "queued" && queuedAtRef.current === null) queuedAtRef.current = Date.now();
  if (analysis?.status !== "queued") queuedAtRef.current = null;
  const queuedStuck = analysis?.status === "queued" && queuedAtRef.current != null && Date.now() - queuedAtRef.current > 90000;

  useEffect(() => {
    if (!isInProgress) return;
    const intervalMs = analysis?.status === "queued" ? 2000 : 4000;
    const interval = setInterval(() => {
      refreshAnalyses();
      loadResults();
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isInProgress, analysis?.status, refreshAnalyses, loadResults]);

  // Realtime: live progress when worker updates the analysis row
  useEffect(() => {
    if (!id || !isInProgress) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`analysis:${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "analyses", filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setAnalysisFromApi((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: (row.status as Analysis["status"]) ?? prev.status,
              progress: typeof row.progress === "number" ? row.progress : prev.progress,
              currentStep: (row.current_step as string) ?? prev.currentStep,
              logs: Array.isArray(row.logs) ? row.logs as Analysis["logs"] : prev.logs,
            };
          });
          if (row.results != null) loadResults();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, isInProgress, loadResults]);

  // Fetch count matrix on demand when results have countMatrixR2Key (matrix stored in R2 to avoid OOM)
  const [countMatrixLoading, setCountMatrixLoading] = useState(false);
  useEffect(() => {
    if (!id || !results?.rawData?.countMatrixR2Key || results.rawData.countMatrix != null) return;
    let cancelled = false;
    setCountMatrixLoading(true);
    realApi.getCountMatrix(id).then((matrix) => {
      if (cancelled || !matrix) return;
      setResults((prev) => {
        if (!prev?.rawData?.countMatrixR2Key || prev.rawData.countMatrix != null) return prev;
        return { ...prev, rawData: { ...prev.rawData, countMatrix: matrix } };
      });
    }).finally(() => {
      if (!cancelled) setCountMatrixLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, results?.rawData?.countMatrixR2Key, results?.rawData?.countMatrix]);

  // Portal target for header actions (title + buttons in app header)
  useEffect(() => {
    const el = document.getElementById("header-actions");
    if (el) setHeaderRoot(el);
  }, []);

  // Refetch results when tab becomes visible (debounced for performance)
  useEffect(() => {
    if (typeof document === "undefined" || !id) return;
    let timeoutId: NodeJS.Timeout;
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Debounce to prevent multiple rapid calls
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          loadResults();
          refreshAnalyses();
        }, 500);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(timeoutId);
    };
  }, [id, loadResults, refreshAnalyses]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showExportMenu && !(event.target as HTMLElement).closest('.export-menu-container')) {
        setShowExportMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  // Show one-time warning when analysis was created but queue was unavailable
  useEffect(() => {
    if (!id || typeof sessionStorage === 'undefined') return;
    const key = `splicr_analysis_warning_${id}`;
    const msg = sessionStorage.getItem(key);
    if (msg) {
      setQueueWarning(msg);
      sessionStorage.removeItem(key);
    }
  }, [id]);

  // Cleanup: cancel drug search when navigating away
  useEffect(() => {
    return () => {
      if (drugSearchAbortController.current) {
        drugSearchAbortController.current.abort();
      }
    };
  }, [id]);

  // Debounced save notes to prevent excessive API calls
  const saveNotes = useCallback(async () => {
    await realApi.saveNote(id, notes);
  }, [id, notes]);

  // Drug search handler - persists across tab switches
  const handleDrugSearch = useCallback(async (genes: string[]) => {
    if (genes.length === 0) return;

    // Cancel any existing search
    if (drugSearchAbortController.current) {
      drugSearchAbortController.current.abort();
    }

    // Create new abort controller for this search
    const abortController = new AbortController();
    drugSearchAbortController.current = abortController;

    setDrugSearchLoading(true);
    setDrugSearchError(null);
    setDrugSearchResults(null);
    setDrugSearchProgress(0);
    setDrugSearchProgressMessage('Starting drug-gene search...');

    const BATCH_SIZE = 25;
    const MAX_GENES = 100;
    const searchGenes = genes.slice(0, MAX_GENES);

    try {
      const totalBatches = Math.ceil(searchGenes.length / BATCH_SIZE);
      const resultsByGene = new Map();

      // Fetch in batches
      for (let i = 0; i < searchGenes.length; i += BATCH_SIZE) {
        // Check if search was cancelled
        if (abortController.signal.aborted) {
          return;
        }

        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
        const chunk = searchGenes.slice(i, i + BATCH_SIZE);
        const chunkParam = chunk.join(',');
        const pct = Math.round((batchIndex / totalBatches) * 70);
        
        setDrugSearchProgress(pct);
        setDrugSearchProgressMessage(`Fetching drug interactions (${batchIndex}/${totalBatches} batches, ${chunk.length} genes)...`);

        const getRes = await fetch(`/api/drug-gene?genes=${encodeURIComponent(chunkParam)}&force=true`, {
          signal: abortController.signal
        });
        
        if (!getRes.ok) {
          const errBody = await getRes.json().catch(() => ({}));
          throw new Error(errBody?.error ?? errBody?.details ?? 'Failed to fetch drug-gene data');
        }
        
        const getData = await getRes.json();
        const list = getData.results ?? [];
        
        for (const row of list) {
          resultsByGene.set(row.gene?.toUpperCase() ?? row.gene, {
            gene: row.gene,
            geneName: row.geneName ?? row.gene,
            totalInteractions: row.totalInteractions ?? (row.drugs?.length ?? 0),
            drugs: row.drugs ?? [],
          });
        }
      }

      if (abortController.signal.aborted) {
        return;
      }

      setDrugSearchProgress(75);
      setDrugSearchProgressMessage('Processing results...');

      const resultsList = searchGenes.map((g) => {
        const row = resultsByGene.get(g.toUpperCase()) ?? resultsByGene.get(g);
        return row ?? { gene: g, geneName: g, totalInteractions: 0, drugs: [] };
      });

      let totalDrugs = 0;
      let approvedDrugs = 0;
      for (const r of resultsList) {
        totalDrugs += r.totalInteractions;
        approvedDrugs += (r.drugs ?? []).filter((d: any) => d.approved).length;
      }

      const results = {
        results: resultsList,
        summary: { totalGenes: searchGenes.length, totalDrugs, approvedDrugs },
        combinations: [] as any[]
      };

      setDrugSearchProgress(85);

      // Fetch combinations if we have enough genes
      if (searchGenes.length >= 2 && !abortController.signal.aborted) {
        setDrugSearchProgressMessage('Computing drug combinations...');
        
        const postRes = await fetch('/api/drug-gene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genes: searchGenes.slice(0, 50) }),
          signal: abortController.signal
        });
        
        if (postRes?.ok) {
          const postData = await postRes.json();
          results.combinations = postData.combinations ?? [];
        }
      }

      if (abortController.signal.aborted) {
        return;
      }

      setDrugSearchProgress(100);
      setDrugSearchProgressMessage('Complete!');
      setDrugSearchResults(results);

    } catch (e: any) {
      // Ignore abort errors
      if (e.name === 'AbortError') {
        return;
      }
      setDrugSearchError(e instanceof Error ? e.message : 'Something went wrong');
      setDrugSearchProgress(0);
      setDrugSearchProgressMessage('');
    } finally {
      setTimeout(() => {
        if (!abortController.signal.aborted) {
          setDrugSearchLoading(false);
          setDrugSearchProgress(0);
          setDrugSearchProgressMessage('');
        }
      }, 500);
    }
  }, []);

  const saveAnalysisName = async (): Promise<boolean> => {
    if (!id || !analysisName.trim()) return false;
    const newName = analysisName.trim();
    try {
      const response = await fetch(`/api/analysis/${id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (response.ok) {
        setAnalysisFromApi((prev) => (prev ? { ...prev, name: newName } : null));
        await refreshAnalyses();
        return true;
      }
      const data = await response.json().catch(() => ({}));
      console.error("Failed to save analysis name:", data?.error ?? response.statusText);
      return false;
    } catch (error) {
      console.error("Failed to save analysis name:", error);
      return false;
    }
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

  // Memoize PDF export handler
  const handleExportCompletePDF = useCallback(async () => {
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
  }, [results, analysis]);

  // Memoize export handler to prevent re-creation on every render
  const handleExport = useCallback(async (format: string) => {
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
  }, [results, analysis, id, handleExportCompletePDF]);

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

  // Sync display name from server only when not editing, so typing isn't overwritten by polling/refetch
  useEffect(() => {
    if (analysis && !isEditingName) setAnalysisName(analysis.name ?? "");
  }, [analysis, isEditingName]);

  // Memoize tabs array to prevent re-creation
  const tabs = useMemo(() => [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "volcano", label: "Volcano Plot", icon: TrendingUp },
    { id: "heatmap", label: "Heatmap", icon: Grid3X3 },
    { id: "network", label: "Gene Network", icon: Network },
    { id: "timecourse", label: "Time-Course", icon: Clock },
    { id: "drug-finder", label: "Drug–Gene Finder", icon: Pill },
    { id: "advanced", label: "Advanced Analysis", icon: FlaskConical },
    { id: "top-hits", label: "Top Hits", icon: Star },
    { id: "qc", label: "QC Metrics", icon: BarChart3 },
    { id: "rankings", label: "Gene Rankings", icon: Table },
    { id: "raw-data", label: "Raw Data", icon: Database },
    { id: "logs", label: "Analysis Logs", icon: Terminal },
  ], []);

  const headerActions = headerRoot ? (
    <div className="flex items-center w-full flex-wrap min-h-[2.5rem] gap-3">
      {/* Vertical divider */}
      <div className="w-px h-8 bg-border shrink-0" aria-hidden />

      {/* Space between divider and Create Report: title centered in the middle */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-2">
        <div className="flex items-center gap-3 flex-wrap min-w-0 justify-center">
          {isEditingName ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={analysisName}
                onChange={(e) => setAnalysisName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    saveAnalysisName().then((ok) => ok && setIsEditingName(false));
                  }
                  if (e.key === "Escape") {
                    setAnalysisName(analysis?.name ?? "");
                    setIsEditingName(false);
                  }
                }}
                className="text-xl font-serif text-text-primary bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-text-primary min-w-[200px] max-w-[320px]"
                autoFocus
                aria-label="Edit analysis name"
              />
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await saveAnalysisName();
                    if (ok) setIsEditingName(false);
                  }}
                  className="inline-flex items-center justify-center p-2 rounded-lg hover:bg-accent text-text-primary transition-colors"
                  aria-label="Save name"
                >
                  <Save className="w-4 h-4" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisName(analysis?.name ?? "");
                    setIsEditingName(false);
                  }}
                  className="inline-flex items-center justify-center p-2 rounded-lg hover:bg-background text-text-secondary transition-colors"
                  aria-label="Cancel editing"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-serif font-semibold text-text-primary m-0 leading-none py-0.5">
                {analysisName || "Screen Analysis"}
              </h1>
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-background text-text-secondary hover:text-text-primary transition-colors shrink-0"
                aria-label="Edit analysis name"
              >
                <Edit2 className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
          {analysis?.algorithm?.length ? (
            <div className="flex items-center gap-1.5 shrink-0">
              {analysis.algorithm.map((alg) => (
                <span
                  key={alg}
                  className="px-2.5 py-1 bg-accent/20 rounded-md text-sm font-serif font-medium text-text-primary"
                >
                  {String(alg).toUpperCase()}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Action buttons — same baseline as title */}
      <div className="flex items-center gap-2 flex-wrap shrink-0 pr-2">
        <Button variant="secondary" size="md" onClick={() => setReportBuilderOpen(true)} className="inline-flex items-center gap-1.5 text-sm py-2">
          <FileText className="w-4 h-4" strokeWidth={1.5} />
          Create Report
        </Button>
        {/* Screen → Structure button temporarily hidden for performance optimization */}
        {/* {results && hitGenesForStructure.length > 0 && (
          <Button
            variant={integrationPanelOpen ? "primary" : "secondary"}
            size="md"
            onClick={() => setIntegrationPanelOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-sm py-2"
          >
            <Box className="w-4 h-4" strokeWidth={1.5} />
            Screen → Structure
          </Button>
        )} */}
        <Button variant="secondary" size="md" onClick={() => setCollabSidebarOpen(true)} className="inline-flex items-center gap-1.5 text-sm py-2">
          <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
          Collaboration
        </Button>
        <Button variant="secondary" size="md" onClick={() => setShareModalOpen(true)} className="inline-flex items-center gap-1.5 text-sm py-2">
          <Share2 className="w-4 h-4" strokeWidth={1.5} />
          Share
        </Button>
        <Link href="/analyses">
          <Button variant="secondary" size="md" className="inline-flex items-center gap-1.5 text-sm py-2">
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            Back
          </Button>
        </Link>
        <div className="relative export-menu-container">
          <Button variant="primary" size="md" onClick={() => setShowExportMenu(!showExportMenu)} className="inline-flex items-center gap-1.5 text-sm py-2">
            <Download className="w-4 h-4" strokeWidth={1.5} />
            Download results
          </Button>
          {showExportMenu && (
            <div className="absolute right-0 mt-2 w-64 bg-surface rounded-lg shadow-lg border border-border py-2 z-50 max-h-[80vh] overflow-y-auto">
              <button type="button" onClick={() => handleExport("csv")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
                <Table className="w-5 h-5 text-green-500" />
                <div>
                  <div className="font-medium text-text-primary">CSV Data</div>
                  <div className="text-xs text-text-tertiary">Gene rankings table</div>
                </div>
              </button>
              <button type="button" onClick={() => handleExport("pdf-complete")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
                <FileText className="w-5 h-5 text-[#6ABF36]" />
                <div>
                  <div className="font-medium text-text-primary">Complete PDF Report</div>
                  <div className="text-xs text-text-tertiary">Volcano plot + top hits table</div>
                </div>
              </button>
              <button type="button" onClick={() => handleExport("pdf")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
                <FileText className="w-5 h-5 text-red-500" />
                <div>
                  <div className="font-medium text-text-primary">PDF Report</div>
                  <div className="text-xs text-text-tertiary">Summary + top depleted</div>
                </div>
              </button>
              <button type="button" onClick={() => handleExport("docx")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
                <File className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="font-medium text-text-primary">Word Document</div>
                  <div className="text-xs text-text-tertiary">Editable DOCX format</div>
                </div>
              </button>
              <button type="button" onClick={() => handleExport("latex")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
                <FileCode className="w-5 h-5 text-green-500" />
                <div>
                  <div className="font-medium text-text-primary">LaTeX Source</div>
                  <div className="text-xs text-text-tertiary">Publication-ready .tex</div>
                </div>
              </button>
              <button type="button" onClick={() => handleExport("log")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
                <Terminal className="w-5 h-5 text-purple-500" />
                <div>
                  <div className="font-medium text-text-primary">Computational Log</div>
                  <div className="text-xs text-text-tertiary">Pipeline execution details</div>
                </div>
              </button>
              <div className="border-t border-border my-2" />
              <button type="button" onClick={() => handleExport("zip")} className="w-full px-4 py-2 text-left hover:bg-background flex items-center gap-3 transition-colors">
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
  ) : null;

  return (
    <>
      {headerRoot && createPortal(headerActions, headerRoot)}
      <div className={`min-h-screen ${integrationPanelOpen ? "mr-[360px]" : ""}`}>
        <div className="max-w-[1600px] mx-auto px-8 py-12">
          {queueWarning && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
            >
              <span className="flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                {queueWarning}
              </span>
              <button
                type="button"
                onClick={() => setQueueWarning(null)}
                className="shrink-0 p-1 rounded hover:bg-amber-500/20"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
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
                {activeTab === "volcano" && <VolcanoTab results={results} onCustomize={() => setFigureCustomizationOpen(true)} />}
                {activeTab === "heatmap" && <HeatmapTab results={results} onCustomize={() => setFigureCustomizationOpen(true)} />}
                {activeTab === "network" && <NetworkTab results={results} analysisName={analysisName || analysis?.name} onCustomize={() => setFigureCustomizationOpen(true)} />}
                {activeTab === "timecourse" && <TimeCourseTab results={results} analysis={analysis ?? undefined} analysisName={analysisName || analysis?.name} />}
                {activeTab === "drug-finder" && <DrugFinderTab 
                  results={results} 
                  analysisName={analysisName || analysis?.name} 
                  onGeneClick={setSelectedGene}
                  drugSearchState={{
                    loading: drugSearchLoading,
                    error: drugSearchError,
                    results: drugSearchResults,
                    progress: drugSearchProgress,
                    progressMessage: drugSearchProgressMessage
                  }}
                  onDrugSearch={handleDrugSearch}
                />}
                {activeTab === "advanced" && <AdvancedTab results={results} analysisId={id} onResultsUpdate={loadResults} onGeneClick={setSelectedGene} />}
                {activeTab === "top-hits" && <TopHitsTab results={results} onGeneClick={setSelectedGene} />}
                {activeTab === "qc" && <QCTab results={results} onCustomize={() => setFigureCustomizationOpen(true)} />}
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
                      Status: <span className="capitalize">{analysis.status === "processing" ? "Running" : analysis.status}</span>
                      {isInProgress && typeof analysis.progress === "number" && ` · ${Math.round(analysis.progress)}%`}
                    </p>
                    {isInProgress ? (
                      <>
                        <p className="text-text-secondary font-serif mt-4">Analysis in progress — results will appear when the run finishes.</p>
                        {(analysis.currentStep ?? analysis.status === "pending") && (
                          <p className="text-text-tertiary text-sm mt-2 font-medium">
                            {analysis.status === "pending" ? "Starting pipeline…" : analysis.status === "queued" ? "Waiting for worker…" : (analysis.currentStep ?? "Running…")}
                          </p>
                        )}
                        <div className="max-w-md mx-auto mt-6">
                          <div className="h-3 bg-background rounded-full overflow-hidden border border-border-light">
                            <motion.div
                              className="h-full bg-accent rounded-full"
                              initial={false}
                              animate={{ width: `${Math.min(100, Math.max(0, analysis.progress ?? 0))}%` }}
                              transition={{ duration: 0.4, ease: "easeOut" }}
                            />
                          </div>
                          <p className="text-text-tertiary text-xs mt-2">
                            {analysis.status === "pending" ? "Starting…" : analysis.status === "queued" ? "Queued — worker will pick up shortly" : (analysis.currentStep ?? "Still being analyzed")}
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
                        {queuedStuck && (
                          <p className="text-amber-600 dark:text-amber-400 text-sm mt-4 max-w-md mx-auto">
                            Job has been queued for a while. If you use a worker (e.g. Railway), ensure it is running with REDIS_URL (or Upstash) set. Click Retry to try running the analysis inline instead.
                          </p>
                        )}
                        <div className="flex items-center justify-center gap-4 mt-6">
                          <Button variant="outline" onClick={() => { refreshAnalyses(); loadResults(); }} disabled={isRetrying}>Refresh</Button>
                          <Link href="/analyses">
                            <Button variant="outline">Back to your analyses</Button>
                          </Link>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center gap-4 mt-6">
                        <Button variant="outline" onClick={handleRetry} disabled={isRetrying}>{isRetrying ? "Starting…" : "Retry"}</Button>
                        <Link href="/analyses" className="text-accent font-serif inline-block">Back to your analyses</Link>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-text-secondary font-serif">Could not load results.</p>
                    <div className="flex items-center justify-center gap-4 mt-6">
                      <Button variant="outline" onClick={handleRetry} disabled={isRetrying}>{isRetrying ? "Starting…" : "Retry"}</Button>
                      <Link href="/analyses" className="text-accent font-serif inline-block">Back to your analyses</Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </AnimatePresence>

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
                placeholder="Add notes about this analysis..."
                className="w-full h-32 bg-transparent border-none resize-none font-serif text-text-primary focus:outline-none placeholder:text-text-tertiary"
              />
            </div>
          </motion.div>
        </div>
      </div>

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
                fdrThreshold: analysis.parameters?.fdrThreshold ?? 0.05,
                lfcThreshold: analysis.parameters?.lfcThreshold ?? 1,
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
                // Additional comprehensive data
                createdDate: analysis.createdAt ? new Date(analysis.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A',
                completedDate: analysis.completedAt ? new Date(analysis.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A',
                sampleCount: analysis.sampleLabels?.length ?? 0,
                sampleNames: analysis.sampleLabels?.map((s) => s.sampleName || s.fileName).join(', ') ?? 'N/A',
                controlSamples: analysis.sampleLabels?.filter((s) => s.condition === 'control').map((s) => s.sampleName || s.fileName).join(', ') || 'N/A',
                treatmentSamples: analysis.sampleLabels?.filter((s) => s.condition === 'treatment').map((s) => s.sampleName || s.fileName).join(', ') || 'N/A',
                totalReads: results.qcMetrics?.totalReads ? `${(results.qcMetrics.totalReads / 1e6).toFixed(2)}M` : 'N/A',
                mappingRate: typeof results.qcMetrics?.mappingRate === 'number' ? `${results.qcMetrics.mappingRate.toFixed(1)}%` : 'N/A',
                libraryCoverage: typeof results.qcMetrics?.libraryCoverage === 'number' ? `${results.qcMetrics.libraryCoverage.toFixed(1)}%` : 'N/A',
                zeroCounts: typeof results.qcMetrics?.zeroCounts === 'number' ? `${results.qcMetrics.zeroCounts.toFixed(1)}%` : 'N/A',
                giniCoefficient: typeof results.qcMetrics?.giniCoefficient === 'number' ? results.qcMetrics.giniCoefficient.toFixed(3) : 'N/A',
                normalizationMethod: analysis.parameters?.normalizationMethod ?? 'median',
                minimumReads: analysis.parameters?.minimumReads ?? 30,
                resultsSource: results.resultsSource ?? 'pipeline',
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

      {integrationPanelOpen && results && analysis && (
        <aside className="fixed top-0 right-0 bottom-0 w-[360px] z-30 flex flex-col bg-surface border-l border-border shadow-lg">
          <ScreenIntegrationPanel
            analysisId={id}
            analysisName={(analysisName || analysis?.name) ?? "Analysis"}
            completedDate={analysis.completedAt ?? analysis.createdAt ?? new Date().toISOString()}
            totalGenes={results.summary?.totalGenes ?? 0}
            significantHits={results.summary?.significantHits ?? 0}
            cellLine=""
            condition=""
            screenType="knockout"
            hitGenes={hitGenesForStructure}
            width={360}
            onClose={() => setIntegrationPanelOpen(false)}
          />
        </aside>
      )}
    </>
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

/** Researcher-grade definitions: how each overview metric is computed (from this run's pipeline). */
const OVERVIEW_METRIC_INFO: Record<string, string> = {
  totalGenes: 'Number of genes in the reference library that had at least one sgRNA with non-zero counts in your sequencing data. Derived from the count matrix after mapping reads to the chosen sgRNA library.',
  significantHits: 'Genes that pass the significance thresholds (FDR and log₂ fold change) set for this run. Computed by the analysis method (e.g. MAGeCK RRA) from treatment vs control counts.',
  enriched: 'Significant genes with positive log₂ fold change (more abundant in treatment than control). Indicates genes whose knockout may confer a growth advantage.',
  depleted: 'Significant genes with negative log₂ fold change (less abundant in treatment). Indicates genes whose knockout may be detrimental to cell fitness.',
  readDepth: 'Total number of sequencing reads parsed from the FASTQ files in this run. Sum of reads across all samples before filtering.',
  mappingRate: 'Percentage of reads that matched at least one sgRNA in the reference library. Computed as (mapped reads ÷ total reads) × 100. Reflects library design and sequencing quality.',
  zeroCount: 'Percentage of (sgRNA × sample) cells in the count matrix with zero counts. High values may indicate undersampling, PCR dropout, or low sequencing depth.',
  coverage: 'Percentage of sgRNAs in the reference library that had at least one read in at least one sample. (sgRNAs with count > 0 ÷ library size) × 100.',
};

function LabelWithInfo({ label, infoKey }: { label: string; infoKey: keyof typeof OVERVIEW_METRIC_INFO }) {
  const text = OVERVIEW_METRIC_INFO[infoKey];
  if (!text) return <span className="text-sm font-serif text-text-secondary">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm font-serif text-text-secondary">{label}</span>
      <span className="relative group inline-flex flex-shrink-0">
        <Info className="w-3.5 h-3.5 text-text-tertiary cursor-help hover:text-text-secondary transition-colors" aria-label="How this metric is calculated" />
        <span
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-30 w-64 p-4 text-sm font-sans font-normal text-left text-text-secondary leading-relaxed bg-surface border border-border rounded-xl shadow-elevated normal-case pointer-events-none"
          role="tooltip"
        >
          <span className="block">{text}</span>
          <span className="absolute left-1/2 -translate-x-1/2 top-full -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-surface" aria-hidden />
        </span>
      </span>
    </span>
  );
}

function OverviewTab({ results }: { results: AnalysisResults }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard label="Total genes" value={results.summary.totalGenes.toLocaleString()} infoKey="totalGenes" />
        <SummaryCard label="Significant hits" value={results.summary.significantHits.toLocaleString()} color="text-accent" infoKey="significantHits" />
        <SummaryCard label="Enriched" value={results.summary.enriched.toLocaleString()} color="text-success" infoKey="enriched" />
        <SummaryCard label="Depleted" value={results.summary.depleted.toLocaleString()} color="text-error" infoKey="depleted" />
      </div>
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-6">Quality metrics</h3>
        <p className="text-sm text-text-secondary mb-6">Metrics computed from this run's FASTQ parsing and count matrix (no mock data).</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <QCMetric label="Read depth" value={`${((results.qcMetrics?.totalReads ?? 0) / 1e6).toFixed(1)}M`} infoKey="readDepth" />
          <QCMetric label="Mapping rate" value={`${typeof results.qcMetrics?.mappingRate === 'number' ? (results.qcMetrics.mappingRate <= 1 ? (results.qcMetrics.mappingRate * 100).toFixed(1) : results.qcMetrics.mappingRate.toFixed(1)) : results.qcMetrics?.mappingRate ?? '—'}%`} infoKey="mappingRate" />
          <QCMetric label="Zero count" value={`${typeof results.qcMetrics?.zeroCounts === 'number' ? results.qcMetrics.zeroCounts.toFixed(1) : results.qcMetrics?.zeroCounts ?? '—'}%`} infoKey="zeroCount" />
          <QCMetric label="Coverage" value={`${typeof results.qcMetrics?.libraryCoverage === 'number' ? (results.qcMetrics.libraryCoverage <= 1 ? (results.qcMetrics.libraryCoverage * 100).toFixed(1) : results.qcMetrics.libraryCoverage.toFixed(1)) : results.qcMetrics?.libraryCoverage ?? '—'}%`} infoKey="coverage" />
        </div>
      </div>
    </div>
  );
}

function VolcanoTab({ results, onCustomize }: { results: AnalysisResults; onCustomize?: () => void }) {
  return (
    <div className="space-y-4">
      {onCustomize && (
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onCustomize} className="inline-flex items-center gap-1.5 text-sm py-2">
            <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
            Customize Figure
          </Button>
        </div>
      )}
      <div id="volcano-plot" className="w-full">
        <VolcanoPlot
          data={results.volcanoData ?? undefined}
          fdrThreshold={0.05}
          lfcThreshold={1.0}
        />
      </div>
    </div>
  );
}

function HeatmapTab({ results, onCustomize }: { results: AnalysisResults; onCustomize?: () => void }) {
  const sampleNames = results.qcMetrics?.sampleStats?.map((s) => s.name) ?? [];
  const correlations = results.qcMetrics?.correlations ?? [];
  const countMatrix = results.rawData?.countMatrix ?? {};
  return (
    <div className="space-y-4">
      {onCustomize && (
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onCustomize} className="inline-flex items-center gap-1.5 text-sm py-2">
            <Grid3X3 className="w-4 h-4" strokeWidth={1.5} />
            Customize Heatmap
          </Button>
        </div>
      )}
      <InteractiveHeatmap
        correlations={correlations}
        sampleNames={sampleNames}
        countMatrix={Object.keys(countMatrix).length > 0 ? countMatrix : undefined}
        height={560}
      />
    </div>
  );
}

function NetworkTab({ results, analysisName, onCustomize }: { results: AnalysisResults; analysisName?: string; onCustomize?: () => void }) {
  const significantGenes = [
    ...(results.topHits?.depleted ?? []).slice(0, 25),
    ...(results.topHits?.enriched ?? []).slice(0, 25),
  ].map((g) => ({
    gene: g.gene,
    sgrnaCount: g.sgrnaCount ?? 4,
    logFoldChange: g.logFoldChange ?? 0,
    pValue: g.pValue ?? 1,
    fdr: g.fdr ?? 1,
    rank: g.rank ?? 0,
  }));

  if (significantGenes.length === 0) {
    return (
      <div className="bg-surface rounded-xl p-12 border border-border text-center">
        <p className="text-text-secondary font-serif">No significant genes available for network analysis.</p>
        <p className="text-text-tertiary text-sm mt-2">Network visualization requires genes with FDR &lt; 0.05.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onCustomize && (
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onCustomize} className="inline-flex items-center gap-1.5 text-sm py-2">
            <Network className="w-4 h-4" strokeWidth={1.5} />
            Customize Network
          </Button>
        </div>
      )}
      <GeneNetworkVisualization
        genes={significantGenes}
        maxGenes={50}
        requiredScore={400}
        height={560}
        analysisName={analysisName}
      />
    </div>
  );
}

function TimeCourseTab({
  results,
  analysis,
  analysisName,
}: {
  results: AnalysisResults;
  analysis?: Analysis | null;
  analysisName?: string;
}) {
  const { timepoints, series, genes } = useMemo(() => {
    const sampleLabels =
      analysis?.sampleLabels ??
      (analysis as { parameters?: { sampleLabels?: unknown[] } } | undefined)?.parameters?.sampleLabels ??
      [];
    const treatmentSamples = (sampleLabels as { sampleName: string; condition: string; replicate?: number }[])
      .filter((s) => s.condition === 'treatment')
      .sort((a, b) => (a.replicate ?? 0) - (b.replicate ?? 0) || (a.sampleName || '').localeCompare(b.sampleName || ''));
    const controlSamples = (sampleLabels as { sampleName: string; condition: string }[]).filter((s) => s.condition === 'control');
    const timepoints =
      treatmentSamples.length > 0
        ? treatmentSamples.map((s) => s.sampleName || `Sample`).filter(Boolean)
        : results.qcMetrics?.sampleStats
          ? (results.qcMetrics.sampleStats as { name: string }[]).map((s) => s.name).slice(0, 8)
          : ['Day 0', 'Day 7', 'Day 14', 'Day 21'];

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

    const countMatrix = results.rawData?.countMatrix;
    const treatmentNames = treatmentSamples.map((s) => s.sampleName).filter(Boolean);
    const controlNames = controlSamples.map((s) => s.sampleName).filter(Boolean);
    const hasRealTimepoints =
      countMatrix &&
      typeof countMatrix === 'object' &&
      treatmentNames.length > 0 &&
      Object.keys(countMatrix).length > 0;

    if (hasRealTimepoints && controlNames.length > 0) {
      const geneBySample: Record<string, Record<string, number>> = {};
      for (const [sgRNA, counts] of Object.entries(countMatrix as Record<string, Record<string, number>>)) {
        const gene = sgRNA.replace(/_sg\d+$/i, '').replace(/_sgRNA\d+$/i, '') || sgRNA;
        if (!geneBySample[gene]) geneBySample[gene] = {};
        for (const [sampleName, count] of Object.entries(counts)) {
          geneBySample[gene][sampleName] = (geneBySample[gene][sampleName] ?? 0) + (count ?? 0);
        }
      }
      const controlMeanByGene: Record<string, number> = {};
      for (const gene of Object.keys(geneBySample)) {
        const ctrlSum = controlNames.reduce((sum, name) => sum + (geneBySample[gene][name] ?? 0), 0);
        controlMeanByGene[gene] = ctrlSum / Math.max(1, controlNames.length);
      }
      const geneList = genes.slice(0, 20).map((g) => g.gene);
      const series = geneList
        .filter((gene) => geneBySample[gene] && controlMeanByGene[gene] !== undefined)
        .map((g) => {
          const meta = genes.find((x) => x.gene === g);
          const controlMean = (controlMeanByGene[g] ?? 0) + 1;
          const values = treatmentNames.map(
            (name) => Math.log2(((geneBySample[g][name] ?? 0) + 1) / controlMean)
          );
          return {
            gene: g,
            values,
            fdr: meta?.fdr,
            log2FC: meta?.logFoldChange,
          };
        })
        .filter((s) => s.values.some((v) => Number.isFinite(v)));
      if (series.length > 0) {
        return { timepoints: treatmentNames, series, genes: [] };
      }
    }

    return { timepoints, series: undefined, genes };
  }, [results, analysis]);

  return (
    <TimeCourseVisualization
      timepoints={timepoints}
      series={series}
      genes={genes}
      maxGenes={15}
      height={520}
      analysisName={analysisName}
    />
  );
}

function DrugFinderTab({
  results,
  analysisName,
  onGeneClick,
  drugSearchState,
  onDrugSearch,
}: {
  results: AnalysisResults;
  analysisName?: string | null;
  onGeneClick?: (gene: string) => void;
  drugSearchState?: {
    loading: boolean;
    error: string | null;
    results: any | null;
    progress: number;
    progressMessage: string;
  };
  onDrugSearch?: (genes: string[]) => void;
}) {
  const significantGenes = (() => {
    if (!results) return [] as string[];
    const fromAll = results.allGenes?.filter((g) => g.fdr < 0.05).map((g) => g.gene);
    if (fromAll && fromAll.length > 0) return fromAll;
    const depleted = (results.topHits?.depleted ?? []).map((g) => g.gene);
    const enriched = (results.topHits?.enriched ?? []).map((g) => g.gene);
    return [...new Set([...depleted, ...enriched])];
  })();
  const totalGenesInScreen = results?.summary?.totalGenes ?? (results?.allGenes?.length ?? undefined);

  return (
    <DrugGeneFinder
      significantGenes={significantGenes}
      totalGenesInScreen={totalGenesInScreen}
      analysisName={analysisName ?? undefined}
      onGeneClick={onGeneClick}
      externalState={drugSearchState}
      onSearch={onDrugSearch}
    />
  );
}

function AdvancedTab({
  results,
  analysisId,
  onResultsUpdate,
  onGeneClick,
}: {
  results: AnalysisResults;
  analysisId: string;
  onResultsUpdate?: () => void;
  onGeneClick?: (gene: string) => void;
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
        <DepMapComparison genes={genesForDepMap} maxGenes={80} height={400} onGeneClick={onGeneClick} />
      </section>
      <section>
        <SyntheticLethalityPredictor genes={genesForSyntheticLethality} minScore={0.4} onGeneClick={onGeneClick} />
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

function QCTab({ results, onCustomize }: { results: AnalysisResults; onCustomize?: () => void }) {
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
    <div className="space-y-4">
      {onCustomize && (
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onCustomize} className="inline-flex items-center gap-1.5 text-sm py-2">
            <BarChart3 className="w-4 h-4" strokeWidth={1.5} />
            Customize QC Charts
          </Button>
        </div>
      )}
      <QCCharts
        readCounts={readCountData}
        correlation={results.qcMetrics.correlations}
        coverage={coverageData}
        giniCoefficient={results.qcMetrics.giniCoefficient}
        sampleStats={results.qcMetrics.sampleStats}
        resultsSource={results.resultsSource}
      />
    </div>
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
    <div className="space-y-4">
      <p className="text-sm text-text-tertiary max-w-2xl">
        <strong className="text-text-secondary">FDR (False Discovery Rate)</strong>: expected proportion of false positives among genes called significant. We use Benjamini–Hochberg correction. Lower FDR = more confidence (e.g. FDR &lt; 0.05 is standard).
      </p>
      <InteractiveDataTable
        data={results.allGenes || []}
        analysisId={analysisId}
        onGeneClick={onGeneClick}
      />
    </div>
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

  const handleDownload = (type: string, fileName?: string) => {
    let content = '';
    let filename = fileName || '';

    if (type === 'counts' && results.rawData?.countMatrix) {
      const data = results.rawData.countMatrix;
      const sgRNAs = Object.keys(data);
      const samples = sgRNAs.length > 0 ? Object.keys(data[sgRNAs[0]]) : [];

      content = ['sgRNA', ...samples].join('\t') + '\n';
      sgRNAs.forEach(sgRNA => {
        content += [sgRNA, ...samples.map(s => data[sgRNA][s])].join('\t') + '\n';
      });
      filename = fileName || `splicr-counts-${analysisId}.tsv`;
    } else if (type === 'genes' && results.allGenes) {
      content = 'Rank\tGene\tsgRNAs\tLog2FC\tP-value\tFDR\n';
      results.allGenes.forEach((gene: any) => {
        content += `${gene.rank}\t${gene.gene}\t${gene.sgrnaCount}\t${gene.logFoldChange.toFixed(4)}\t${gene.pValue.toExponential(3)}\t${gene.fdr.toFixed(6)}\n`;
      });
      filename = fileName || `splicr-gene-summary-${analysisId}.tsv`;
    }

    if (content) {
      const blob = new Blob([content], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const files = [
    { name: "sgRNA Count Matrix", type: "counts", size: results.rawData?.countMatrix ? `${Object.keys(results.rawData.countMatrix).length} sgRNAs` : "N/A", downloadName: `${analysisId}-count-matrix.tsv` },
    { name: "Gene Summary", type: "genes", size: results.allGenes ? `${results.allGenes.length} genes` : "N/A", downloadName: `${analysisId}-gene-summary.tsv` },
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
                <Button variant="outline" size="sm" onClick={() => handleDownload(file.type, file.downloadName)}>
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

          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            {viewingData === 'genes' ? (
              <>
                <p className="text-xs text-text-tertiary mb-3 max-w-2xl">
                  <strong className="text-text-secondary">FDR (False Discovery Rate)</strong>: expected proportion of false positives among genes called significant. We use Benjamini–Hochberg correction. Lower FDR = more confidence (e.g. FDR &lt; 0.05 is standard).
                </p>
                <table className="w-full">
                <thead className="bg-background sticky top-0 z-10">
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
                  {dataContent.map((gene: any) => (
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
              </>
            ) : (
              <div className="text-sm text-text-secondary font-mono">
                <p className="mb-4">Count matrix with {Object.keys(dataContent).length} sgRNAs</p>
                <pre className="bg-background p-4 rounded-lg overflow-x-auto max-h-[600px] overflow-y-auto">
                  {JSON.stringify(dataContent, null, 2)}
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
        <p className="text-sm text-text-secondary mt-2">Run context (sgRNA library, FASTQ files, tests, settings) and step-by-step pipeline output with timestamps</p>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <div className="font-mono text-sm">
          {logs.length > 0 ? (
            logs.map((log: { timestamp: string; step: string; message: string; progress: number; level: string }, index: number) => (
              <div
                key={index}
                className={`px-6 py-3 border-b border-border-light hover:bg-background transition-colors ${
                  log.level === 'error' ? 'bg-error/5' : log.level === 'success' ? 'bg-success/5' : log.step === 'Context' ? 'bg-background/50' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  <span className="text-text-tertiary whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`${getLevelColor(log.level)} w-4 flex-shrink-0`}>
                    {getLevelIcon(log.level)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {log.step && log.step !== 'Context' && (
                      <span className="text-text-tertiary text-xs font-medium uppercase tracking-wide mr-2">{log.step}</span>
                    )}
                    <span className="text-text-primary">{log.message}</span>
                  </div>
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

function SummaryCard({ label, value, color = "text-text-primary", infoKey }: { label: string; value: string; color?: string; infoKey?: keyof typeof OVERVIEW_METRIC_INFO }) {
  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
      <div className={`text-5xl font-serif ${color} mb-3`}>{value}</div>
      <div className="text-sm font-serif text-text-secondary">
        {infoKey ? <LabelWithInfo label={label} infoKey={infoKey} /> : label}
      </div>
    </div>
  );
}

function QCMetric({ label, value, infoKey }: { label: string; value: string; infoKey?: keyof typeof OVERVIEW_METRIC_INFO }) {
  return (
    <div>
      <div className="text-3xl font-serif text-text-primary mb-2">{value}</div>
      <div className="text-sm text-text-secondary font-serif">
        {infoKey ? <LabelWithInfo label={label} infoKey={infoKey} /> : label}
      </div>
    </div>
  );
}
