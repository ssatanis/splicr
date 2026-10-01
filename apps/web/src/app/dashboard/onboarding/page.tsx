import { Check } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentContext, getOrgRole, getOrgSettings, listMembers } from "@/lib/data/org";
import { MODALITIES, NORMALIZATIONS } from "@/lib/data/types";
import { FALLBACK_TIME_ZONE, isValidTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

import {
  completeOnboarding,
  continueFromTeam,
  saveLaboratoryIdentity,
  saveResearcherProfile,
} from "./actions";

export const metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

const STEPS = ["Your profile", "Laboratory", "Team", "Analysis defaults"];

function field(label: string, name: string, value: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) {
  return (
    <label className="block text-[12.5px] font-medium text-ink">
      {label}
      <input name={name} defaultValue={value} className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-navy" {...extra} />
    </label>
  );
}

export default async function OnboardingPage(props: PageProps<"/dashboard/onboarding">) {
  const [context, query] = await Promise.all([getCurrentContext(), props.searchParams]);
  if (!context.user) redirect("/login?next=/dashboard/onboarding");
  if (context.profile?.onboarding_completed_at) redirect("/dashboard");

  const requested = Number(typeof query.step === "string" ? query.step : context.profile?.onboarding_step ?? 1);
  const step = Math.min(4, Math.max(1, Number.isFinite(requested) ? requested : 1));
  const error = typeof query.error === "string" ? query.error : null;
  const role = context.org ? await getOrgRole(context.org.id, context.user.id) : null;
  const canManage = role === "owner" || role === "admin";
  const [members, settings] = await Promise.all([
    context.org ? listMembers(context.org.id) : Promise.resolve([]),
    context.org ? getOrgSettings(context.org.id) : Promise.resolve(null),
  ]);
  const browserZone = isValidTimeZone(context.profile?.time_zone)
    ? context.profile.time_zone
    : context.org?.time_zone ?? FALLBACK_TIME_ZONE;

  return (
    <div className="mx-auto w-full max-w-4xl py-4 lg:py-8">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">Workspace setup</p>
        <h1 className="mt-2 text-[30px] font-medium tracking-[-0.025em] text-ink">Make SplicR yours</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Four short checks establish who signs reports, which laboratory owns the data, and the defaults new analyses inherit.</p>
      </div>

      <ol className="mb-8 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Onboarding progress">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < step;
          return <li key={label} className={cn("rounded-xl border px-3 py-3 text-xs", number === step ? "border-navy bg-navy text-white" : "border-line bg-white text-muted")}>
            <span className="mb-1 flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]">{done ? <Check className="h-3 w-3" /> : number}</span>
            {label}
          </li>;
        })}
      </ol>

      {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="rounded-2xl border border-line bg-white p-5 md:p-7">
        {step === 1 && <form action={saveResearcherProfile} className="space-y-5">
          <div><h2 className="text-xl font-medium text-ink">Your researcher profile</h2><p className="mt-1 text-sm text-muted">Used on team lists, reports, and the workspace greeting.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("Full name", "full_name", context.profile?.full_name ?? "", { required: true, autoComplete: "name" })}
            {field("Preferred title", "preferred_title", context.profile?.preferred_title ?? "", { placeholder: "Dr." })}
            {field("Professional role", "professional_role", context.profile?.professional_role ?? "", { required: true, placeholder: "Research Scientist" })}
            {field("Institution", "institution", context.profile?.institution ?? "", { required: true })}
            {field("ORCID", "orcid", context.profile?.orcid ?? "", { placeholder: "0000-0002-1825-0097" })}
            {field("Time zone", "time_zone", browserZone, { required: true, placeholder: "America/New_York" })}
          </div>
          <button className="btn btn-navy">Save and continue</button>
        </form>}

        {step === 2 && <form action={saveLaboratoryIdentity} className="space-y-5">
          <div><h2 className="text-xl font-medium text-ink">Laboratory identity</h2><p className="mt-1 text-sm text-muted">Shared across every member, screen, and signed report.</p></div>
          {!context.org ? <p className="text-sm text-red-700">This invitation is not attached to a laboratory. Ask the sender to issue it again.</p> : canManage ? <div className="grid gap-4 sm:grid-cols-2">
            {field("Lab display name", "name", context.org.name, { required: true })}
            {field("Location", "location", context.org.location ?? "", { placeholder: "City, region" })}
            {field("Lab time zone", "time_zone", context.org.time_zone ?? browserZone, { required: true })}
            {field("Logo URL", "logo_url", context.org.logo_url ?? "", { type: "url", placeholder: "https://lab.example/logo.svg" })}
          </div> : <p className="rounded-xl bg-mist-soft p-4 text-sm text-body">{context.org.name} is already configured. An owner or admin controls its shared identity; your personal profile remains yours.</p>}
          <button className="btn btn-navy" disabled={!context.org}>Continue</button>
        </form>}

        {step === 3 && <form action={continueFromTeam} className="space-y-5">
          <div><h2 className="text-xl font-medium text-ink">Your team</h2><p className="mt-1 text-sm text-muted">{members.length} {members.length === 1 ? "researcher has" : "researchers have"} access to {context.org?.name ?? "this workspace"}.</p></div>
          <div className="divide-y divide-line rounded-xl border border-line">{members.slice(0, 5).map(member => <div key={member.id} className="flex items-center justify-between px-4 py-3 text-sm"><span>{member.name}<span className="ml-2 text-muted">{member.email}</span></span><span className="capitalize text-muted">{member.role}</span></div>)}</div>
          <div className="flex flex-wrap gap-3"><button className="btn btn-navy">Continue</button>{canManage && <Link href="/dashboard/settings/members" className="btn btn-ghost">Invite researchers</Link>}</div>
        </form>}

        {step === 4 && <form action={completeOnboarding} className="space-y-5">
          <div><h2 className="text-xl font-medium text-ink">Analysis defaults</h2><p className="mt-1 text-sm text-muted">Applied to new screens. Every value remains editable in Settings.</p></div>
          {canManage && settings ? <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-[12.5px] font-medium text-ink">Modality<select name="modality" defaultValue={settings.defaults.modality} className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm">{MODALITIES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="text-[12.5px] font-medium text-ink">Normalization<select name="normalization" defaultValue={settings.defaults.normalization} className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm">{NORMALIZATIONS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
            {field("FDR threshold", "fdr_threshold", String(settings.defaults.fdr_threshold), { type: "number", min: 0.001, max: 0.5, step: 0.001, required: true })}
          </div> : <p className="rounded-xl bg-mist-soft p-4 text-sm text-body">Your lab’s defaults are managed by an owner or admin. You can review them in Settings.</p>}
          <button className="btn btn-navy">Finish setup</button>
        </form>}
      </section>
    </div>
  );
}
