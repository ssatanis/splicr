'use client';

export function AnalysesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading analyses">
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="h-32 bg-surface/30 rounded-lg animate-pulse border border-border"
          style={{
            animationDelay: `${i * 100}ms`,
            animationDuration: '1.5s',
          }}
        >
          <div className="p-6 space-y-3">
            {/* Title skeleton */}
            <div className="h-5 bg-border rounded w-1/3" />
            
            {/* Description skeleton */}
            <div className="h-4 bg-border rounded w-2/3" />
            
            {/* Metadata skeleton */}
            <div className="flex gap-4 pt-2">
              <div className="h-3 bg-border rounded w-20" />
              <div className="h-3 bg-border rounded w-24" />
              <div className="h-3 bg-border rounded w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AnalysisDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading analysis details">
      {/* Header */}
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface/30 rounded w-1/3" />
        <div className="h-5 bg-border rounded w-1/2" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-24 bg-surface/30 rounded-lg animate-pulse border border-border"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-surface/30 rounded w-1/4" />
        <div className="h-96 bg-surface/30 rounded-lg border border-border" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading table">
      {/* Header */}
      <div className="flex gap-4 p-4 bg-surface/30 rounded-t-lg border-b border-border">
        <div className="h-4 bg-border rounded w-1/6 animate-pulse" />
        <div className="h-4 bg-border rounded w-1/4 animate-pulse" />
        <div className="h-4 bg-border rounded w-1/6 animate-pulse" />
        <div className="h-4 bg-border rounded w-1/6 animate-pulse" />
      </div>

      {/* Rows */}
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex gap-4 p-4 bg-surface/20 border-b border-border/50"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="h-3 bg-border rounded w-1/6 animate-pulse" />
          <div className="h-3 bg-border rounded w-1/4 animate-pulse" />
          <div className="h-3 bg-border rounded w-1/6 animate-pulse" />
          <div className="h-3 bg-border rounded w-1/6 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6" role="status" aria-label="Loading dashboard">
      {/* Welcome section */}
      <div className="animate-pulse space-y-3">
        <div className="h-10 bg-surface/30 rounded w-1/3" />
        <div className="h-5 bg-border rounded w-1/2" />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-32 bg-surface/30 rounded-lg animate-pulse border border-border"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="p-6 space-y-3">
              <div className="h-4 bg-border rounded w-1/2" />
              <div className="h-8 bg-border rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>

      {/* Recent Analyses */}
      <div className="space-y-4">
        <div className="h-6 bg-surface/30 rounded w-1/4 animate-pulse" />
        <AnalysesSkeleton count={3} />
      </div>
    </div>
  );
}
