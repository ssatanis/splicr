"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/dashboard/ui";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { ElapsedTime } from "./elapsed-time";
import { cancelScreenAnalysis } from "@/lib/data/analysis-actions";
import type { WorkspaceStage } from "@/lib/data/screen-detail";

export function LiveProgress({ 
  runId,
  screenId,
  screenName,
  initialStatus,
  initialQc,
  initialStages,
  createdAt, startedAt, finishedAt, canCancel = false,
}: { 
  runId: string;
  screenId: string;
  screenName: string;
  initialStatus: string;
  initialQc: string;
  initialStages: WorkspaceStage[];
  createdAt: string; startedAt?: string | null; finishedAt?: string | null; canCancel?: boolean;
}) {
  const [stages, setStages] = useState(initialStages);
  const [status, setStatus] = useState(initialStatus);
  const [syncError, setSyncError] = useState(false);
  const [cancelPending, setCancelPending] = useState(initialStatus === "canceled");
  const [timing, setTiming] = useState({ created_at: createdAt, started_at: startedAt, finished_at: finishedAt });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => { if (confirmCancel) dialog.current?.showModal(); }, [confirmCancel]);
  const cancel = async () => {
    setCanceling(true); setCancelError(null);
    try {
      const result = await cancelScreenAnalysis(screenId, runId);
      if (!result.ok) { setCancelError(result.error); return; }
      setConfirmCancel(false); router.refresh();
    } catch { setCancelError("Unable to cancel. Try again."); }
    finally { setCanceling(false); }
  };
  const [supabase] = useState(createClient);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    let observedStatus = initialStatus;
    let observedQc = initialQc;
    const updateStatus = (next: string) => {
      setStatus(next);
      if (next !== observedStatus) {
        observedStatus = next;
        router.refresh();
      }
    };
    // Read the run even when stages have not changed or realtime disconnects.
    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        const [stageResult, runResult, screenResult, jobResult] = await Promise.all([
          supabase.from("run_stages").select("stage,status,detail,tool").eq("run_id", runId).order("position"),
          supabase.from("runs").select("status,created_at,started_at,finished_at").eq("id", runId).maybeSingle(),
          supabase.from("screens").select("qc,current_run_id").eq("id", screenId).maybeSingle(),
          supabase.from("jobs").select("status,modal_cancelled_at").eq("run_id", runId).eq("kind", "pipeline").maybeSingle(),
        ]);
        if (disposed) return;
        setSyncError(Boolean(stageResult.error || runResult.error || screenResult.error || !runResult.data || !screenResult.data));
        if (!jobResult.error) setCancelPending(jobResult.data?.status === "canceled" && !jobResult.data.modal_cancelled_at);
        if (stageResult.data) setStages(stageResult.data);
        if (runResult.data) { setTiming(runResult.data); updateStatus(runResult.data.status); }
        if (screenResult.data && (screenResult.data.qc !== observedQc || screenResult.data.current_run_id !== runId)) {
          observedQc = screenResult.data.qc;
          router.refresh();
        }
      } catch {
        if (!disposed) setSyncError(true);
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    const resume = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);

    // 2. Realtime Database Changes
    const channel = supabase.channel(`run:${runId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "run_stages", filter: `run_id=eq.${runId}` }, () => { void poll(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${runId}` }, (payload) => {
        if (!disposed && typeof payload.new.status === "string") updateStatus(payload.new.status);
        void poll();
      })
      .subscribe();

    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      void supabase.removeChannel(channel);
    };
  }, [runId, screenId, supabase, router, initialStatus, initialQc]);

  const completedCount = stages.filter(s => s.status === "done" || s.status === "skipped").length;
  const progressPercent = stages.length ? (completedCount / stages.length) * 100 : 0;
  const activeStage = status === "running" ? stages.find(s => s.status === "running") : undefined;
  const label = status === "canceled" ? cancelPending ? "Stopping analysis" : "Analysis canceled" : syncError ? "Reconnecting" : status === "queued" ? "Queued" : status === "running" ? "Analyzing" : status === "complete" ? "Complete" : "Analysis stopped";

  return (
    <>
    <Card className="mb-6 overflow-hidden p-0 border-line shadow-sm">
      <div className="p-5 md:p-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-medium text-ink flex items-center gap-2">
              {(status === "queued" || status === "running") && <Loader2 className="w-4 h-4 animate-spin text-cyan-600" />}
              {label}: <span className="font-normal text-muted">{screenName}</span>
            </h2>
            <p className="text-[13px] text-muted mt-1">
              {completedCount} of {stages.length} stages complete
              <span className="mx-2" aria-hidden="true">,</span>
              <ElapsedTime createdAt={timing.created_at} startedAt={timing.started_at} finishedAt={timing.finished_at} status={status} />
            </p>
            <p className="text-[12px] text-muted mt-1" role="status" aria-live="polite">
              {status === "canceled" ? cancelPending ? "Stopping the Modal worker…" : "Analysis stopped. Uploaded inputs are retained." : syncError ? "Live updates are unavailable. Reconnecting automatically…" : status === "queued" ? "Waiting for an analysis worker. Starts automatically." : status === "running" ? "Analysis worker active." : "Refreshing recorded results…"}
            </p>
          </div>
          <div className="flex items-center gap-4">
          {activeStage && (
            <div className="text-right">
              <div className="text-[13px] font-medium text-ink capitalize">{activeStage.stage === "qc" ? "QC" : activeStage.stage}</div>
              <div className="text-[12px] text-muted truncate max-w-[200px]">{activeStage.detail || "Processing…"}</div>
            </div>
          )}
          {canCancel && (status === "queued" || status === "running") && <button type="button" onClick={() => setConfirmCancel(true)} className="rounded-md border border-line px-3 py-2 text-[12px] font-medium text-ink hover:bg-mist-soft">Cancel analysis</button>}
          </div>
        </div>
        
        <div role="progressbar" aria-label="Analysis stages completed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)} className="h-1.5 w-full bg-line rounded-full overflow-hidden">
          <div 
            className="h-full bg-cyan-600 transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="bg-mist-soft border-t border-line px-5 md:px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4 overflow-x-auto scrollbar-hide pb-2 md:pb-0">
          {stages.map((stage, idx) => {
            const isDone = stage.status === "done" || stage.status === "skipped";
            const isRunning = stage.status === "running";
            const isFailed = stage.status === "failed";
            
            return (
              <div key={stage.stage} className={cn(
                "flex items-start md:items-center gap-2 shrink-0 relative",
                idx !== stages.length - 1 ? "md:pr-8 md:after:absolute md:after:right-3 md:after:top-1/2 md:after:-translate-y-1/2 md:after:w-4 md:after:h-[1px] md:after:bg-line" : ""
              )}>
                <div className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full border text-[10px] shrink-0",
                  isDone ? "bg-cyan-600 border-cyan-600 text-white" :
                  isRunning ? "border-cyan-600 text-cyan-600 bg-cyan-50 shadow-[0_0_0_2px_rgba(8,145,178,0.2)]" :
                  isFailed ? "bg-red-600 border-red-600 text-white" :
                  "border-line text-muted bg-white"
                )}>
                  {isDone ? <Check className="w-3 h-3" /> :
                   isFailed ? <AlertCircle className="w-3 h-3" /> :
                   (idx + 1)}
                </div>
                <div className="flex flex-col">
                  <span className={cn(
                    "text-[12px] font-medium capitalize",
                    (isDone || isRunning) ? "text-ink" : "text-muted"
                  )}>
                    {stage.stage === "qc" ? "QC" : stage.stage}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
    {confirmCancel && <dialog ref={dialog} aria-labelledby="cancel-analysis-title" onCancel={event => { event.preventDefault(); if (!canceling) setConfirmCancel(false); }} className="m-auto w-[min(448px,calc(100vw-32px))] rounded-xl border border-line bg-white p-6 shadow-xl backdrop:bg-black/30">
      <h2 id="cancel-analysis-title" className="text-lg font-semibold">Cancel analysis?</h2>
      <p className="mt-2 text-sm text-body">Stop {screenName} and its Modal worker? Uploaded inputs will be retained.</p>
      {cancelError && <p role="alert" className="mt-3 text-sm text-red-600">{cancelError}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" disabled={canceling} onClick={() => setConfirmCancel(false)} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">Keep running</button>
        <button type="button" disabled={canceling} onClick={() => void cancel()} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50">{canceling ? "Stopping…" : "Stop analysis"}</button>
      </div>
    </dialog>}
    </>
  );
}
