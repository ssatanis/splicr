"use client";

import { ArrowRight, Filter } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { screens, type ScreenStatus } from "@/lib/mock/data";
import { formatDate } from "@/lib/utils";

import { StatusBadge } from "./ui";

const statuses: ("all" | ScreenStatus)[] = ["all", "complete", "running", "queued", "failed"];

export function ScreensTable() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");

  const rows = useMemo(
    () =>
      screens.filter(
        (s) =>
          (status === "all" || s.status === status) &&
          (q === "" || `${s.name} ${s.cellLine} ${s.library} ${s.phenotype}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [q, status],
  );

  return (
    <div className="bg-white rounded-3xl border border-line">
      <div className="p-4 md:p-5 flex flex-col md:flex-row gap-3 md:items-center justify-between border-b border-line">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name, cell line, library…"
          className="rounded-full border border-line px-4 py-2 text-sm w-full md:w-80 outline-none focus:border-cyan-500"
        />
        <div className="flex items-center gap-2 text-sm">
          <Filter className="w-4 h-4 text-muted" />
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`chip text-xs capitalize ${status === s ? "bg-teal-800 text-white" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto thin-scroll">
        <table className="table-base min-w-[900px]">
          <thead>
            <tr>
              <th>Screen</th>
              <th>Model</th>
              <th>Library</th>
              <th>Phenotype</th>
              <th>Status</th>
              <th>QC</th>
              <th>Progress</th>
              <th>Hits</th>
              <th>Owner</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-mist-soft/60">
                <td>
                  <Link href={`/dashboard/screens/${s.id}`} className="font-medium hover:text-orange-500">
                    {s.name}
                  </Link>
                  <div className="text-xs text-muted">{s.id}</div>
                </td>
                <td>
                  {s.cellLine}
                  <div className="text-xs text-muted">
                    {s.organism} · {s.modality}
                  </div>
                </td>
                <td>{s.library}</td>
                <td className="text-sm">{s.phenotype}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>
                  <StatusBadge status={s.qc} />
                </td>
                <td>
                  <div className="progress-track w-24">
                    <div className="progress-fill bg-cyan-500" style={{ width: `${(s.stage / 9) * 100}%` }} />
                  </div>
                  <div className="text-xs text-muted mt-1">{s.stage}/9 stages</div>
                </td>
                <td>{s.status === "complete" ? `${s.realHits} real / ${s.hits}` : "-"}</td>
                <td className="text-sm">{s.owner}</td>
                <td className="text-sm text-muted">{formatDate(s.createdAt)}</td>
                <td>
                  <Link href={`/dashboard/screens/${s.id}`} className="icon-btn w-9 h-9" aria-label="Open screen">
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-muted py-10">
                  No screens match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
