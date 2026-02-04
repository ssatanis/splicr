"use client";

import { useState } from "react";
import { Key, Copy, Check, Plus, Trash2 } from "lucide-react";

export default function APIKeyManager() {
  const [keys, setKeys] = useState<{ id: string; prefix: string; name?: string; created: string }[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    const prefix = "sk_live_";
    const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = `${prefix}${randomPart}`;
    setGeneratedKey(key);
    setKeys((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        prefix: `${prefix}…${randomPart.slice(-4)}`,
        name: newKeyName || "API Key",
        created: new Date().toISOString(),
      },
    ]);
    setNewKeyName("");
  };

  const copyToClipboard = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
      <h3 className="text-xl font-serif text-text-primary mb-2">API keys</h3>
      <p className="text-sm text-text-tertiary mb-6">
        Use API keys to call SplicR from scripts or the Python SDK. Send as <code className="font-mono text-xs bg-background px-1 rounded">Authorization: Bearer &lt;key&gt;</code>.
      </p>

      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (optional)"
            className="flex-1 px-4 py-2 rounded-xl border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-accent text-white hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            Generate
          </button>
        </div>

        {generatedKey && (
          <div className="p-4 rounded-xl bg-background border border-border">
            <p className="text-xs text-text-tertiary mb-2">Copy your key now — it won’t be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm text-text-primary break-all">{generatedKey}</code>
              <button
                type="button"
                onClick={copyToClipboard}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border hover:bg-background/80 text-text-secondary"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {keys.length > 0 && (
          <ul className="space-y-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between p-3 rounded-xl border border-border bg-background"
              >
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-text-tertiary" />
                  <span className="font-mono text-sm">{k.prefix}</span>
                  {k.name && <span className="text-text-tertiary text-sm">— {k.name}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setKeys((prev) => prev.filter((x) => x.id !== k.id))}
                  className="p-2 rounded-lg text-text-tertiary hover:text-error hover:bg-error/10"
                  aria-label="Revoke"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-text-tertiary">
          Rate limits: Standard 100/min, Pro 500/min, Enterprise 2000/min. Configure in environment.
        </p>
      </div>
    </div>
  );
}
