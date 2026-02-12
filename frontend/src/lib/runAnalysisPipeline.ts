/**
 * Server-only: runs the analysis pipeline and persists results to the database.
 * Used by both create (direct call) and run API (POST /api/analysis/[id]/run).
 * Runs real sequencing processing: fetches FASTQ from R2, parses, runs MAGeCK/BAGEL2/DrugZ, saves results.
 * Do not import from client code.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isR2Configured } from '@/lib/storage/r2-client';
import { downloadR2FileToDisk } from '@/lib/storage/r2-get';
import path from 'path';
import fs from 'fs';
import { putR2Json } from '@/lib/storage/r2-put';
import { AnalysisPipeline } from '@/lib/analysis/pipeline';
import { assessQCStatus } from '@/lib/analysis/quality-calculator';
import { getLibraryMetadata } from '@/lib/analysis/sgRNALibraries';
import { createWorkingDir, cleanupWorkingDir } from '@/lib/analysis/cli-utils';
import crypto from 'crypto';

async function updateProgress(admin: any, analysisId: string, progress: number, currentStep: string, logs: any[]) {
  const { error } = await admin
    .from('analyses')
    .update({
      progress,
      current_step: currentStep,
      logs,
    })
    .eq('id', analysisId);
  if (error) console.error('updateProgress error:', error);
}

/** Map pipeline output to DB results shape. Count matrix is stored in R2 (countMatrixR2Key), not in DB, to avoid OOM. */
function pipelineResultsToDbResults(
  analysisId: string,
  pr: import('@/lib/analysis/pipeline').PipelineResults,
  countMatrixR2Key: string | null
) {
  const qc = pr.qcMetrics;
  const mappingRatePct = Math.round(qc.mappingRate * 1000) / 10;
  const libraryCoveragePct = Math.round(qc.libraryCoverage * 1000) / 10;
  const sgRNAsDetected = pr.rawData?.countMatrix ? Object.keys(pr.rawData.countMatrix).length : undefined;
  const qcAssessment = assessQCStatus({
    totalReads: qc.totalReads,
    mappedReads: qc.mappedReads,
    mappingRate: qc.mappingRate,
    libraryCoverage: qc.libraryCoverage,
    zeroCounts: qc.zeroCounts,
    giniCoefficient: qc.giniCoefficient,
    sgRNAsDetected,
  });
  return {
    id: analysisId,
    resultsSource: 'pipeline' as const,
    summary: pr.summary,
    qcMetrics: {
      ...qc,
      mappingRate: mappingRatePct,
      libraryCoverage: libraryCoveragePct,
      sampleStats: qc.sampleStats?.map((s) => ({
        ...s,
        mappingRate: typeof s.mappingRate === 'number' ? Math.round(s.mappingRate * 1000) / 10 : s.mappingRate,
      })),
    },
    qcAssessment,
    topHits: {
      depleted: pr.topHits.depleted.map((r) => ({ gene: r.gene, sgrnaCount: r.numSgRNAs, logFoldChange: r.log2FC, pValue: r.pValue, fdr: r.fdr, rank: r.rank })),
      enriched: pr.topHits.enriched.map((r) => ({ gene: r.gene, sgrnaCount: r.numSgRNAs, logFoldChange: r.log2FC, pValue: r.pValue, fdr: r.fdr, rank: r.rank })),
    },
    allGenes: pr.unifiedResults.map((r, i) => ({ gene: r.gene, sgrnaCount: r.numSgRNAs, logFoldChange: r.log2FC, pValue: r.pValue, fdr: r.fdr, rank: r.rank ?? i + 1 })),
    volcanoData: pr.volcanoData,
    rawData: countMatrixR2Key ? { countMatrixR2Key } : {},
    logs: pr.logs,
    plots: {},
    rawFiles: {
      counts: `/api/analysis/${analysisId}/download/counts`,
      geneSummary: `/api/analysis/${analysisId}/download/genes`,
      sgrnaSummary: `/api/analysis/${analysisId}/download/sgrnas`,
    },
  };
}

export type RunAnalysisPipelineOptions = {
  /** Optional callback for progress (e.g. worker heartbeat). Called on each pipeline progress update. */
  onProgress?: (progress: number, step: string, log: unknown) => void | Promise<void>;
};

