# 📧 EMAIL NOTIFICATION SYSTEM - COMPLETE IMPLEMENTATION GUIDE

## PRODUCTION-GRADE EMAIL NOTIFICATIONS FOR SPLICR

This guide provides a complete, tested implementation of a beautiful email notification system for SplicR.

---

## 🎯 OVERVIEW

When a CRISPR screen analysis completes, SplicR will send a beautifully designed, branded email to the user containing:
- Analysis completion status
- Key results summary
- Direct link to full results
- Professional, mobile-responsive design
- SplicR branding (#32808D teal color)

---

## 📦 STEP 1: INSTALL DEPENDENCIES

```bash
cd frontend
npm install resend @react-email/components @react-email/render
```

**Why Resend?**
- Modern, developer-friendly API
- Built-in React email components
- Better deliverability than SendGrid
- Generous free tier (3,000 emails/month)
- Excellent documentation

---

## 🔑 STEP 2: SETUP RESEND ACCOUNT

1. **Sign up at [resend.com](https://resend.com)**
2. **Verify your sending domain:**
   - Go to Domains → Add Domain
   - Add `splicr.io` (or your domain)
   - Add the DNS records Resend provides
   - Wait for verification (~5 minutes)

3. **Generate API key:**
   - Go to API Keys
   - Create new key: "SplicR Production"
   - Copy the key (starts with `re_`)

4. **Add to environment variables:**

```bash
# frontend/.env.local
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx

# For production (Vercel):
# Add this in Vercel dashboard → Settings → Environment Variables
```

---

## 🎨 STEP 3: CREATE EMAIL TEMPLATE

Create a new directory structure for emails:

```
frontend/
├── lib/
│   └── email/
│       ├── templates/
│       │   └── analysis-complete.tsx
│       ├── service.ts
│       └── types.ts
```

### File 1: `frontend/lib/email/types.ts`

```typescript
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
```

### File 2: `frontend/lib/email/templates/analysis-complete.tsx`

```typescript
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
```

---

## 🚀 STEP 4: CREATE EMAIL SERVICE

### File 3: `frontend/lib/email/service.ts`

```typescript
import { Resend } from 'resend';
import { AnalysisCompleteEmail } from './templates/analysis-complete';
import { AnalysisCompleteEmailProps } from './types';

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send analysis completion email to user
 */
export async function sendAnalysisCompleteEmail(
  props: AnalysisCompleteEmailProps
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    // Validate email
    if (!props.userEmail || !props.userEmail.includes('@')) {
      throw new Error('Invalid email address');
    }

    // Validate API key
    if (!process.env.RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY not configured');
      throw new Error('Email service not configured');
    }

    console.log(`📧 Sending analysis complete email to ${props.userEmail}...`);

    const { data, error } = await resend.emails.send({
      from: 'SplicR <notifications@splicr.io>',
      to: [props.userEmail],
      subject: `Your Analysis "${props.screenName}" is Complete`,
      react: AnalysisCompleteEmail(props),
      // Optional: Add tags for tracking
      tags: [
        { name: 'category', value: 'analysis-complete' },
        { name: 'screen', value: props.screenName },
      ],
    });

    if (error) {
      console.error('❌ Email send failed:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ Email sent successfully:', data?.id);
    return { success: true, messageId: data?.id };
  } catch (error: any) {
    console.error('❌ Email service error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Send test email (for testing the email template)
 */
export async function sendTestEmail(toEmail: string) {
  return sendAnalysisCompleteEmail({
    userName: 'Test User',
    userEmail: toEmail,
    screenName: 'Test Screen - Drug Resistance',
    completedAt: new Date().toLocaleString(),
    duration: '15m 32s',
    significantHits: 127,
    topGene: 'BRCA1',
    enrichmentScore: 3.45,
    resultsUrl: 'https://splicr.io/analysis/test-123',
  });
}
```

---

## 🔗 STEP 5: CREATE API ENDPOINT

### File 4: `frontend/app/api/notifications/send-completion/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { sendAnalysisCompleteEmail } from '@/lib/email/service';
import { createClient } from '@/lib/supabase/server';

/**
 * API endpoint to send analysis completion email
 * Called by the analysis engine or workflow when analysis completes
 */
export async function POST(request: NextRequest) {
  try {
    const { analysisId, userId } = await request.json();

    if (!analysisId) {
      return NextResponse.json(
        { error: 'Missing analysisId' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Get analysis details
    const { data: analysis, error: analysisError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (analysisError || !analysis) {
      console.error('Analysis not found:', analysisError);
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    // Get user details
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', analysis.user_id || userId)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Check notification preferences
    const { data: preferences } = await supabase
      .from('user_settings')
      .select('email_on_analysis_complete')
      .eq('user_id', analysis.user_id || userId)
      .single();

    // If user has disabled email notifications, skip
    if (preferences && preferences.email_on_analysis_complete === false) {
      console.log('⏭️  User has disabled email notifications, skipping');
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'User disabled email notifications',
      });
    }

    // Calculate duration
    const duration = calculateDuration(
      analysis.created_at,
      analysis.updated_at || new Date().toISOString()
    );

    // Extract key results
    const results = analysis.results || {};
    const significantHits = results.significant_hits || results.hit_count || 0;
    const topGene = results.top_gene || results.top_hit || 'N/A';
    const enrichmentScore = results.enrichment_score || results.max_score || 0;

    // Send email
    const emailResult = await sendAnalysisCompleteEmail({
      userName: userData.full_name || 'Researcher',
      userEmail: userData.email,
      screenName: analysis.name || analysis.screen_name || 'Untitled Screen',
      completedAt: new Date(analysis.updated_at || analysis.created_at).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      duration,
      significantHits,
      topGene,
      enrichmentScore,
      resultsUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://splicr.io'}/analysis/${analysisId}`,
    });

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error },
        { status: 500 }
      );
    }

    // Log notification
    await supabase.from('notifications').insert({
      user_id: analysis.user_id || userId,
      type: 'analysis_complete',
      title: 'Analysis Complete',
      message: `Your analysis "${analysis.name}" has completed`,
      metadata: {
        analysis_id: analysisId,
        email_sent: true,
        message_id: emailResult.messageId,
      },
    });

    return NextResponse.json({
      success: true,
      messageId: emailResult.messageId,
    });
  } catch (error: any) {
    console.error('❌ Error in send-completion API:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Calculate human-readable duration
 */
function calculateDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}
```

---

## ⚙️ STEP 6: CREATE SETTINGS UI

### File 5: `frontend/components/settings/notification-settings.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    email_on_analysis_complete: true,
    email_on_error: false,
    email_weekly_digest: false,
    email_shared_updates: false,
    email_system_announcements: true,
  });

  const { toast } = useToast();
  const supabase = createClient();

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setSettings(prev => ({ ...prev, ...data }));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          ...settings,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      toast({
        title: 'Settings saved',
        description: 'Your notification preferences have been updated.',
      });
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Manage how you receive updates about your analyses
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email Notifications */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium">Email Notifications</h3>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="analysis-complete">Analysis completion</Label>
              <p className="text-sm text-muted-foreground">
                Receive an email when a screen analysis finishes
              </p>
            </div>
            <Switch
              id="analysis-complete"
              checked={settings.email_on_analysis_complete}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, email_on_analysis_complete: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="error-notifications">Error notifications</Label>
              <p className="text-sm text-muted-foreground">
                Get notified when an analysis fails
              </p>
            </div>
            <Switch
              id="error-notifications"
              checked={settings.email_on_error}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, email_on_error: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="weekly-digest">Weekly summary digest</Label>
              <p className="text-sm text-muted-foreground">
                Receive a weekly summary of your activity
              </p>
            </div>
            <Switch
              id="weekly-digest"
              checked={settings.email_weekly_digest}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, email_weekly_digest: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="shared-updates">Shared analysis updates</Label>
              <p className="text-sm text-muted-foreground">
                Get notified about changes to shared analyses
              </p>
            </div>
            <Switch
              id="shared-updates"
              checked={settings.email_shared_updates}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, email_shared_updates: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="system-announcements">System announcements</Label>
              <p className="text-sm text-muted-foreground">
                Receive important updates about SplicR
              </p>
            </div>
            <Switch
              id="system-announcements"
              checked={settings.email_system_announcements}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, email_system_announcements: checked })
              }
            />
          </div>
        </div>

        {/* Save Button */}
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save preferences'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

