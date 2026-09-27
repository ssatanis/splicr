import { Check, CircleDashed, Clock, Loader2, XCircle } from "lucide-react";
import Link from "next/link";

import type { ScreenStatus, StageStatus, Verdict } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

export function Card({ className, children, title, action, subtitle }: {
  className?: string;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("bg-white rounded-3xl border border-line p-5 md:p-6", className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            {title && <h3 className="text-ink text-lg font-medium">{title}</h3>}
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: React.ReactNode; hint?: string; tone?: "ink" | "orange" | "cyan" }) {
  return (
    <div className="bg-white rounded-3xl border border-line p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={cn("mt-2 text-3xl font-medium tracking-tight", tone === "orange" ? "text-orange-500" : tone === "cyan" ? "text-cyan-600" : "text-ink")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, body, actions }: { eyebrow?: string; title: React.ReactNode; body?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
      <div>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-3xl md:text-4xl text-ink font-medium tracking-tight">{title}</h1>
        {body && <p className="mt-2 text-body max-w-2xl">{body}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export const verdictColor: Record<Verdict, string> = {
  "Real and new": "#f87315",
  "Real and known": "#07b6d3",
  "Real but generic": "#3f95a6",
  Artifact: "#174f62",
  Uncertain: "#b8c2ca",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-mist-soft px-2.5 py-1 text-xs text-ink whitespace-nowrap">
      <span className="w-2 h-2 rounded-full" style={{ background: verdictColor[verdict] }} />
      {verdict}
    </span>
  );
}

export function StatusBadge({ status }: { status: ScreenStatus | "pass" | "warn" | "fail" | "pending" }) {
  const map: Record<string, string> = {
    complete: "bg-cyan-50 text-cyan-700",
    running: "bg-orange-50 text-orange-700",
    queued: "bg-mist-soft text-muted",
    failed: "bg-red-50 text-red-700",
    draft: "bg-mist-soft text-muted",
    pass: "bg-cyan-50 text-cyan-700",
    warn: "bg-orange-50 text-orange-700",
    fail: "bg-red-50 text-red-700",
    pending: "bg-mist-soft text-muted",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs capitalize", map[status])}>
      {status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
      {status}
    </span>
  );
}

export function Chance({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.6 ? "#f87315" : value >= 0.4 ? "#07b6d3" : "#174f62";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("progress-track", size === "sm" ? "w-12 h-1.5" : "w-16")}>
        <span className="progress-fill block" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className={cn("tabular-nums text-ink", size === "sm" ? "text-xs" : "text-sm font-medium")}>{pct}%</span>
    </span>
  );
}

const stageIcon: Record<StageStatus, React.ReactNode> = {
  done: <Check className="w-3.5 h-3.5" />,
  running: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  queued: <Clock className="w-3.5 h-3.5" />,
  failed: <XCircle className="w-3.5 h-3.5" />,
  skipped: <CircleDashed className="w-3.5 h-3.5" />,
};

export function StageRail({ stages, compact = false }: { stages: { key: string; title: string; status: StageStatus }[]; compact?: boolean }) {
  return (
    <ol className={cn("flex items-center", compact ? "gap-1" : "gap-2 overflow-x-auto thin-scroll pb-1")}>
      {stages.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
              s.status === "done" && "bg-teal-800 text-white",
              s.status === "running" && "bg-orange-500 text-teal-950",
              s.status === "queued" && "bg-white border border-line text-muted",
              s.status === "failed" && "bg-red-600 text-white",
              s.status === "skipped" && "bg-mist-soft text-muted",
            )}
            title={s.title}
          >
            {stageIcon[s.status]}
            {!compact && s.title}
          </span>
          {i < stages.length - 1 && <span className={cn("h-px bg-line-strong", compact ? "w-2" : "w-4")} />}
        </li>
      ))}
    </ol>
  );
}

export function Tabs({ tabs, active, hrefFor }: { tabs: { key: string; label: string; count?: number }[]; active: string; hrefFor: (k: string) => string }) {
  return (
    <div className="flex gap-1 overflow-x-auto thin-scroll border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={hrefFor(t.key)}
          scroll={false}
          className={cn(
            "px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
            active === t.key ? "border-orange-500 text-ink font-medium" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ml-2 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-line-strong p-10 text-center">
      <div className="text-ink font-medium">{title}</div>
      {body && <p className="text-sm text-muted mt-1 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Flag({ label }: { label: string }) {
  return <span className="inline-flex rounded-md bg-orange-50 text-orange-700 px-2 py-0.5 text-[11px] whitespace-nowrap">{label}</span>;
}
