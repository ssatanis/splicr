'use client';

import { useState, useEffect } from 'react';
import { Key, Copy, Check, Plus, Trash2, AlertTriangle, ShieldAlert, Zap, Loader2 } from 'lucide-react';
import Button from '@/components/Button';
import { listApiKeys, createApiKey, revokeApiKey, ApiKey } from '@/lib/api';

export default function APIKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKeys();
  }, []);

  async function fetchKeys() {
    try {
      const data = await listApiKeys();
      setKeys(data);
    } catch (err) {
      console.error('Error fetching API keys:', err);
      // Don't show error to user immediately on load if it's just empty or auth issue handled elsewhere
    } finally {
      setLoading(false);
    }
  }

  async function generateKey() {
    if (!newKeyName.trim()) {
      setError('Please provide a name for your key');
      return;
    }
    setCreating(true);
    setError(null);

    try {
      // Create key via backend API
      const newKey = await createApiKey(newKeyName);

      // Update UI
      if (newKey.key) {
        setGeneratedKey(newKey.key);
      }
      setKeys(prev => [newKey, ...prev]);
      setNewKeyName('');
    } catch (err: any) {
      console.error('Error creating API key:', err);
      setError(err.message || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Are you sure you want to revoke this API key? Any scripts using it will immediately stop working.')) return;

    try {
      await revokeApiKey(id);
      setKeys(prev => prev.filter(k => k.id !== id));
    } catch (err) {
      console.error('Error revoking key:', err);
      setError('Failed to revoke API key');
    }
  }

  const copyToClipboard = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div>
        <h3 className="text-xl font-serif text-text-primary mb-2">API Access</h3>
        <p className="text-sm text-text-secondary">
          Programmatically access SplicR analysis pipelines, retrieve results, and manage data via the REST API.
        </p>
      </div>

      {/* Rate Limits & Info Card */}
      <div className="bg-surface border border-border rounded-xl p-5 flex items-start gap-4">
        <div className="p-2 bg-accent/10 rounded-lg text-accent mt-0.5">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-medium text-text-primary mb-1">Rate limits & fair use</h4>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            API calls are rate-limited per key tier. Standard keys are limited to <strong>100 requests/minute</strong>.
            Exceeding limits returns <code className="text-xs bg-background px-1 py-0.5 rounded border border-border">HTTP 429</code>.
          </p>
          <p className="text-xs text-text-tertiary">
            Keys are tied to your user account. Do not share credentials or commit them to public repositories.
            If a key is compromised, revoke it immediately below.
          </p>
        </div>
      </div>

      {/* Key Generation */}
      <div className="bg-surface rounded-xl p-6 border border-border shadow-sm">
        <h3 className="text-lg font-serif text-text-primary mb-4">Create new secret key</h3>

        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name — e.g. 'Lab pipeline', 'Jupyter notebook'"
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              onKeyDown={(e) => e.key === 'Enter' && generateKey()}
            />
          </div>
          <Button
            onClick={generateKey}
            disabled={creating || !newKeyName.trim()}
            className="whitespace-nowrap"
          >
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            {creating ? 'Generating...' : 'Create secret key'}
          </Button>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-500 text-sm bg-red-500/5 p-3 rounded-lg border border-red-500/10">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Newly Generated Key Display */}
        {generatedKey && (
          <div className="mt-6 p-5 rounded-xl bg-background border border-border ring-1 ring-accent/20 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-3 text-success">
              <ShieldAlert className="w-4 h-4" />
              <span className="text-sm font-medium">Secret key generated</span>
            </div>
            <p className="text-xs text-text-tertiary mb-3">
              This is the <strong>only time</strong> this key will be displayed in full. Copy it now and store it securely. SplicR does not retain the unhashed key.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-surface border border-border rounded-lg p-3 font-mono text-sm text-text-primary break-all select-all">
                {generatedKey}
              </div>
              <Button
                variant="secondary"
                onClick={copyToClipboard}
                className="h-full py-3"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                <span className="ml-2">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              Use in header: <code className="bg-surface px-1.5 py-0.5 rounded border border-border">Authorization: Bearer {generatedKey}</code>
            </p>
          </div>
        )}
      </div>

      {/* Active Keys List */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border bg-surface-hover/30">
          <h3 className="text-sm font-medium text-text-primary">Active Keys</h3>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-sm">
            No active API keys found. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="p-4 flex items-center justify-between hover:bg-background/50 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary text-sm">{k.name}</span>
                    <span className="text-xs font-mono text-text-tertiary bg-surface border border-border px-1.5 py-0.5 rounded">
                      {k.prefix}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span>Created {new Date(k.created_at).toLocaleDateString()}</span>
                    {k.last_used_at && (
                      <>
                        <span>•</span>
                        <span>Last used {new Date(k.last_used_at).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeKey(k.id)}
                  className="text-text-tertiary hover:text-red-500 hover:bg-red-500/10"
                  title="Revoke key"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