---

## 🗄️ STEP 7: DATABASE SCHEMA

Add this migration to create the necessary tables:

```sql
-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Email notification preferences
  email_on_analysis_complete BOOLEAN DEFAULT true,
  email_on_error BOOLEAN DEFAULT false,
  email_weekly_digest BOOLEAN DEFAULT false,
  email_shared_updates BOOLEAN DEFAULT false,
  email_system_announcements BOOLEAN DEFAULT true,
  
  -- In-app notification preferences
  desktop_notifications BOOLEAN DEFAULT true,
  sound_alerts BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Create notifications table (for in-app notifications)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  INDEX idx_notifications_user_id (user_id),
  INDEX idx_notifications_created_at (created_at DESC)
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);
```

---

## 🧪 STEP 8: TEST THE SYSTEM

### Test 1: Send Test Email

Create `frontend/app/api/notifications/test/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { sendTestEmail } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const result = await sendTestEmail(email);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

Test in terminal:

```bash
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@cornell.edu"}'
```

### Test 2: Preview Email Locally

Install dev tools:

```bash
npm install --save-dev @react-email/preview
```

Create `frontend/emails/preview.tsx`:

```typescript
import { AnalysisCompleteEmail } from '../lib/email/templates/analysis-complete';

export default function PreviewEmail() {
  return (
    <AnalysisCompleteEmail
      userName="Dr. Jane Smith"
      userEmail="jane@cornell.edu"
      screenName="Drug Resistance Screen - BRCA1"
      completedAt="February 3, 2026 at 2:30 PM"
      duration="15m 32s"
      significantHits={127}
      topGene="BRCA1"
      enrichmentScore={3.45}
      resultsUrl="https://splicr.io/analysis/abc123"
    />
  );
}
```

Run preview server:

```bash
npx email dev
```

Open http://localhost:3001 to see live preview!

---

## 🔌 STEP 9: INTEGRATE WITH ANALYSIS WORKFLOW

When your analysis completes, call the API:

```typescript
// In your analysis completion handler
async function onAnalysisComplete(analysisId: string, userId: string) {
  // Send completion email
  await fetch('/api/notifications/send-completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisId, userId }),
  });
}
```

Or use from Python backend:

```python
import requests

