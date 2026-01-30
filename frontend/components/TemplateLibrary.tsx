"use client";

import { useState, useEffect } from "react";
import { FileText, ChevronRight } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  parameters?: Record<string, unknown>;
}

export default function TemplateLibrary() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/templates");
        if (!res.ok) throw new Error("Failed to load templates");
        const data = await res.json();
        if (!cancelled) setTemplates(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleApplyTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/templates/${id}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.parameters) {
        alert(`Template "${data.templateName}" parameters:\n${JSON.stringify(data.parameters, null, 2)}\n\nUse these when creating an analysis via the API or UI.`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-4">Analysis templates</h3>
        <p className="text-text-tertiary text-sm">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
        <h3 className="text-xl font-serif text-text-primary mb-4">Analysis templates</h3>
        <p className="text-error text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
      <h3 className="text-xl font-serif text-text-primary mb-2">Analysis templates</h3>
      <p className="text-sm text-text-tertiary mb-6">
        Pre-built workflow presets. Use a template to get suggested parameters for new analyses.
      </p>
      <ul className="space-y-2">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between p-4 rounded-xl border border-border bg-background hover:bg-background/80 transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-text-tertiary shrink-0" />
              <div>
                <div className="font-medium text-text-primary">{t.name}</div>
                {t.description && (
                  <div className="text-sm text-text-tertiary">{t.description}</div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleApplyTemplate(t.id)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border hover:bg-accent/10 hover:border-accent text-text-secondary hover:text-accent transition-colors"
            >
              Use <ChevronRight className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
      {templates.length === 0 && (
        <p className="text-text-tertiary text-sm">No templates available.</p>
      )}
    </div>
  );
}
