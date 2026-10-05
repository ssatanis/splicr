import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/dashboard/ui";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export function LiveProgress({ 
  runId, 
  screenName,
  initialStages 
}: { 
  runId: string;
  screenName: string;
  initialStages: any[];
}) {
  const [stages, setStages] = useState(initialStages);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // 1. Polling fallback
    const interval = setInterval(async () => {
      const { data } = await supabase.from("run_stages").select("*").eq("run_id", runId).order("position");
      if (data) {
        setStages(data);
        const hasActive = data.some((s: any) => ["queued", "running"].includes(s.status));
        if (!hasActive) router.refresh();
      }
    }, 5000);

    // 2. Realtime Database Changes
    const channel = supabase.channel(`run:${runId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "run_stages", filter: `run_id=eq.${runId}` }, (payload: any) => {
        setStages(current => {
          const next = [...current];
          const idx = next.findIndex(s => s.stage === payload.new.stage);
          if (idx >= 0) {
            next[idx] = { ...next[idx], ...payload.new };
          }
          return next;
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${runId}` }, (payload: any) => {
        if (payload.new.status === "complete" || payload.new.status === "failed") {
          router.refresh();
        }
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [runId, supabase, router]);

  const completedCount = stages.filter(s => s.status === "done" || s.status === "skipped").length;
  const progressPercent = Math.min(100, Math.max(5, (completedCount / 9) * 100));
  const activeStage = stages.find(s => s.status === "running") || stages.find(s => s.status === "queued");

  return (
    <Card className="mb-6 overflow-hidden p-0 border-line shadow-sm">
      <div className="p-5 md:p-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium text-ink flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-600" />
              Analyzing &middot; <span className="font-normal text-muted">{screenName}</span>
            </h2>
            <p className="text-[13px] text-muted mt-1">
              {completedCount} of 9 stages complete
            </p>
          </div>
          {activeStage && (
            <div className="text-right">
              <div className="text-[13px] font-medium text-ink capitalize">{activeStage.stage}</div>
              <div className="text-[12px] text-muted truncate max-w-[200px]">{activeStage.detail || "Running..."}</div>
            </div>
          )}
        </div>
        
        <div className="h-1.5 w-full bg-line rounded-full overflow-hidden">
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
            const isQueued = stage.status === "queued";
            
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
                    {stage.stage}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