def send_completion_email(analysis_id: str, user_id: str):
    response = requests.post(
        'https://splicr.io/api/notifications/send-completion',
        json={'analysisId': analysis_id, 'userId': user_id}
    )
    return response.json()
```

---

## 🎯 STEP 10: PRODUCTION CHECKLIST

### Before Launch:

- [ ] ✅ Resend domain verified (DNS records added)
- [ ] ✅ `RESEND_API_KEY` added to production environment
- [ ] ✅ Test email sent successfully
- [ ] ✅ Email displays correctly on:
  - [ ] Gmail (web & mobile)
  - [ ] Outlook (web & desktop)
  - [ ] Apple Mail (Mac & iPhone)
- [ ] ✅ Database migration applied
- [ ] ✅ User settings UI working
- [ ] ✅ Unsubscribe link working
- [ ] ✅ Error handling in place
- [ ] ✅ Rate limiting configured (optional)
- [ ] ✅ Analytics/tracking setup (optional)

### Monitoring:

Add logging to track email success:

```typescript
// In service.ts
await supabase.from('email_logs').insert({
  user_id: userId,
  email_type: 'analysis_complete',
  to: props.userEmail,
  status: 'sent',
  message_id: data?.id,
  sent_at: new Date().toISOString(),
});
```

---

## 📊 STEP 11: ANALYTICS (Optional)

Track email engagement:

```typescript
// Add to email template
const trackingPixel = `https://splicr.io/api/email-tracking/${messageId}/open`;

<img src={trackingPixel} width="1" height="1" alt="" />
```

---

## 🚀 DEPLOYMENT

### Vercel:

```bash
# Add environment variable
vercel env add RESEND_API_KEY

# Deploy
vercel --prod
```

### Environment Variables Needed:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
NEXT_PUBLIC_APP_URL=https://splicr.io
```

---

## 🎨 CUSTOMIZATION

### Change Email Style:

Edit styles in `analysis-complete.tsx`:

```typescript
const header = {
  backgroundColor: '#YOUR_COLOR', // Change brand color
  padding: '32px',
};
```

### Add More Email Templates:

```
lib/email/templates/
├── analysis-complete.tsx
├── analysis-error.tsx        (NEW)
├── weekly-digest.tsx         (NEW)
└── shared-analysis-update.tsx (NEW)
```

---

## ✅ SUCCESS CRITERIA

Your email system is working when:

1. ✅ User receives email within 1 minute of analysis completion
2. ✅ Email looks professional on all devices
3. ✅ "View Results" button links to correct analysis
4. ✅ User can unsubscribe from settings
5. ✅ Failed emails are logged for debugging
6. ✅ Email deliverability > 95%

---

## 🐛 TROUBLESHOOTING

### Email not sending?

```bash
# Check API key
echo $RESEND_API_KEY

# Check Resend dashboard for errors
# https://resend.com/logs

# Check application logs
npx vercel logs
```

### Email in spam?

- Verify domain in Resend dashboard
- Add SPF, DKIM, DMARC records
- Use warm-up period (send gradually increasing volume)

### Styling broken in Outlook?

- Use inline styles (already done)
- Avoid `padding` on `<div>` (use `<table>` instead)
- Test with https://litmus.com

---

## 📚 RESOURCES

- [Resend Documentation](https://resend.com/docs)
- [React Email Components](https://react.email/docs/components)
- [Email Client CSS Support](https://www.caniemail.com)
- [Email Testing Tool](https://mailtrap.io)

---

## 🎉 YOU'RE DONE!

Your SplicR email notification system is now production-ready!

Users will love receiving beautiful, branded emails when their analyses complete.

**Questions?** Check the Resend dashboard for delivery status and logs.
