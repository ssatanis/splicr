"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import FastqUploader from "@/components/FastqUploader";
import LibrarySelector from "@/components/LibrarySelector";
import Button from "@/components/Button";
import { useUser } from "@/lib/context/UserContext";
import { LibraryType, Algorithm, SampleLabel } from "@/lib/types";
import type { UploadedFile as R2UploadedFile } from "@/lib/storage/r2-upload";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Info,
  Save,
  X,
  BookOpen,
} from "lucide-react";

export default function UploadPage() {
  const router = useRouter();
  const { refreshAnalyses } = useUser();
  const [fastqFiles, setFastqFiles] = useState<R2UploadedFile[]>([]);
  const [inferredMetadata, setInferredMetadata] = useState<Record<string, any[]>>({});
  const [libraryType, setLibraryType] = useState<LibraryType | "">("");
  const [customLibraryId, setCustomLibraryId] = useState<string | null>(null);
  const [selectedAlgorithms, setSelectedAlgorithms] = useState<Algorithm[]>(["mageck"]);
  const [showSampleLabelModal, setShowSampleLabelModal] = useState(false);
  const [sampleLabels, setSampleLabels] = useState<SampleLabel[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState({
    fdrThreshold: 0.05,
    lfcThreshold: 1.0,
    normalizationMethod: "median" as "median" | "total" | "control" | "none",
    removeRibosomal: true,
    minimumReads: 30,
    essentialGenes: "",
    nonEssentialGenes: "",
    runCNVCorrection: true,
    generatePlots: true,
    calculateCorrelations: true,
    exportIntermediateFiles: false,
    bagelPermutations: 1000,
    sgRNAOffset: undefined as number | undefined,
  });

  // Sync sample labels when R2 uploaded files change
  useEffect(() => {
    setSampleLabels((prev) => {
      const byName = new Map(prev.map((l) => [l.fileName, l]));
      const next: SampleLabel[] = fastqFiles.map((f) => {
        const existing = byName.get(f.name);

        // Check if we have inferred metadata for this file
        const inferred = inferredMetadata[f.name];
        let inferredCondition: "control" | "treatment" | "other" = "control";
        let inferredReplicate = 1;

        if (inferred && inferred.length > 0) {
          // For now, assume 1-to-1 mapping if FASTQ (one sample per file)
          // If count table, we might have multiple, but this UI expects 1 label per file? 
          // Wait, existing UI maps 1 file -> 1 SampleLabel.
          // If `ingestCountTable` returns multiple samples for one file, 
          // we might need to change how `sampleLabels` works or split the file?
          // Actually, for count tables, `SplicR` probably treats it as a single "file" 
          // but the analysis pipeline handles the columns.
          // The SampleLabel interface has `condition` and `replicate`.
          // Only relevant for FASTQ files where 1 file = 1 sample.
          // If Count Table, the file itself is just a "Library" or "Counts".
          // If the user uploads a Count Table, `FastqUploader` treats it as a file.

          // If we have a Count Table, `inferred` array has > 1 entries.
          // But we act as if 1 file = 1 sample in this loop.
          // If Count Table support is full, we need to hide the "Condition/Replicate" selectors for it 
          // OR ignore them and let pipeline handle it.

          // For now, let's assume if it's FASTQ, inferred has 1 entry.
          if (inferred.length === 1) {
            inferredCondition = inferred[0].conditionLabel === 'control' || inferred[0].conditionLabel === 'treatment'
              ? inferred[0].conditionLabel
              : 'control'; // default
            inferredReplicate = inferred[0].replicateId;
          }
        }

        return existing ?? {
          fileName: f.name,
          fileId: f.r2Key,
          sampleName: inferred && inferred.length === 1 ? inferred[0].sampleId : f.name.replace(/\.(fastq|fq)(\.gz)?$/, ""),
          condition: inferredCondition as "control" | "treatment",
          replicate: inferredReplicate,
        };
      });
      return next;
    });
  }, [fastqFiles, inferredMetadata]);

  // Load draft from localStorage (run once on mount)
  useEffect(() => {
    const draft = localStorage.getItem("splicr_upload_draft");
    if (draft) {
      const parsed = JSON.parse(draft);
      setLibraryType(parsed.libraryType || "");
      setCustomLibraryId(parsed.customLibraryId || null);
      setSelectedAlgorithms(parsed.algorithms || ["mageck"]);
      setAdvancedOptions((prev) => parsed.advanced ?? prev);
    }
  }, []);

  // Auto-save draft
  useEffect(() => {
    if (libraryType || fastqFiles.length > 0) {
      localStorage.setItem(
        "splicr_upload_draft",
        JSON.stringify({
          libraryType,
          customLibraryId,
          algorithms: selectedAlgorithms,
          advanced: advancedOptions,
        })
      );
    }
  }, [libraryType, customLibraryId, selectedAlgorithms, advancedOptions, fastqFiles.length]);

  const handleToggleAlgorithm = (algorithm: Algorithm) => {
    setSelectedAlgorithms((prev) =>
      prev.includes(algorithm)
        ? prev.filter((a) => a !== algorithm)
        : [...prev, algorithm]
    );
  };

  const [analyzing, setAnalyzing] = useState(false);


  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSmartIngest = async (file: File) => {
    if (!libraryType) return; // Can't ingest without library to map against (for FASTQ) or at least context



    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('libraryId', libraryType);

      const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Smart ingest failed');
      }

      const result = await response.json();

      // Update Sample Labels with inferred metadata
      if (result.sampleMetadata && result.sampleMetadata.length > 0) {
        setSampleLabels(prev => {
          // Merge: For each new sample, add if not exists. 
          // Since FastqUploader adds files to list, we might have them there. 
          // But ingest happens *before* or *during* upload. 

          // We mostly want to use the labels for the file we just uploaded.
          // The sampleMetadata contains { sampleId, conditionLabel, replicateId, originalName }.
          // We need to map this to SampleLabel { fileName, fileId (r2Key - wait, we don't have r2Key yet!), ... }

          // Issue: sampleLabels in this component are tied to R2 files by `fileId` (r2Key).
          // FastqUploader uploads -> gets R2 key -> calls onFilesUploaded -> adds to fastqFiles -> useEffect updates sampleLabels.

          // If we run smart ingest *parallel*, we get metadata but maybe not the R2 key yet.
          // However, we can use the `fileName` to match. 
          // When `fastqFiles` updates, the useEffect runs. We should modify that useEffect to *start* with our inferred labels if available.

          // Let's store the inferred labels in a map: fileName -> Metadata
          // And update the useEffect to use it.
          return prev; // We will handle this via a new state + useEffect modification
        });

        // Save inferred data to a ref or state to be used when the file upload completes
        setInferredMetadata(prev => ({
          ...prev,
          [file.name]: result.sampleMetadata
        }));


      }

    } catch (error) {
      console.error("Smart ingest error:", error);
      // Don't block upload, just fail silently or warn
    } finally {

    }
  };



  const handleAnalyze = async () => {
    if (!libraryType) {
      setSubmitError("Please select an sgRNA library");
      return;
    }

    if (fastqFiles.length === 0) {
      setSubmitError("Please upload at least one FASTQ file");
      return;
    }

    const hasTreatment = sampleLabels.some((l) => l.condition === "treatment");
    const hasControl = sampleLabels.some((l) => l.condition === "control");

    if (!hasTreatment || !hasControl) {
      setSubmitError("You must have at least one treatment and one control sample");
      return;
    }

    setSubmitError(null);
    setAnalyzing(true);

    try {
      const response = await fetch("/api/analysis/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Screen Analysis ${new Date().toLocaleDateString()}`,
          library: libraryType,
          method: selectedAlgorithms[0] ?? "mageck",
          r2Keys: fastqFiles.map((f) => f.r2Key),
          parameters: {
            ...advancedOptions,
            algorithms: selectedAlgorithms,
            sampleLabels,
            customLibraryId: libraryType === 'custom' ? (customLibraryId ?? undefined) : undefined,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create analysis");
      }

      await refreshAnalyses();
      router.push(`/results/${data.analysis.id}`);
    } catch (error) {
      console.error("Error submitting analysis:", error);
      setSubmitError(error instanceof Error ? error.message : "Failed to submit analysis");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <>
      <div className="min-h-screen">
        <div className="max-w-[1200px] mx-auto px-8 py-12">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
              <div>
                <h1 className="text-6xl font-serif text-text-primary mb-3">Upload Dataset</h1>
                <p className="text-lg text-text-secondary">
                  Start your CRISPR screen analysis by uploading sequencing data
                </p>
              </div>
              <Link href="/docs/crispr-screen-analysis">
                <Button variant="outline" size="md" className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  View Analysis Documentation
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Library Selection */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-12"
          >
            <LibrarySelector
              selectedLibrary={libraryType || null}
              onSelectLibrary={(id) => setLibraryType(id as LibraryType)}
              onCustomLibraryIdChange={setCustomLibraryId}
              disabled={analyzing}
            />
          </motion.div>

          {/* Upload Zone (R2 direct upload) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-12"
          >
            <FastqUploader
              onFilesUploaded={(files) => setFastqFiles((prev) => [...prev, ...files])}
              onFilesChange={setFastqFiles}
              onFileSelect={handleSmartIngest}
              maxFiles={10}
            />
          </motion.div>

          {/* Sample Labeling (for uploaded R2 files) - labels always visible */}
          {fastqFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6 mb-12"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-serif text-text-primary">
                  Label samples ({fastqFiles.length} files)
                </h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowSampleLabelModal(true)}
                >
                  Edit sample labels
                </Button>
              </div>

              {/* Always show sample labels (read-only summary) */}
              <div className="space-y-4">
                {fastqFiles.map((file, index) => {
                  const label = sampleLabels[index];
                  if (!label) return null;
                  return (
                    <div
                      key={file.r2Key}
                      className="grid grid-cols-3 gap-4 p-4 bg-surface rounded-xl border border-border"
                    >
                      <p className="col-span-3 text-sm font-serif text-text-secondary mb-1">
                        {file.name}
                      </p>
                      <div>
                        <span className="block text-xs font-serif text-text-tertiary mb-1">Sample Name</span>
                        <p className="text-sm font-serif text-text-primary">{label.sampleName}</p>
                      </div>
                      <div>
                        <span className="block text-xs font-serif text-text-tertiary mb-1">Condition</span>
                        <p className="text-sm font-serif text-text-primary capitalize">{label.condition}</p>
                      </div>
                      <div>
                        <span className="block text-xs font-serif text-text-tertiary mb-1">Replicate</span>
                        <p className="text-sm font-serif text-text-primary">{label.replicate}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Algorithm Selection */}
          {fastqFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-12"
            >
              <h2 className="text-2xl font-serif text-text-primary mb-6">
                Select Analysis Algorithm
              </h2>

              <div className="space-y-4">
                <AlgorithmOption
                  algorithm="mageck"
                  label="MAGeCK"
                  description="Industry standard for CRISPR screen analysis (RRA algorithm)"
                  checked={selectedAlgorithms.includes("mageck")}
                  onChange={() => handleToggleAlgorithm("mageck")}
                />

                <AlgorithmOption
                  algorithm="bagel2"
                  label="BAGEL2"
                  description="Essential gene prediction using Bayes Factors"
                  checked={selectedAlgorithms.includes("bagel2")}
                  onChange={() => handleToggleAlgorithm("bagel2")}
                />

                <AlgorithmOption
                  algorithm="drugz"
                  label="DrugZ"
                  description="Robust statistical analysis with improved normalization"
                  checked={selectedAlgorithms.includes("drugz")}
                  onChange={() => handleToggleAlgorithm("drugz")}
                />

                <button
                  onClick={() => setSelectedAlgorithms(["mageck", "bagel2", "drugz"])}
                  className="text-sm text-text-secondary hover:text-text-primary font-serif underline"
                >
                  Run all recommended
                </button>
              </div>
            </motion.div>
          )}

          {/* Advanced Options */}
          {fastqFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-12"
            >
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xl font-serif text-text-primary mb-6 hover:text-text-secondary transition-colors"
              >
                <span>Advanced Options</span>
                {showAdvanced ? (
                  <ChevronUp className="w-5 h-5" strokeWidth={1.5} />
                ) : (
                  <ChevronDown className="w-5 h-5" strokeWidth={1.5} />
                )}
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-surface rounded-2xl p-8 shadow-card border border-border space-y-6"
                  >
                    {/* Statistical Thresholds */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-serif text-text-primary mb-3">
                          FDR Threshold
                          <span className="ml-2 text-xs text-text-tertiary">(α = 0.05 standard)</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={advancedOptions.fdrThreshold}
                          onChange={(e) =>
                            setAdvancedOptions((prev) => ({
                              ...prev,
                              fdrThreshold: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif focus:outline-none focus:border-text-primary"
                        />
                        <p className="text-sm text-text-tertiary mt-2">
                          False Discovery Rate cutoff
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-serif text-text-primary mb-3">
                          Log₂ FC Threshold
                          <span className="ml-2 text-xs text-text-tertiary">(|LFC| ≥ 1 recommended)</span>
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={advancedOptions.lfcThreshold}
                          onChange={(e) =>
                            setAdvancedOptions((prev) => ({
                              ...prev,
                              lfcThreshold: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif focus:outline-none focus:border-text-primary"
                        />
                        <p className="text-sm text-text-tertiary mt-2">
                          Minimum fold change for significance
                        </p>
                      </div>
                    </div>

                    {/* Normalization Method */}
                    <div>
                      <label className="block text-sm font-serif text-text-primary mb-3">
                        Normalization Method
                        <span className="ml-2 text-xs text-text-tertiary">
                          (Adjusts for sequencing depth differences)
                        </span>
                      </label>
                      <select
                        value={advancedOptions.normalizationMethod}
                        onChange={(e) =>
                          setAdvancedOptions((prev) => ({
                            ...prev,
                            normalizationMethod: e.target.value as any,
                          }))
                        }
                        className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif focus:outline-none focus:border-text-primary"
                      >
                        <option value="median">Median (Default - Robust to outliers)</option>
                        <option value="total">Total (Sum normalization)</option>
                        <option value="control">Control sgRNAs (Uses non-targeting controls)</option>
                        <option value="none">None (No normalization)</option>
                      </select>
                    </div>

                    {/* Quality Filters */}
                    <div>
                      <label className="block text-sm font-serif text-text-primary mb-3">
                        Minimum Reads per sgRNA
                        <span className="ml-2 text-xs text-text-tertiary">(Filter low-coverage sgRNAs)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={advancedOptions.minimumReads}
                        onChange={(e) =>
                          setAdvancedOptions((prev) => ({
                            ...prev,
                            minimumReads: parseInt(e.target.value),
                          }))
                        }
                        className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif focus:outline-none focus:border-text-primary"
                      />
                      <p className="text-sm text-text-tertiary mt-2">
                        sgRNAs with fewer reads will be excluded (30 recommended)
                      </p>
                    </div>

                    {/* Gene Filtering */}
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="removeRibosomal"
                        checked={advancedOptions.removeRibosomal}
                        onChange={(e) =>
                          setAdvancedOptions((prev) => ({
                            ...prev,
                            removeRibosomal: e.target.checked,
                          }))
                        }
                        className="w-5 h-5 rounded border-border accent-accent"
                      />
                      <label
                        htmlFor="removeRibosomal"
                        className="text-sm font-serif text-text-primary cursor-pointer"
                      >
                        Remove ribosomal and mitochondrial genes
                      </label>
                    </div>
                    <p className="text-xs text-text-tertiary ml-8 -mt-3">
                      Excludes rRNA, tRNA, and mtDNA genes from analysis (recommended for most screens)
                    </p>

                    {/* sgRNA Offset */}
                    <div className="border-t border-border pt-6 mt-6">
                      <h4 className="font-serif font-medium text-text-primary mb-4">
                        Read Processing
                      </h4>
                      <div>
                        <label className="block text-sm font-serif text-text-primary mb-2">
                          Manual sgRNA Offset
                          <span className="ml-2 text-xs text-text-tertiary">(Optional)</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Auto-detect (Default)"
                          value={advancedOptions.sgRNAOffset ?? ''}
                          onChange={(e) =>
                            setAdvancedOptions((prev) => ({
                              ...prev,
                              sgRNAOffset: e.target.value === '' ? undefined : parseInt(e.target.value),
                            }))
                          }
                          className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif focus:outline-none focus:border-text-primary"
                        />
                        <p className="text-xs text-text-tertiary mt-2">
                          Position of the sgRNA within the read (0-based). Leave empty to use auto-detection.
                        </p>
                      </div>
                    </div>

                    {/* Control/Treatment Gene Lists */}
                    <div className="border-t border-border pt-6 mt-6">
                      <h4 className="font-serif font-medium text-text-primary mb-4">
                        Positive/Negative Control Genes (Optional)
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-serif text-text-primary mb-2">
                            Essential Genes
                            <span className="ml-2 text-xs text-text-tertiary">(Expected depleted)</span>
                          </label>
                          <textarea
                            value={advancedOptions.essentialGenes}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                essentialGenes: e.target.value,
                              }))
                            }
                            placeholder="TP53, MYC, KRAS..."
                            rows={3}
                            className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif text-sm focus:outline-none focus:border-text-primary"
                          />
                          <p className="text-xs text-text-tertiary mt-1">
                            Comma-separated list for ROC analysis
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-serif text-text-primary mb-2">
                            Non-Essential Genes
                            <span className="ml-2 text-xs text-text-tertiary">(Expected neutral)</span>
                          </label>
                          <textarea
                            value={advancedOptions.nonEssentialGenes}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                nonEssentialGenes: e.target.value,
                              }))
                            }
                            placeholder="Gene names..."
                            rows={3}
                            className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif text-sm focus:outline-none focus:border-text-primary"
                          />
                          <p className="text-xs text-text-tertiary mt-1">
                            For precision-recall calculations
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Advanced Pipeline Options */}
                    <details className="border border-border rounded-lg p-4 mt-6">
                      <summary className="font-serif font-medium text-text-primary cursor-pointer">
                        Advanced Pipeline Options
                      </summary>
                      <div className="mt-4 space-y-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={advancedOptions.runCNVCorrection}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                runCNVCorrection: e.target.checked,
                              }))
                            }
                            className="w-5 h-5 rounded border-border accent-accent"
                          />
                          <span className="text-sm font-serif text-text-primary">
                            Run copy number correction (CNV-aware analysis)
                          </span>
                        </label>

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={advancedOptions.generatePlots}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                generatePlots: e.target.checked,
                              }))
                            }
                            className="w-5 h-5 rounded border-border accent-accent"
                          />
                          <span className="text-sm font-serif text-text-primary">
                            Generate volcano plots and heatmaps
                          </span>
                        </label>

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={advancedOptions.calculateCorrelations}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                calculateCorrelations: e.target.checked,
                              }))
                            }
                            className="w-5 h-5 rounded border-border accent-accent"
                          />
                          <span className="text-sm font-serif text-text-primary">
                            Calculate sample correlations and QC metrics
                          </span>
                        </label>

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={advancedOptions.exportIntermediateFiles}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                exportIntermediateFiles: e.target.checked,
                              }))
                            }
                            className="w-5 h-5 rounded border-border accent-accent"
                          />
                          <span className="text-sm font-serif text-text-primary">
                            Export intermediate count files
                          </span>
                        </label>

                        <div>
                          <label className="block text-sm font-serif text-text-primary mb-2">
                            Number of permutations (BAGEL2)
                          </label>
                          <input
                            type="number"
                            value={advancedOptions.bagelPermutations}
                            onChange={(e) =>
                              setAdvancedOptions((prev) => ({
                                ...prev,
                                bagelPermutations: parseInt(e.target.value),
                              }))
                            }
                            className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif focus:outline-none focus:border-text-primary"
                          />
                        </div>
                      </div>
                    </details>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Submit error */}
          {submitError && (
            <div className="p-4 bg-error/10 border border-error/30 rounded-xl">
              <p className="text-sm text-error">{submitError}</p>
            </div>
          )}

          {/* Submit Button */}
          {fastqFiles.length > 0 && libraryType && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Button
                variant="primary"
                size="lg"
                onClick={handleAnalyze}
                disabled={selectedAlgorithms.length === 0 || analyzing}
                className="w-full group"
              >
                <span className="flex items-center justify-center gap-3">
                  <span>{analyzing ? "Creating analysis…" : "Start Analysis"}</span>
                  <ArrowRight
                    className="w-5 h-5 group-hover:translate-x-1 transition-transform"
                    strokeWidth={1.5}
                  />
                </span>
              </Button>
            </motion.div>
          )}
        </div>
      </div>

      {/* Sample Labeling Modal - edit only; labels stay visible on page when closed */}
      <AnimatePresence>
        {showSampleLabelModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm flex items-center justify-center z-50 p-6"
            onClick={() => setShowSampleLabelModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-2xl p-8 max-w-3xl w-full max-h-[80vh] overflow-auto shadow-elevated"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-serif text-text-primary">Edit sample labels</h3>
                <button
                  onClick={() => setShowSampleLabelModal(false)}
                  className="p-2 hover:bg-background rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-text-secondary" strokeWidth={1.5} />
                </button>
              </div>

              <div className="space-y-6">
                {sampleLabels.map((label, index) => (
                  <div
                    key={label.fileId}
                    className="p-6 bg-background rounded-xl border border-border-light space-y-4"
                  >
                    <p className="font-serif text-text-primary font-medium">{label.fileName}</p>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-serif text-text-secondary mb-2">
                          Sample Name
                        </label>
                        <input
                          type="text"
                          value={label.sampleName}
                          onChange={(e) => {
                            const newLabels = [...sampleLabels];
                            newLabels[index].sampleName = e.target.value;
                            setSampleLabels(newLabels);
                          }}
                          className="w-full px-4 py-2 bg-surface border border-border rounded-lg text-sm font-serif focus:outline-none focus:border-text-primary"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-serif text-text-secondary mb-2">
                          Condition
                        </label>
                        <select
                          value={label.condition}
                          onChange={(e) => {
                            const newLabels = [...sampleLabels];
                            newLabels[index].condition = e.target.value as "treatment" | "control";
                            setSampleLabels(newLabels);
                          }}
                          className="w-full px-4 py-2 bg-surface border border-border rounded-lg text-sm font-serif focus:outline-none focus:border-text-primary"
                        >
                          <option value="control">Control</option>
                          <option value="treatment">Treatment</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-serif text-text-secondary mb-2">
                          Replicate
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={label.replicate}
                          onChange={(e) => {
                            const newLabels = [...sampleLabels];
                            newLabels[index].replicate = parseInt(e.target.value) || 1;
                            setSampleLabels(newLabels);
                          }}
                          className="w-full px-4 py-2 bg-surface border border-border rounded-lg text-sm font-serif focus:outline-none focus:border-text-primary"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-border-light">
                <Button variant="secondary" onClick={() => setShowSampleLabelModal(false)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowSampleLabelModal(false);
                    // Auto-save
                    localStorage.setItem("splicr_sample_labels", JSON.stringify(sampleLabels));
                  }}
                >
                  <Save className="w-4 h-4 mr-2" strokeWidth={1.5} />
                  Save Labels
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AlgorithmOption({
  algorithm,
  label,
  description,
  checked,
  onChange,
}: {
  algorithm: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-4 p-6 bg-surface rounded-xl border-2 border-border hover:border-text-primary cursor-pointer transition-all duration-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-5 h-5 mt-0.5 rounded border-border accent-accent"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-serif text-text-primary font-medium">{label}</span>
          <Info className="w-4 h-4 text-text-tertiary" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-text-secondary font-serif leading-relaxed">
          {description}
        </p>
      </div>
    </label>
  );
}
