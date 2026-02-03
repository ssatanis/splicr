export interface AnalysisCompleteEmailProps {
  userName: string;
  userEmail: string;
  screenName: string;
  completedAt: string;
  duration: string;
  significantHits: number;
  topGene: string;
  enrichmentScore: number;
  resultsUrl: string;
}
