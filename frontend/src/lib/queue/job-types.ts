/**
 * Type definitions for analysis job queue
 */

export interface AnalysisJobData {
  analysisId: string;
  userId: string;
  // Analysis configuration
  fileNames: string[];
  sampleLabels: any[];
  library: string;
  algorithms: string[];
  parameters: Record<string, any>;
  // Checkpoint data for resume
  checkpointData?: Record<string, any>;
}

export interface AnalysisJobResult {
  success: boolean;
  analysisId: string;
  error?: string;
  results?: any;
}

export enum JobPriority {
  HIGH = 1,    // Paid users, re-runs
  NORMAL = 5,  // Default
  LOW = 10,    // Batch jobs, scheduled analyses
}

export interface JobOptions {
  priority?: JobPriority;
  attempts?: number;
  backoff?: {
    type: 'exponential';
    delay: number;
  };
  removeOnComplete?: boolean | number; // Keep completed jobs for N days
  removeOnFail?: boolean | number;     // Keep failed jobs for N days
  timeout?: number; // Job timeout in milliseconds
}
