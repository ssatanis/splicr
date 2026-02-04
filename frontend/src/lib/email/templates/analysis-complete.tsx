import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { AnalysisCompleteEmailProps } from '../types';

export const AnalysisCompleteEmail: React.FC<AnalysisCompleteEmailProps> = ({
  userName = 'Researcher',
  screenName = 'Test Screen',
  completedAt = 'Just now',
  duration = '15m',
  significantHits = 0,
  topGene = 'N/A',
  enrichmentScore = 0,
  resultsUrl = 'https://splicr.io',
}) => {
  const previewText = `Your SplicR analysis "${screenName}" is complete with ${significantHits} significant hits`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={headerTitle}>SplicR</Heading>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            {/* Greeting */}
            <Text style={greeting}>Hi {userName},</Text>

            {/* Success Message */}
            <Heading style={h1}>Your Analysis is Complete! ✓</Heading>

            {/* Analysis Details */}
            <Section style={detailsBox}>
              <table style={detailsTable}>
                <tbody>
                  <tr>
                    <td style={detailsLabel}>Screen Name:</td>
                    <td style={detailsValue}>{screenName}</td>
                  </tr>
                  <tr>
                    <td style={detailsLabel}>Completed:</td>
                    <td style={detailsValueRight}>{completedAt}</td>
                  </tr>
                  <tr>
                    <td style={detailsLabel}>Duration:</td>
                    <td style={detailsValueRight}>{duration}</td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {/* Key Results */}
            <Section style={resultsBox}>
              <Heading style={resultsHeading}>Key Results</Heading>
              <table style={{ width: '100%', marginTop: '16px' }}>
                <tbody>
                  <tr>
                    <td style={resultsLabel}>Significant hits:</td>
                    <td style={resultsValue}>{significantHits.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={resultsLabel}>Top gene:</td>
                    <td style={resultsValueGene}>{topGene}</td>
                  </tr>
                  <tr>
                    <td style={resultsLabel}>Enrichment score:</td>
                    <td style={resultsValueScore}>
                      {typeof enrichmentScore === 'number' ? enrichmentScore.toFixed(2) : enrichmentScore}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {/* CTA Button */}
            <Section style={buttonContainer}>
              <Button style={button} href={resultsUrl}>
                View Full Results →
              </Button>
            </Section>

            {/* Help Text */}
            <Text style={helpText}>
              Need help? Visit{' '}
              <Link href="https://docs.splicr.io" style={link}>
                docs.splicr.io
              </Link>
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              <strong>SplicR</strong> - Cornell University
            </Text>
            <Text style={footerLinks}>
              <Link href="https://splicr.io/settings" style={footerLink}>
                Settings
              </Link>
              {' · '}
              <Link href="https://splicr.io/settings?tab=notifications" style={footerLink}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default AnalysisCompleteEmail;

// ============================================================================
// STYLES - SplicR Brand Colors
// ============================================================================

const main = {
  backgroundColor: '#f5f5f5',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '40px auto',
  borderRadius: '12px',
  overflow: 'hidden',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  maxWidth: '600px',
};

const header = {
  backgroundColor: '#32808D', // SplicR teal
  padding: '32px',
  textAlign: 'center' as const,
};

const headerTitle = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: '600',
  margin: '0',
  letterSpacing: '-0.5px',
};

const content = {
  padding: '40px 32px',
};

const greeting = {
  color: '#1f2121',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 24px 0',
};

const h1 = {
  color: '#1f2121',
  fontSize: '20px',
  fontWeight: '600',
  lineHeight: '28px',
  margin: '0 0 24px 0',
};

const detailsBox = {
  backgroundColor: '#f9f9f9',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '24px',
};

const detailsTable = {
  width: '100%',
  borderCollapse: 'collapse' as const,
};

const detailsLabel = {
  color: '#626c7c',
  fontSize: '14px',
  padding: '8px 0',
};

const detailsValue = {
  color: '#1f2121',
  fontSize: '14px',
  fontWeight: '500',
  textAlign: 'right' as const,
  padding: '8px 0',
};

const detailsValueRight = {
  color: '#1f2121',
  fontSize: '14px',
  textAlign: 'right' as const,
  padding: '8px 0',
};

const resultsBox = {
  backgroundColor: '#eef9fa',
  border: '1px solid #32B8C6',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '32px',
};

const resultsHeading = {
  color: '#1f2121',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0',
};

const resultsLabel = {
  color: '#1f2121',
  fontSize: '14px',
  padding: '8px 0',
};

const resultsValue = {
  color: '#32808D',
  fontSize: '18px',
  fontWeight: '600',
  textAlign: 'right' as const,
  padding: '8px 0',
};

const resultsValueGene = {
  color: '#1f2121',
  fontSize: '16px',
  fontWeight: '500',
  textAlign: 'right' as const,
  padding: '8px 0',
};

const resultsValueScore = {
  color: '#1f2121',
  fontSize: '16px',
  fontWeight: '500',
  textAlign: 'right' as const,
  padding: '8px 0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  marginBottom: '32px',
};

const button = {
  backgroundColor: '#32808D',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
};

const helpText = {
  color: '#626c7c',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0',
  textAlign: 'center' as const,
};

const link = {
  color: '#32808D',
  textDecoration: 'none',
};

const footer = {
  backgroundColor: '#f9f9f9',
  borderTop: '1px solid #e5e7eb',
  padding: '24px 32px',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#626c7c',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0 0 8px 0',
};

const footerLinks = {
  color: '#626c7c',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0',
};

const footerLink = {
  color: '#32808D',
  textDecoration: 'none',
};
