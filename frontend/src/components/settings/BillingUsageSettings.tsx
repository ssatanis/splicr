'use client';

import { useState, useEffect } from 'react';
import { CreditCard, BarChart3, HardDrive, Users, FileText, TrendingUp, Download } from 'lucide-react';
import Button from '@/components/Button';

const PLANS = [
  { id: 'standard', name: 'Standard', limits: { screens: 10, users: 1, storage: 10 } },
  { id: 'advanced', name: 'Advanced', limits: { screens: 50, users: 5, storage: 100 } },
  { id: 'enterprise', name: 'Enterprise', limits: { screens: -1, users: -1, storage: 1000 } },
];

export function BillingUsageSettings() {
  const [loading, setLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState('standard');
  const [usage, setUsage] = useState({
    screensUsed: 3,
    screensLimit: 10,
    usersUsed: 1,
    usersLimit: 1,
    storageUsed: 2.4,
    storageLimit: 10,
  });

  useEffect(() => {
    // In production: fetch from API
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const plan = PLANS.find((p) => p.id === currentPlan) ?? PLANS[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <CreditCard className="w-6 h-6" />
          Billing & Usage
        </h2>
        <p className="text-sm text-text-secondary">
          Current plan, usage statistics, and upgrade options
        </p>
      </div>

      {/* Current Plan */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Current plan</h3>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-2xl font-serif text-text-primary">{plan.name}</span>
          <Button variant="secondary" size="sm">Upgrade</Button>
          <Button variant="secondary" size="sm">Downgrade</Button>
        </div>
      </div>

      {/* Usage statistics */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Usage this month
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <FileText className="w-4 h-4" />
              <span className="text-sm">Screens</span>
            </div>
            <p className="text-xl font-serif text-text-primary">
              {usage.screensUsed} / {usage.screensLimit === -1 ? '∞' : usage.screensLimit}
            </p>
            <div className="mt-1 h-2 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full"
                style={{ width: `${usage.screensLimit === -1 ? 0 : Math.min(100, (usage.screensUsed / usage.screensLimit) * 100)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <Users className="w-4 h-4" />
              <span className="text-sm">Users</span>
            </div>
            <p className="text-xl font-serif text-text-primary">
              {usage.usersUsed} / {usage.usersLimit === -1 ? '∞' : usage.usersLimit}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-text-secondary mb-1">
              <HardDrive className="w-4 h-4" />
              <span className="text-sm">Storage</span>
            </div>
            <p className="text-xl font-serif text-text-primary">
              {usage.storageUsed} GB / {usage.storageLimit} GB
            </p>
            <div className="mt-1 h-2 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full"
                style={{ width: `${(usage.storageUsed / usage.storageLimit) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Usage analytics placeholder */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Usage analytics
        </h3>
        <p className="text-sm text-text-secondary mb-4">
          Historical usage (last 6 months), most used features, screen types distribution.
        </p>
        <div className="h-32 flex items-center justify-center border border-border rounded-lg bg-background/50 text-text-tertiary text-sm">
          Chart placeholder (integrate with analytics API)
        </div>
        <Button variant="secondary" className="mt-4">
          <Download className="w-4 h-4 mr-2" />
          Export usage report
        </Button>
      </div>
    </div>
  );
}