/**
 * Run the analysis pipeline and persist status/results to the database.
 * Fetches FASTQ files from R2, runs real parsing and MAGeCK/BAGEL2/DrugZ, saves real results.
 * Call this directly from create or run API; do not trigger via HTTP self-call.
 */
export async function runAnalysisPipeline(
  analysisId: string,
  analysis: any,
  options?: RunAnalysisPipelineOptions
): Promise<void> {
  const admin = supabaseAdmin as any;
  const logs: any[] = [];
  const algorithms = Array.isArray(analysis.parameters?.algorithms)
    ? analysis.parameters.algorithms
    : [analysis.method || 'mageck'].filter(Boolean);
  const sampleLabels = analysis.sample_labels || analysis.parameters?.sampleLabels || [];
  const fileNames = analysis.file_names || analysis.parameters?.r2Keys || [];

  const addLog = (step: string, message: string, progress: number, level: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    logs.push({ timestamp: new Date().toISOString(), step, message, progress, level });
  };

  try {
    if (!fileNames?.length) {
      throw new Error('No FASTQ files provided. Upload FASTQ files when creating the analysis.');
    }
    if (!isR2Configured()) {
      throw new Error('R2 storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY to run analyses.');
    }

    const libraryType = (analysis.library || analysis.library_type || 'brunello') as string;
    const parameters = {
      fdrThreshold: analysis.parameters?.fdrThreshold ?? analysis.parameters?.fdr_threshold ?? 0.05,
      lfcThreshold: analysis.parameters?.lfcThreshold ?? analysis.parameters?.lfc_threshold ?? 1,
      normalizationMethod: (analysis.parameters?.normalizationMethod ?? analysis.parameters?.normalization ?? 'median') as 'median' | 'total' | 'control' | 'none',
      minimumReads: analysis.parameters?.minimumReads ?? analysis.parameters?.min_reads ?? 30,
      removeRibosomal: analysis.parameters?.removeRibosomal ?? true,
      essentialGenes: analysis.parameters?.essentialGenes ?? analysis.parameters?.essential_genes,
      nonEssentialGenes: analysis.parameters?.nonEssentialGenes ?? analysis.parameters?.non_essential_genes,
      bagelPermutations: analysis.parameters?.bagelPermutations ?? analysis.parameters?.bagel_permutations ?? 1000,
    };

    // Log run context (sgRNA library, FASTQ files, tests, settings) for reproducibility
    addLog('Context', '--- Run context (this analysis) ---', 0, 'info');
    try {
      const libMeta = getLibraryMetadata(libraryType);
      addLog('Context', `sgRNA library: ${libraryType} (${libMeta.name}, ${libMeta.totalSgRNAs} sgRNAs, ${libMeta.totalGenes} genes)`, 0, 'info');
    } catch {
      addLog('Context', `sgRNA library: ${libraryType}`, 0, 'info');
    }
    fileNames.forEach((key: string, i: number) => {
      const fileName = typeof key === 'string' ? key.split('/').pop() ?? key : `sample_${i + 1}.fastq.gz`;
      const label = sampleLabels[i];
      const sampleName = label?.sampleName ?? label?.fileName ?? fileName;
      const condition = label?.condition ?? (i === 0 ? 'control' : 'treatment');
      addLog('Context', `FASTQ: ${fileName} | sample: ${sampleName} | ${condition}`, 0, 'info');
    });
    const algDisplay = algorithms.map((a: string) => (a === 'mageck' ? 'MAGeCK' : a === 'bagel2' ? 'BAGEL2' : a === 'drugz' ? 'DrugZ' : a)).join(', ');
    addLog('Context', `Tests (algorithms): ${algDisplay}`, 0, 'info');
    addLog('Context', `Settings: FDR threshold=${parameters.fdrThreshold}, LFC threshold=${parameters.lfcThreshold}, normalization=${parameters.normalizationMethod}, min reads=${parameters.minimumReads}, remove ribosomal=${parameters.removeRibosomal}`, 0, 'info');
    if (parameters.bagelPermutations != null || algorithms.some((a: string) => String(a).toLowerCase() === 'bagel2')) {
      addLog('Context', `BAGEL2: permutations=${parameters.bagelPermutations ?? 1000}, essential/non-essential lists ${parameters.essentialGenes ? 'provided' : 'default'}`, 0, 'info');
    }
    addLog('Context', '--- End run context ---', 0, 'info');

    addLog('Initialization', 'Starting CRISPR screen analysis pipeline', 2, 'info');
    await updateProgress(admin, analysisId, 2, 'Initializing', logs);

    // Validate that all files exist in R2 before attempting to fetch
    addLog('Validation', 'Validating file availability in storage...', 3, 'info');
    await updateProgress(admin, analysisId, 3, 'Validating files...', logs);

    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const { createServerR2Client, R2_BUCKET_NAME } = await import('@/lib/storage/r2-client');
    const r2Client = createServerR2Client();
    const missingFiles: { key: string; fileName: string }[] = [];

    for (const key of fileNames) {
      const fileName = typeof key === 'string' ? key.split('/').pop() ?? key : 'unknown';
      try {
        await r2Client.send(new HeadObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
        }));
      } catch (err: any) {
        if (err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
          missingFiles.push({ key, fileName });
        } else {
          // Other errors (network, auth, etc.) - rethrow
          throw err;
        }
      }
    }

    if (missingFiles.length > 0) {
      const errorDetails = missingFiles.map(f => `  - ${f.fileName} (key: ${f.key})`).join('\n');
      const errorMsg = `Files not found in storage:\n${errorDetails}\n\nFiles must be uploaded before starting analysis.`;
      addLog('Error', errorMsg, 3, 'error');
      throw new Error(errorMsg);
    }

    addLog('Validation', 'All files exist in storage', 4, 'success');
    await updateProgress(admin, analysisId, 4, 'Files validated', logs);

    // Files are now downloaded later directly to disk
    addLog('Fetching', `Preparing to fetch ${fileNames.length} FASTQ file(s)...`, 5, 'info');
    await updateProgress(admin, analysisId, 5, `Preparing to fetch ${fileNames.length} FASTQ file(s)...`, logs);

    const fileMetadata = fileNames.map((key: string, i: number) => {
      const label = sampleLabels[i];
      const fileName = typeof key === 'string' ? key.split('/').pop() ?? key : `sample_${i + 1}`;
      return {
        fileName,
        condition: (label?.condition === 'control' ? 'control' : 'treatment') as 'control' | 'treatment',
        replicate: typeof label?.replicate === 'number' ? label.replicate : i + 1,
        sampleName: label?.sampleName ?? `Sample_${i + 1}`,
      };
    });

    // Create a temp working directory for analysis
    addLog('Initialization', 'Creating working directory for analysis', 14, 'info');
    await updateProgress(admin, analysisId, 14, 'Preparing pipeline', logs);
    const workingDir = createWorkingDir(analysisId);

    // Download files to working directory
    addLog('Fetching', `Downloading ${fileNames.length} FASTQ file(s) to temporary storage...`, 15, 'info');
    await updateProgress(admin, analysisId, 15, `Downloading ${fileNames.length} file(s)`, logs);

    const filePaths: string[] = [];
    for (let i = 0; i < fileNames.length; i++) {
      const key = fileNames[i];
      const fileName = typeof key === 'string' ? key.split('/').pop() ?? key : `sample_${i + 1}.fastq.gz`;
      const destPath = path.join(workingDir, fileName);

      const pct = 15 + Math.round(((i + 1) / fileNames.length) * 5); // 15-20%
      try {
        await downloadR2FileToDisk(key, destPath);
        filePaths.push(destPath);
        addLog('Fetching', `Downloaded ${fileName}`, pct, 'info');
        await updateProgress(admin, analysisId, pct, `Downloaded ${i + 1}/${fileNames.length} file(s)`, logs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to download ${fileName}: ${msg}`);
      }
    }

    addLog('Initialization', 'Starting sequence processing and sgRNA counting', 20, 'info');
    await updateProgress(admin, analysisId, 20, 'Starting sequence processing', logs);

    let pipelineResults;
    try {
      const pipeline = new AnalysisPipeline();

      // Enforce 30-minute timeout for the entire analysis
      const TIMEOUT_MS = 30 * 60 * 1000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timed out after 30 minutes')), TIMEOUT_MS);
      });

      pipelineResults = await Promise.race([
        pipeline.runPipeline(
          filePaths,
          fileMetadata,
          libraryType,
          algorithms,
          parameters,
          (progress, step, entry) => {
            logs.push(entry);
            // Scale pipeline progress (0-100) to remaining job progress (20-95)
            // Phase 1 (Prep) is 0-20%. Phase 2 (Pipeline) is 20-100%.
            const adjustedProgress = 20 + Math.round((progress / 100) * 75);

            // Use message for current_step when available (more descriptive for UI)
            const displayStep =
              entry?.message && typeof entry.message === 'string' && entry.message.length > 0 && entry.message.length < 120
                ? entry.message
                : step;

            // Update the entry's progress to match the global progress
            if (entry) entry.progress = adjustedProgress;

            updateProgress(admin, analysisId, adjustedProgress, displayStep, logs);
            void options?.onProgress?.(adjustedProgress, displayStep, entry);
          },
          workingDir
        ),
        timeoutPromise
      ]);
    } finally {
      cleanupWorkingDir(workingDir);
    }

    // Real processing verification (Part 10: verify it's real)
    const qc = pipelineResults.qcMetrics;
    const mappingRatePct = (qc.mappingRate * 100).toFixed(2);
    const coveragePct = (qc.libraryCoverage * 100).toFixed(2);
    console.log('=== REAL PROCESSING COMPLETE ===');
    console.log('Analysis ID:', analysisId);
    console.log('Total reads parsed:', qc.totalReads.toLocaleString());
    console.log('Mapped reads:', qc.mappedReads.toLocaleString());
    console.log('Mapping rate:', mappingRatePct + '%');
    console.log('Unique sgRNAs in matrix:', pipelineResults.rawData?.countMatrix ? Object.keys(pipelineResults.rawData.countMatrix).length : 'N/A');
    console.log('Coverage:', coveragePct + '%');
    console.log('Gini coefficient:', qc.giniCoefficient?.toFixed(3) ?? 'N/A');
    console.log('Summary: totalGenes=', pipelineResults.summary.totalGenes, 'significantHits=', pipelineResults.summary.significantHits);

    // Add verification signature to prove results differ by input
    const signatureContent = JSON.stringify({
      totalReads: qc.totalReads,
      mappedReads: qc.mappedReads,
      significantHits: pipelineResults.summary.significantHits,
      topGene: pipelineResults.topHits.depleted[0]?.gene || 'none'
    });
    const signature = crypto.createHash('sha256').update(signatureContent).digest('hex').substring(0, 16);
    console.log(`Verification Signature: ${signature}`);

    console.log('=== PROCESSING COMPLETE ===');

    let countMatrixR2Key: string | null = null;
    if (pipelineResults.rawData?.countMatrix && Object.keys(pipelineResults.rawData.countMatrix).length > 0) {
      const key = `analysis/${analysisId}/count-matrix.json`;
      try {
        await putR2Json(key, pipelineResults.rawData.countMatrix);
        countMatrixR2Key = key;
      } catch (e) {
        console.error('Failed to upload count matrix to R2:', e);
      }
    }

    const results = pipelineResultsToDbResults(analysisId, pipelineResults, countMatrixR2Key);
    addLog('Complete', 'Analysis completed successfully', 100, 'success');
    await updateProgress(admin, analysisId, 100, 'Complete', logs);

    // So the Logs tab shows run context (FASTQ, library, algorithms, settings) plus pipeline steps
    results.logs = logs;

    const { error: updateError } = await admin
      .from('analyses')
      .update({
        status: 'complete',
        progress: 100,
        current_step: 'Complete',
        completed_at: new Date().toISOString(),
        results,
        logs,
        error_message: null,
        error_traceback: null,
        worker_id: null,
        last_heartbeat: null,
        ...(countMatrixR2Key && { count_matrix_r2_key: countMatrixR2Key }),
      })
      .eq('id', analysisId);

    if (updateError) {
      console.error('Failed to save analysis results:', updateError);
      throw new Error(updateError.message || 'Failed to save results to database');
    }
  } catch (error) {
    console.error('Pipeline error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Pipeline execution failed';
    addLog('Error', errorMessage, logs[logs.length - 1]?.progress ?? 0, 'error');

    await admin
      .from('analyses')
      .update({
        status: 'failed',
        error_message: errorMessage,
        error_traceback: error instanceof Error ? error.stack : String(error),
        logs,
        worker_id: null,
        last_heartbeat: null,
      })
      .eq('id', analysisId);
  }
}
