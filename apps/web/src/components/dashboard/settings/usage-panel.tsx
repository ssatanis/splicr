"use client";

import { ArrowUpRight, Users } from "lucide-react";
import Link from "next/link";

import { PLAN_LABEL, ROLE_LABEL, type OrgRole, type PlanTier } from "@/lib/data/types";
import { cn, formatNumber, initials } from "@/lib/utils";

import { ROLE_CHIP } from "../members/shared";

/**
 * One person's row, with every date already turned into a sentence.
 *
 * Formatting a timestamp reads the clock, which a render may not do, so the
 * server does it once and hands down finished strings. Same rule as the lab
 * members page next door.
 */
export interface UsageRow {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  screens: number;
  runs: number;
  runs30d: number;
  outcomes: number;
  apiKeys: number;
  /** "Mar 4, 2026", or null for somebody who has not started anything yet. */
  lastActiveLabel: string | null;
  joinedLabel: string;
  isSelf: boolean;
}

export interface UsagePanelProps {
  orgName: string | null;
  plan: PlanTier;
  rows: UsageRow[];
  totals: {
    screens: number;
    runs: number;
    runs30d: number;
    outcomes: number;
    apiKeys: number;
    members: number;
    pendingInvites: number;
  } | null;
  unattributed: { screens: number; runs: number; outcomes: number; apiKeys: number } | null;
  /** True when the caller may invite and change roles. */
  canManage: boolean;
  /** Set when the read failed or there is no workspace. Nothing is shown then. */
  notice: string | null;
}

/**
 * What the lab has used, and which of its people used it.
 *
 * ONE PLAN, AND WHY THE PAGE SAYS SO
 *
 * `plan` is a column on the organization. There is no plan on a profile and no
 * per-person meter anywhere, and an invited researcher never gets a workspace
 * of their own, so their screens and runs are written against this lab and
 * there is no second plan they could land on. The line at the top of this
 * panel states that, and it is a description of the schema rather than a
 * promise about billing: SplicR does not meter or charge anything yet, and
 * this panel does not pretend otherwise by inventing an allowance to count
 * down from. It reports what has been done. The numbers are the numbers.
 */
export function UsagePanel({
  orgName,
  plan,
  rows,
  totals,
  unattributed,
  canManage,
  notice,
}: UsagePanelProps) {
  if (notice !== null || totals === null) {
    return (
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-[15px] font-medium text-ink">People and usage</h2>
        <p className="mt-2 text-sm text-body">{notice ?? "Usage could not be read."}</p>
      </section>
    );
  }

  const lab = orgName ?? "this lab";
  const spare = unattributed ?? { screens: 0, runs: 0, outcomes: 0, apiKeys: 0 };
  const spareTotal = spare.screens + spare.runs + spare.outcomes + spare.apiKeys;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-medium text-ink">People and usage</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-body">
              Everything here is carried by {lab} on the {PLAN_LABEL[plan]} plan. People invited to
              a lab do not get a workspace or a plan of their own, so every screen, run and outcome
              they record belongs to this one.
            </p>
          </div>
          <Link href="/dashboard/settings/members" className="btn btn-ghost btn-sm shrink-0">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {canManage ? "Invite and set roles" : "Lab members"}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="People" value={totals.members} note={inviteNote(totals.pendingInvites)} />
          <Tile label="Screens" value={totals.screens} />
          <Tile
            label="Runs"
            value={totals.runs}
            note={`${formatNumber(totals.runs30d)} in the last 30 days`}
          />
          <Tile label="Outcomes" value={totals.outcomes} />
          <Tile label="Live API keys" value={totals.apiKeys} />
        </dl>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Person
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Role
                </th>
                <Numeric head>Screens</Numeric>
                <Numeric head>Runs</Numeric>
                <Numeric head>30 days</Numeric>
                <Numeric head>Outcomes</Numeric>
                <Numeric head>Keys</Numeric>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Last active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.userId} className="align-middle">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-tint text-[10.5px] font-medium text-navy">
                        {initials(row.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-ink">
                          {row.name}
                          {row.isSelf && <span className="ml-1.5 text-[11px] text-muted">you</span>}
                        </div>
                        <div className="truncate text-[11px] text-muted">{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("chip text-[11px]", ROLE_CHIP[row.role])}>
                      {ROLE_LABEL[row.role]}
                    </span>
                  </td>
                  <Numeric>{row.screens}</Numeric>
                  <Numeric>{row.runs}</Numeric>
                  <Numeric>{row.runs30d}</Numeric>
                  <Numeric>{row.outcomes}</Numeric>
                  <Numeric>{row.apiKeys}</Numeric>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12.5px] text-muted">
                    {/* Not "never". Somebody who joined this morning has not
                        done nothing, they have not done anything yet. */}
                    {row.lastActiveLabel ?? `Joined ${row.joinedLabel}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {spareTotal > 0 && (
          <p className="border-t border-line bg-mist-soft/40 px-4 py-2.5 text-xs text-muted">
            {describeUnattributed(spare)} not attributed to anybody currently in {lab}, because the
            person who did it has left or the record predates attribution. It is counted in the lab
            totals above and in no row below them.
          </p>
        )}
      </div>
    </section>
  );
}

function inviteNote(pending: number): string | undefined {
  if (pending === 0) return undefined;
  return pending === 1 ? "1 invite outstanding" : `${formatNumber(pending)} invites outstanding`;
}

/** "2 screens and 1 run", for the unattributed footnote. */
function describeUnattributed(spare: {
  screens: number;
  runs: number;
  outcomes: number;
  apiKeys: number;
}): string {
  const parts = [
    [spare.screens, "screen", "screens"],
    [spare.runs, "run", "runs"],
    [spare.outcomes, "outcome", "outcomes"],
    [spare.apiKeys, "API key", "API keys"],
  ] as const;
  const said = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${formatNumber(n)} ${n === 1 ? one : many}`);
  if (said.length === 1) return `${said[0]} is`;
  return `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]} are`;
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-mist-soft/40 px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[19px] font-medium tabular-nums leading-tight text-ink">
        {formatNumber(value)}
      </dd>
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

/** A right-aligned, tabular numeric cell, or its column heading. */
function Numeric({ head = false, children }: { head?: boolean; children: React.ReactNode }) {
  if (head) {
    return (
      <th scope="col" className="px-3 py-2.5 text-right font-medium">
        {children}
      </th>
    );
  }
  return (
    <td className="px-3 py-2.5 text-right tabular-nums text-[13px] text-ink">
      {typeof children === "number" ? formatNumber(children) : children}
    </td>
  );
}
