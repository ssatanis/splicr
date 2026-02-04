# MAGeCK Execution Engine

Wraps the **official MAGeCK binary** for SplicR. Use when MAGeCK is installed (Docker, conda, or system). For in-process analysis without MAGeCK, use `mageckRRA.ts`.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Command Builder (mageck-command-builder.ts)        │
│  UI params → mageck count / test CLI args           │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Executor (mageck-executor.ts)                      │
│  spawn('mageck', args) → stream stdout              │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Progress Parser (mageck-progress-parser.ts)        │
│  Parse "Processing 5M reads" → progress callback    │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Result Parser (mageck-result-parser.ts)            │
│  Parse gene_summary.txt → unified format            │
└─────────────────────────────────────────────────────┘
```

## Usage

### When MAGeCK binary is available (Docker / HPC)

```ts
import { runMageckPipeline, mageckGeneToUnified } from '@/lib/analysis/mageck';

const result = await runMageckPipeline(
  {
    libraryPath: '/work/library.csv',
    fastqPaths: ['/work/ctrl1.fastq.gz', '/work/treat1.fastq.gz'],
    sampleLabels: ['Control', 'Treatment'],
    outputPrefix: 'analysis',
    normMethod: 'median',
  },
  {
    treatmentId: 'Treatment',
    controlId: 'Control',
    outputPrefix: 'results',
    geneTestFdrThreshold: 0.05,
  },
  {
    workingDir: '/tmp/analysis-123',
    mageckBinary: 'mageck',
    progressThrottleMs: 2000,
  },
  (p) => updateProgress(p.progress, p.message)
);

if (result.success) {
  const unified = result.geneSummary.map((r) =>
    mageckGeneToUnified(r, 0.05)
  );
}
```

### Command builder only (for logging / reproducibility)

```ts
import { buildMageckCountCommand, formatCommandForLog } from '@/lib/analysis/mageck';

const args = buildMageckCountCommand({ ... });
const logLine = formatCommandForLog('mageck', args);
// "mageck count -l library.csv --fastq a.fastq b.fastq ..."
```

### Error handling

```ts
import { detectMageckError } from '@/lib/analysis/mageck';

const err = detectMageckError(stderr);
// err.userMessage: human-readable
// err.suggestedAction: optional fix
// err.technicalMessage: raw output
```

## Docker integration

The `analysis-engine/docker/mageck/` container uses `run_mageck_streaming()` to stream MAGeCK output and report progress via `ProgressReporter` (API callback).

## References

- [MAGeCK SourceForge Wiki](https://sourceforge.net/p/mageck/wiki/Home/)
- [MAGeCK GitHub](https://github.com/davidliwei/MAGeCK)
- [NIH Biowulf MAGeCK](https://hpc.nih.gov/apps/MAGeCK.html)
