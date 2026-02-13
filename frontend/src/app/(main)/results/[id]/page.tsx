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
  Search,
  Upload,
  Zap,
  Check,
  Copy,
  ArrowLeft,
  Box,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Scale,
  Grid3X3,
  Network,
  Clock,
  FlaskConical,
  MessageSquare,
  Pill,
} from "lucide-react";

import { BatchCorrectionDashboard } from "@/components/analysis/BatchCorrectionDashboard";

type TabType = "overview" | "volcano" | "heatmap" | "network" | "timecourse" | "advanced" | "top-hits" | "qc" | "rankings" | "raw-data" | "logs" | "drug-finder" | "batch-correction";

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
  const runTriggeredRef = useRef<string | null>(null);
  const queuedAtRef = useRef<number | null>(null);
  const runningStuckRef = useRef<{ progress: number; at: number } | null>(null);
  const [headerRoot, setHeaderRoot] = useState<HTMLElement | null>(null);

  // Drug search state - lifted to parent to persist across tab switches
  const [drugSearchLoading, setDrugSearchLoading] = useState(false);
  const [drugSearchError, setDrugSearchError] = useState<string | null>(null);
  const [drugSearchResults, setDrugSearchResults] = useState<any | null>(null);
  const [drugSearchProgress, setDrugSearchProgress] = useState(0);
  const [drugSearchProgressMessage, setDrugSearchProgressMessage] = useState('');
  const drugSearchAbortController = useRef<AbortController | null>(null);

  // Time tracking state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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

  // Detect stuck "running" (e.g. inline timeout at 5%, or worker hung fetching FASTQ)
  const runStatus = analysis?.status === "running" || analysis?.status === "processing";
  const prog = analysis?.progress ?? 0;
  if (runStatus && prog < 20) {
    const now = Date.now();
    if (!runningStuckRef.current || runningStuckRef.current.progress !== prog) {
      runningStuckRef.current = { progress: prog, at: now };
    }
  } else {
    runningStuckRef.current = null;
  }
  const runningStuck = runStatus && prog < 20 && runningStuckRef.current != null && Date.now() - runningStuckRef.current.at > 180000;

  useEffect(() => {
    if (!isInProgress) return;
    // Poll every 2s for real-time progress (queued or running)
    const interval = setInterval(() => {
      refreshAnalyses();
      loadResults();
    }, 2000);
    return () => clearInterval(interval);
  }, [isInProgress, refreshAnalyses, loadResults]);

  // Realtime: live progress when worker updates the analysis row (polling still runs as fallback)
  useEffect(() => {
    if (!id || !isInProgress) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`analysis:${id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "analyses", filter: `id=eq.${id}` },
          (payload: any) => {
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
    } catch {
      // Realtime may be disabled for analyses table; polling will still update progress
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [id, isInProgress, loadResults]);

  // Time tracking timer
  useEffect(() => {
    // If not running or no start time, don't tick
    if (!isInProgress || !analysis?.startedAt) {
      if (!isInProgress) setElapsedSeconds(0);
      return;
    }

    const startTime = new Date(analysis.startedAt).getTime();

    // Update immediately
    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));

    const interval = setInterval(() => {
      const seconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      setElapsedSeconds(seconds);
    }, 1000);

    return () => clearInterval(interval);
  }, [isInProgress, analysis?.startedAt]);

  const formatTime = (seconds: number) => {
    if (seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Estimate remaining time
  const progressPercent = analysis?.progress ?? 0;
  const estimatedTotalSeconds = progressPercent > 5 && elapsedSeconds > 0
    ? (elapsedSeconds / (progressPercent / 100))
    : 0;
  const estimatedRemaining = estimatedTotalSeconds > 0
    ? Math.max(0, Math.floor(estimatedTotalSeconds - elapsedSeconds))
    : null;

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

  const handleRetry = async (forceInline = false) => {
    if (!id || isRetrying) return;
    setIsRetrying(true);
    try {
      await realApi.runAnalysis(id, forceInline ? { inline: true } : undefined);
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
    { id: "batch-correction", label: "Batch Correction", icon: Scale },
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
                  className={`flex items-center gap-2 px-6 py-4 font-serif transition-all duration-200 relative whitespace-nowrap ${activeTab === tab.id ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
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
                {activeTab === "batch-correction" && <BatchCorrectionDashboard analysisId={id} initialMetrics={results.batchCorrection?.metrics} />}
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
                {activeTab === "logs" && <LogsTab logs={results.logs || analysis?.logs || []} />}
              </motion.div>
            ) : analysis && activeTab === "logs" ? (
              <motion.div
                key="logs-failure-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                <LogsTab logs={analysis.logs || []} />
                <div className="mt-8 flex justify-center">
                  <Button variant="outline" onClick={() => setActiveTab("overview")}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Status
                  </Button>
                </div>
              </motion.div>
            ) : (
              <div key="error" className="bg-surface rounded-2xl p-12 border border-border text-center">
                {analysis ? (
                  <>
                    <p className="text-text-primary font-serif text-lg">{analysis.name ?? "Analysis"}</p>
                    <div className="flex flex-col gap-1 mt-1">
                      <div className="flex items-center justify-between">
                        <p className="text-text-primary font-medium text-lg">
                          Status: <span className={`capitalize ${analysis.status === "failed" ? "text-red-500" : "text-accent"}`}>{analysis.status === "processing" ? "Running" : analysis.status === "queued" ? "Queued" : analysis.status}</span>
                        </p>
                        <p className="text-text-primary font-bold font-mono text-lg">{Math.round(analysis.progress ?? 0)}%</p>
                      </div>

                      {/* Detailed Step Info */}
                      {(analysis.currentStep || analysis.status === "processing") && (
                        <p className="text-text-secondary text-sm font-medium flex items-center gap-2">
                          {analysis.status === "pending" ? "Starting pipeline..." :
                            analysis.status === "queued" ? "Waiting for worker..." :
                              (analysis.currentStep ?? "Processing...")}
                        </p>
                      )}
                    </div>

                    {isInProgress && (
                      <div className="max-w-xl mx-auto mt-6">
                        {/* Progress Bar */}
                        <div className="relative h-4 bg-accent/10 rounded-full overflow-hidden border border-accent/20">
                          <motion.div
                            className="absolute top-0 left-0 h-full bg-accent relative"
                            initial={false}
                            animate={{ width: `${Math.min(100, Math.max(0, analysis.progress ?? 0))}%` }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                          >
                            <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite] skew-x-[-20deg]"
                              style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)' }}
                            />
                          </motion.div>
                        </div>

                        {/* Time Stats */}
                        <div className="flex items-center justify-between mt-3 text-xs font-mono text-text-tertiary px-1">
                          <div className="flex items-center gap-1.5" title="Time elapsed since start">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Elapsed: {formatTime(elapsedSeconds)}</span>
                          </div>
                          {estimatedRemaining !== null && estimatedRemaining > 0 && (
                            <div className="flex items-center gap-1.5" title="Estimated time remaining">
                              <div className="w-3.5 h-3.5 flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-text-tertiary/50" />
                              </div>
                              <span>Est. remaining: {formatTime(estimatedRemaining)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Recent Log Stream - Always visible if logs exist, even if failed */}
                    {analysis.logs && analysis.logs.length > 0 && (
                      <div className="max-w-xl mx-auto mt-6 text-left bg-surface/50 rounded-lg border border-border p-0 overflow-hidden shadow-sm">
                        <div className="px-4 py-2 bg-surface border-b border-border flex items-center justify-between">
                          <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider">Analysis Log</p>
                          {isInProgress && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                          )}
                        </div>
                        <ul className="max-h-40 overflow-y-auto p-2 space-y-0.5 font-mono text-xs">
                          {analysis.logs.slice().reverse().slice(0, 10).map((log: any, i: number) => (
                            <li key={i} className={`flex gap-3 px-2 py-1.5 rounded-md ${i === 0 ? 'bg-accent/5 text-text-primary' : 'text-text-tertiary'}`}>
                              <span className="shrink-0 w-8 text-right opacity-70">{Math.round(log.progress)}%</span>
                              <span className="break-words flex-1">
                                {log.message}
                                {log.level === 'error' && <span className="ml-2 text-red-500 font-bold">ERROR</span>}
                              </span>
                              <span className="shrink-0 opacity-50 text-[10px] pt-0.5">
                                {log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {analysis.status === 'failed' && (
                          <div className="px-4 py-3 bg-red-50/50 border-t border-red-100 dark:border-red-900/10 flex justify-center">
                            <button
                              onClick={() => setActiveTab('logs')}
                              className="text-red-600 hover:text-red-700 text-xs font-semibold flex items-center gap-1.5"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                              View Full Error Logs
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {isInProgress ? (
                      <>
                        {queuedStuck && (
                          <div className="flex flex-col items-center gap-2 mt-6 max-w-md mx-auto bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
                              <AlertTriangle className="w-5 h-5" />
                              <span>Queue Warning</span>
                            </div>
                            <p className="text-amber-600 dark:text-amber-400 text-sm text-center">
                              Analysis has been queued for over 90s. If using Railway, ensure the <b>Worker</b> service is running.
                            </p>
                            <Button
                              variant="outline"
                              onClick={() => handleRetry(true)}
                              disabled={isRetrying}
                              className="mt-2 text-amber-700 hover:bg-amber-100 border-amber-200"
                            >
                              {isRetrying ? "Starting..." : "Try running inline (slower)"}
                            </Button>
                          </div>
                        )}

                        {runningStuck && (
                          <div className="flex flex-col items-center gap-2 mt-6 max-w-md mx-auto bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium">
                              <XCircle className="w-5 h-5" />
                              <span>Stalled</span>
                            </div>
                            <p className="text-red-600 dark:text-red-400 text-sm text-center">
                              Progress stalled for &gt;3 mins. The worker process may have crashed or timed out.
                            </p>
                            <Button
                              variant="outline"
                              onClick={() => handleRetry()}
                              disabled={isRetrying}
                              className="mt-2 text-red-700 hover:bg-red-100 border-red-200"
                            >
                              {isRetrying ? "Retrying..." : "Restart Analysis"}
                            </Button>
                          </div>
                        )}

                        <div className="flex items-center justify-center gap-4 mt-8 pt-4 border-t border-border/50 w-full max-w-md mx-auto">
                          <Button variant="ghost" onClick={() => {
                            // Force cache invalidation before refreshing
                            if (typeof sessionStorage !== 'undefined') {
                              sessionStorage.removeItem('splicr_analyses_cache');
                            }
                            refreshAnalyses();
                            loadResults();
                          }} disabled={isRetrying} className="text-text-tertiary hover:text-text-primary">
                            Refresh Status
                          </Button>
                          <Link href="/analyses">
                            <Button variant="outline">Back to your analyses</Button>
                          </Link>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center gap-4 mt-8 pt-4 border-t border-border/50 w-full max-w-md mx-auto">
                        <Button variant="outline" onClick={() => handleRetry()} disabled={isRetrying}>{isRetrying ? "Starting..." : "Retry Analysis"}</Button>
                        <Link href="/analyses">
                          <Button variant="secondary">Back to your analyses</Button>
                        </Link>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-text-secondary font-serif">Could not load results.</p>
                    <div className="flex items-center justify-center gap-4 mt-6">
                      <Button variant="outline" onClick={() => handleRetry()} disabled={isRetrying}>{isRetrying ? "Starting…" : "Retry"}</Button>
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
        </div >
      </div >

      {selectedGene && (
        <GeneInfoPopup
          geneSymbol={selectedGene}
          onClose={() => setSelectedGene(null)}
        />
      )
      }

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

      {
        integrationPanelOpen && results && analysis && (
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
        )
      }
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
  mageck_sig: 'Genes identified as significantly enriched or depleted by MAGeCK RRA analysis (FDR < 0.05). Represents potential hits based on robust rank aggregation.',
  bagel_ess: 'Genes classified as essential by BAGEL2 (Bayes Factor > 0). Positive BF indicates likelihood of essentiality compared to reference sets.',
  drugz_syn: 'Genes identified as significant by DrugZ (FDR < 0.05). Includes synthetic lethal interactions (depleted) and suppressors (enriched).',
  sgrnaDetectionRate: 'Fraction of sgRNAs in the library that were detected (count > 0) in at least one sample. Low values (<80%) suggest poor sequencing depth or library quality.',
  geneDetectionRate: 'Fraction of genes in the library with at least one sgRNA detected. Values <90% may indicate bottlenecks.',
  readsPerSgrnaAvg: 'Mean reads per sgRNA across all samples. Industry standard: ≥200 reads/sgRNA for reliable depletion calls.',
  readsPerSgrnaMedian: 'Median reads per sgRNA. More robust to outliers than mean. Publication-quality screens typically maintain median >200 reads/sgRNA.',
  genesWithAllGuides: 'Genes where all designed sgRNAs were detected. Essential for robust gene-level statistics.',
  giniQuality: 'Distribution uniformity. 0-0.2: excellent, 0.2-0.4: good, 0.4-0.6: acceptable, >0.6: poor. High Gini indicates PCR jackpotting or bottlenecks.',
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

      {results.algorithms && (
        <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
          <h3 className="text-xl font-serif text-text-primary mb-6">Algorithm Results</h3>
          <p className="text-sm text-text-secondary mb-6">Specific findings from each method run in this analysis.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.algorithms.mageck && results.algorithms.mageck.length > 0 && (
              <SummaryCard
                label="MAGeCK Hits (FDR < 0.05)"
                value={results.algorithms.mageck.filter(g => Math.min(g.fdrNeg, g.fdrPos) < 0.05).length.toLocaleString()}
                color="text-accent"
                infoKey="mageck_sig"
              />
            )}
            {results.algorithms.bagel2 && results.algorithms.bagel2.length > 0 && (
              <SummaryCard
                label="BAGEL2 Essential (BF > 0)"
                value={results.algorithms.bagel2.filter(g => g.bayesFactor > 0).length.toLocaleString()}
                color="text-accent"
                infoKey="bagel_ess"
              />
            )}
            {results.algorithms.drugz && results.algorithms.drugz.length > 0 && (
              <SummaryCard
                label="DrugZ Significant (FDR < 0.05)"
                value={results.algorithms.drugz.filter(g => g.fdr < 0.05).length.toLocaleString()}
                color="text-accent"
                infoKey="drugz_syn"
              />
            )}
          </div>
        </div>
      )}
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-serif text-text-primary">Quality metrics</h3>
            <p className="text-sm text-text-secondary">Metrics computed from this run's FASTQ parsing and count matrix.</p>
          </div>
          {results.qcMetrics?.comprehensiveQC?.overall_quality && (
            <div className={`px-4 py-2 rounded-lg border flex items-center gap-2 ${results.qcMetrics.comprehensiveQC.overall_quality.status === 'pass' ? 'bg-success/10 border-success/20 text-success' :
              results.qcMetrics.comprehensiveQC.overall_quality.status === 'warning' ? 'bg-warning/10 border-warning/20 text-warning' :
                'bg-error/10 border-error/20 text-error'
              }`}>
              <span className="font-bold uppercase tracking-wide text-sm">
                QC STATUS: {results.qcMetrics.comprehensiveQC.overall_quality.status}
              </span>
            </div>
          )}
        </div>

        <QCStatusSummaryCard qc={results.qcMetrics?.comprehensiveQC as any} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-8">
          {/* Row 1: Basic Coverage & Depth */}
          <QCMetric
            label="Read depth"
            value={`${((results.qcMetrics?.totalReads ?? 0) / 1e6).toFixed(1)}M`}
            infoKey="readDepth"
            status={results.qcMetrics?.comprehensiveQC?.sequencing_depth?.meets_minimum === false ? 'warning' : 'pass'}
          />
          <QCMetric
            label="Mapping rate"
            value={`${typeof results.qcMetrics?.mappingRate === 'number' ? (results.qcMetrics.mappingRate <= 1 ? (results.qcMetrics.mappingRate * 100).toFixed(1) : results.qcMetrics.mappingRate.toFixed(1)) : '—'}%`}
            infoKey="mappingRate"
            status={results.qcMetrics?.mappingRate < 0.7 ? 'warning' : 'pass'}
          />
          <QCMetric
            label="Zero count"
            value={`${typeof results.qcMetrics?.zeroCounts === 'number' ? results.qcMetrics.zeroCounts.toFixed(1) : '—'}%`}
            infoKey="zeroCount"
            status={results.qcMetrics?.zeroCounts > 20 ? 'warning' : 'pass'}
          />
          <QCMetric
            label="Coverage"
            value={`${results.qcMetrics?.comprehensiveQC?.library_representation?.detection_rate.toFixed(1) ?? '—'}%`}
            infoKey="coverage"
            status={(results.qcMetrics?.comprehensiveQC?.library_representation?.detection_rate ?? 100) < 80 ? 'warning' : 'pass'}
          />

          {/* Row 2: Detailed Distribution & Counts */}
          <QCMetric
            label="Mean reads/sgRNA"
            value={`${results.qcMetrics?.comprehensiveQC?.distribution?.mean_reads_per_sgrna.toFixed(0) ?? '—'}`}
            infoKey="readsPerSgrnaAvg"
          />
          <QCMetric
            label="Median reads/sgRNA"
            value={`${results.qcMetrics?.comprehensiveQC?.sequencing_depth?.reads_per_sgrna_median.toFixed(0) ?? '—'}`}
            infoKey="readsPerSgrnaMedian"
            status={results.qcMetrics?.comprehensiveQC?.sequencing_depth?.meets_minimum === false ? 'fail' : 'pass'}
          />
          <QCMetric
            label="Genes Detected"
            value={`${results.qcMetrics?.comprehensiveQC?.library_representation?.gene_detection_rate.toFixed(1) ?? '—'}%`}
            infoKey="geneDetectionRate"
          />
          <QCMetric
            label="Gini Quality"
            value={results.qcMetrics?.comprehensiveQC?.distribution?.gini_quality ? results.qcMetrics.comprehensiveQC.distribution.gini_quality.charAt(0).toUpperCase() + results.qcMetrics.comprehensiveQC.distribution.gini_quality.slice(1) : '—'}
            infoKey="giniQuality"
            status={
              results.qcMetrics?.comprehensiveQC?.distribution?.gini_quality === 'excellent' ? 'pass' :
                results.qcMetrics?.comprehensiveQC?.distribution?.gini_quality === 'good' ? 'pass' :
                  results.qcMetrics?.comprehensiveQC?.distribution?.gini_quality === 'acceptable' ? 'warning' : 'fail'
            }
          />
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

  const librarySize = results.qcMetrics?.librarySize || results.summary?.totalGenes || 77000;
  const coverageData = results.qcMetrics.sampleStats?.map((s: any) => ({
    sample: s.name,
    coverage: (s.uniqueSgRNAs / librarySize) * 100
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
        lorenzCurve={results.qcMetrics.comprehensiveQC?.distribution?.lorenz_curve_data}
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

function LogsTab({ logs = [] }: { logs?: any[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'success': return 'text-emerald-400';
      case 'error': return 'text-red-400';
      case 'warning': return 'text-amber-400';
      default: return 'text-blue-300';
    }
  };

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = logs.map(l => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.level.toUpperCase()}: ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#0f172a] rounded-xl shadow-2xl border border-slate-800 overflow-hidden font-mono text-sm ring-1 ring-white/10">
      {/* Terminal Header */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-3 flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="ml-3 text-slate-400 text-xs font-semibold tracking-wider">analysis-worker.log</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy All</span>
              </>
            )}
          </button>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Live Stream</span>
          </div>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="h-[600px] overflow-y-auto p-4 space-y-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {logs.length > 0 ? (
          <>
            {logs.map((log: { timestamp: string; step: string; message: string; progress: number; level: string }, index: number) => (
              <div key={index} className="group flex gap-3 hover:bg-white/5 p-1 rounded transition-colors -mx-1 px-2">
                <span className="text-slate-500 shrink-0 select-none w-20 text-xs pt-0.5 opacity-60">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <div className="flex-1 break-words leading-relaxed text-slate-300">
                  <span className={`${getLevelColor(log.level)} font-bold mr-2`}>
                    {log.level === 'error' ? '✖' : log.level === 'success' ? '✔' : '❯'}
                  </span>
                  {log.step && log.step !== 'Context' && (
                    <span className="text-slate-500 mr-2 text-xs uppercase tracking-wide">[{log.step}]</span>
                  )}
                  <span>{log.message}</span>
                </div>
                {log.progress > 0 && (
                  <span className="text-slate-600 text-xs shrink-0 select-none pt-0.5">
                    {log.progress}%
                  </span>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
            <Terminal className="w-12 h-12 opacity-20" />
            <p>Waiting for analysis logs...</p>
          </div>
        )}
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

function QCMetric({ label, value, infoKey, status }: { label: string; value: string; infoKey?: keyof typeof OVERVIEW_METRIC_INFO; status?: 'pass' | 'warning' | 'fail' }) {
  const statusColor =
    status === 'pass' ? 'text-success bg-success/5' :
      status === 'warning' ? 'text-warning bg-warning/5' :
        status === 'fail' ? 'text-error bg-error/5' : '';

  return (
    <div className={`rounded-xl p-4 transition-colors ${statusColor ? statusColor : 'hover:bg-background'}`}>
      <div className="text-3xl font-serif mb-2 flex items-center gap-2">
        {value}
        {status === 'pass' && <CheckCircle2 className="w-5 h-5 text-success" />}
        {status === 'warning' && <AlertTriangle className="w-5 h-5 text-warning" />}
        {status === 'fail' && <XCircle className="w-5 h-5 text-error" />}
      </div>
      <div className="text-sm text-text-secondary font-serif">
        {infoKey ? <LabelWithInfo label={label} infoKey={infoKey} /> : label}
      </div>
    </div>
  );
}
