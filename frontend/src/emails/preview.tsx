import { AnalysisCompleteEmail } from '../lib/email/templates/analysis-complete';

/**
 * Email Preview for Development
 * 
 * Run: npx email dev
 * Then open: http://localhost:3001
 * 
 * This allows you to preview the email template in your browser
 * and see how it looks in different email clients.
 */
export default function PreviewEmail() {
  return (
    <AnalysisCompleteEmail
      userName="Dr. Jane Smith"
      userEmail="jane@cornell.edu"
      screenName="Drug Resistance Screen - BRCA1 Knockout"
      completedAt="February 3, 2026 at 2:30 PM"
      duration="15m 32s"
      significantHits={127}
      topGene="BRCA1"
      enrichmentScore={3.45}
      resultsUrl="https://splicr.io/analysis/abc123"
    />
  );
}
