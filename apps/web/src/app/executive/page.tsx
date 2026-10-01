import { BarChart3, Building2, Clock3, FlaskConical, Landmark, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { InvitationStudio } from "@/components/executive/invitation-studio";
import { endExecutiveSession } from "@/app/executive/actions";
import { getExecutiveIdentity } from "@/lib/executive/access";
import { getExecutiveOverview } from "@/lib/executive/data";

export const metadata = { title: "Executive console" };
export const dynamic = "force-dynamic";

export default async function ExecutivePage() {
  const identity = await getExecutiveIdentity();
  if (!identity) redirect("/executive/access");
  const overview = await getExecutiveOverview();

  return (
    <main className="min-h-dvh bg-peach p-2 sm:p-4">
      <div className="mx-auto min-h-[calc(100dvh-1rem)] max-w-[1500px] overflow-hidden rounded-[2rem] bg-[#f8fafb] shadow-float">
        <header className="flex flex-wrap items-center justify-between gap-4 bg-teal-800 px-5 py-4 text-white sm:px-8">
          <div className="flex items-center gap-5"><Logo tone="light" size="sm" /><span className="hidden h-6 w-px bg-white/25 sm:block" /><span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">Executive console</span></div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-sm font-medium">{identity.name}</p><p className="text-[11px] text-white/65">Fresh OTP session · 15 minutes</p></div>
            <form action={endExecutiveSession}><button className="inline-flex items-center gap-2 rounded-full border border-white/25 px-3 py-2 text-xs hover:bg-white/10"><LogOut className="h-3.5 w-3.5" /> End session</button></form>
          </div>
        </header>

        <div className="px-4 py-7 sm:px-8 lg:px-10 lg:py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="eyebrow">SplicR operations</p><h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.03em] text-teal-900 sm:text-5xl">Welcome, {identity.shortName}.</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">A live view of the laboratories and researchers entrusted to SplicR, with controlled invitation delivery and prefilled onboarding.</p></div>
            <Link href="/dashboard" className="btn btn-ghost">Open researcher portal</Link>
          </div>

          <section className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={<Building2 />} label="Laboratories" value={overview.labCount} />
            <Metric icon={<Users />} label="Researchers" value={overview.researcherCount} />
            <Metric icon={<Landmark />} label="Institutions" value={overview.institutionCount} />
            <Metric icon={<Clock3 />} label="Pending invitations" value={overview.pendingCount} />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.75fr)]">
            <InvitationStudio labs={overview.labs} />
            <section className="rounded-3xl border border-line bg-white p-5 shadow-soft sm:p-7">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-800"><BarChart3 className="h-4.5 w-4.5" /></span><div><h2 className="text-xl font-medium tracking-[-0.02em] text-ink">Recent access</h2><p className="text-sm text-muted">Newest authorization records</p></div></div>
              <div className="mt-5 divide-y divide-line">
                {overview.recentInvites.length === 0 ? <p className="py-6 text-sm text-muted">No invitation has been prepared yet.</p> : overview.recentInvites.map((invite) => (
                  <div key={invite.id} className="py-3.5">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{invite.fullName ?? invite.email}</p><p className="truncate text-xs text-muted">{invite.email}</p></div><span className="rounded-full bg-mist-soft px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-teal-800">{invite.status}</span></div>
                    <p className="mt-2 text-xs text-body">{invite.labName}{invite.institution ? ` · ${invite.institution}` : ""}</p>
                    <p className="mt-1 text-[11px] text-muted">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(invite.createdAt))}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-3xl border border-line bg-white p-5 sm:p-7">
            <div className="flex items-center gap-3"><FlaskConical className="h-5 w-5 text-orange-700" /><div><h2 className="text-base font-medium text-ink">Laboratory footprint</h2><p className="text-xs text-muted">Configured SplicR workspaces</p></div></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{overview.labs.slice(0, 12).map((lab) => <div key={lab.id} className="rounded-xl border border-line px-3.5 py-3"><p className="text-sm font-medium text-ink">{lab.name}</p><p className="mt-0.5 text-xs text-muted">{lab.location || "Location not configured"}</p></div>)}</div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="rounded-2xl border border-line bg-white p-4 shadow-soft"><div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-[0.1em] text-muted">{label}</span><span className="text-teal-700 [&>svg]:h-4 [&>svg]:w-4">{icon}</span></div><p className="mt-4 font-serif text-4xl text-teal-900">{value.toLocaleString()}</p></div>;
}
