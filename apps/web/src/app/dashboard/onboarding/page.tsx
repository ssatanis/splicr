/**
 * Workspace setup.
 *
 * The four steps are walkable in both directions. `profiles.onboarding_step`
 * records the furthest step a researcher has reached; the step on screen comes
 * from the URL and is clamped to that, so the chips above the card are honest:
 * a step you have been to is a link, a step you have not is not.
 *
 * Every step's Back control submits that step's own form, so nothing typed is
 * thrown away by moving. See `./actions` for the strict-forward,
 * lenient-backward rule that makes that safe.
 */
import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LabLogoField } from "@/components/dashboard/settings/logo-field";
import { getCurrentContext, getOrgRole, getOrgSettings, listMembers } from "@/lib/data/org";
import { MODALITIES, NORMALIZATIONS, NORMALIZATION_LABEL, ROLE_LABEL } from "@/lib/data/types";
import { MODALITY_LABEL } from "@/components/dashboard/settings/meta";
import { FALLBACK_TIME_ZONE, isValidTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

import { OnboardingInvite } from "@/components/dashboard/members/onboarding-invite";

import {
  completeOnboarding,
  continueFromTeam,
  createLaboratory,
  mayCreateLaboratory,
  saveLaboratoryIdentity,
  saveResearcherProfile,
} from "./actions";

export const metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

const STEPS = ["Your profile", "Laboratory", "Team", "Analysis defaults"];

function field(
  label: string,
  name: string,
  value: string,
  extra: React.InputHTMLAttributes<HTMLInputElement> = {},
) {
  return (
    <label className="block text-[12.5px] font-medium text-ink">
      {label}
      <input
        name={name}
        defaultValue={value}
        className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-navy"
        {...extra}
      />
    </label>
  );
}

/**
 * Back, as a submit button rather than a link.
 *
 * A link would leave the page without writing what is on screen, which is the
 * thing people most reliably expect a wizard not to do. `formNoValidate` is
 * deliberate: required fields guard Continue, and must not trap someone who
 * only wants to look at the previous step.
 */
function BackButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      name="direction"
      value="back"
      formNoValidate
      className="btn btn-ghost inline-flex items-center gap-1"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

export default async function OnboardingPage(props: PageProps<"/dashboard/onboarding">) {
  const [context, query] = await Promise.all([getCurrentContext(), props.searchParams]);
  if (!context.user) redirect("/login?next=/dashboard/onboarding");
  if (context.profile?.onboarding_completed_at) redirect("/dashboard");

  // The furthest step reached, and the step being looked at. Clamping the
  // second to the first is what stops a typed-in `?step=4` skipping the setup.
  const reached = Math.min(4, Math.max(1, context.profile?.onboarding_step ?? 1));
  const requested = Number(typeof query.step === "string" ? query.step : reached);
  const step = Math.min(reached, Math.max(1, Number.isFinite(requested) ? requested : 1));
  const error = typeof query.error === "string" ? query.error : null;

  const role = context.org ? await getOrgRole(context.org.id, context.user.id) : null;
  const canManage = role === "owner" || role === "admin";
  const [members, settings, mayCreateLab] = await Promise.all([
    context.org ? listMembers(context.org.id) : Promise.resolve([]),
    context.org ? getOrgSettings(context.org.id) : Promise.resolve(null),
    context.org ? Promise.resolve(false) : mayCreateLaboratory(),
  ]);
  const browserZone = isValidTimeZone(context.profile?.time_zone)
    ? context.profile.time_zone
    : (context.org?.time_zone ?? FALLBACK_TIME_ZONE);

  return (
    <div className="mx-auto w-full max-w-4xl py-4 lg:py-8">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">Workspace setup</p>
        <h1 className="mt-2 text-[30px] font-medium tracking-[-0.025em] text-ink">Make SplicR yours</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Four short checks establish who signs reports, which laboratory owns the data, and the
          defaults new analyses inherit. Nothing is final: every answer stays editable in Settings.
        </p>
      </div>

      <ol className="mb-8 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Onboarding progress">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const current = number === step;
          const visited = number < reached;
          const open = number <= reached && !current;

          const inner = (
            <>
              <span
                className={cn(
                  "mb-1 flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]",
                )}
              >
                {visited ? <Check className="h-3 w-3" aria-hidden="true" /> : number}
              </span>
              {label}
            </>
          );

          return (
            <li key={label} className="contents">
              {open ? (
                <Link
                  href={`/dashboard/onboarding?step=${number}`}
                  className="rounded-xl border border-line bg-white px-3 py-3 text-xs text-muted outline-none transition-colors hover:border-line-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-navy motion-reduce:transition-none"
                >
                  {inner}
                </Link>
              ) : (
                <span
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-xs",
                    current ? "border-navy bg-navy text-white" : "border-line bg-white text-muted opacity-60",
                  )}
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {error && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white p-5 md:p-7">
        {step === 1 && (
          <form action={saveResearcherProfile} className="space-y-5">
            <div>
              <h2 className="text-xl font-medium text-ink">Your researcher profile</h2>
              <p className="mt-1 text-sm text-muted">Used on team lists, reports, and the workspace greeting.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("Full name", "full_name", context.profile?.full_name ?? "", { required: true, autoComplete: "name" })}
              {field("Preferred title", "preferred_title", context.profile?.preferred_title ?? "", { placeholder: "Dr." })}
              {field("Professional role", "professional_role", context.profile?.professional_role ?? "", { required: true, placeholder: "Research Scientist" })}
              {field("Institution", "institution", context.profile?.institution ?? "", { required: true })}
              {field("ORCID", "orcid", context.profile?.orcid ?? "", { placeholder: "0000-0002-1825-0097" })}
              {field("Time zone", "time_zone", browserZone, { required: true, placeholder: "America/New_York" })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-navy">Save and continue</button>
            </div>
          </form>
        )}

        {step === 2 && (
          context.org ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-medium text-ink">Welcome to {context.org.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {canManage
                    ? "This is the identity on every screen, member list and signed report. Change anything that is not right."
                    : "You are a member of this laboratory. Its shared identity is looked after by an owner or admin; your own profile stays yours."}
                </p>
              </div>

              {/* The logo saves itself the moment a file is chosen, so it is its own
                  block rather than a field in the form below. Nothing here is
                  required: Continue leaves it unset, and Settings has the same
                  control for the day the lab gets round to it. */}
              {canManage && (
                <>
                  <LabLogoField orgName={context.org.name} logoUrl={context.org.logo_url} canEdit />
                  <p className="-mt-3 text-xs text-muted">
                    Optional. You can add or change it later in Settings, under Lab.
                  </p>
                </>
              )}

              <form action={saveLaboratoryIdentity} className="space-y-5">
                {canManage && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("Lab display name", "name", context.org.name, { required: true })}
                    {field("Location", "location", context.org.location ?? "", { placeholder: "City, region" })}
                    {field("Lab time zone", "time_zone", context.org.time_zone ?? browserZone, { required: true })}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn btn-navy">Continue</button>
                  <BackButton label="Back to your profile" />
                </div>
              </form>
            </div>
          ) : mayCreateLab ? (
            <form action={createLaboratory} className="space-y-5">
              <div>
                <h2 className="text-xl font-medium text-ink">Set up your laboratory</h2>
                <p className="mt-1 text-sm text-muted">
                  You are not in a laboratory yet. Name yours and SplicR creates it with you as its
                  owner. You can invite the rest of your group in the next step.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {field("Lab name", "name", "", { required: true, placeholder: "Satani Lab", autoFocus: true })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn btn-navy">Create the laboratory</button>
                <BackButton label="Back to your profile" />
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-medium text-ink">No laboratory yet</h2>
                <p className="mt-1 text-sm text-muted">
                  Your access is not attached to a laboratory, and this account is not authorized to
                  create one. Ask whoever invited you to add you to theirs; your profile is saved and
                  setup will carry on from here.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/dashboard/onboarding?step=1" className="btn btn-ghost">
                  Back to your profile
                </Link>
              </div>
            </div>
          )
        )}

        {step === 3 && (
          <form action={continueFromTeam} className="space-y-5">
            <div>
              <h2 className="text-xl font-medium text-ink">Your team</h2>
              <p className="mt-1 text-sm text-muted">
                {members.length} {members.length === 1 ? "researcher has" : "researchers have"} access to{" "}
                {context.org?.name ?? "this workspace"}.
              </p>
            </div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {members.slice(0, 5).map((member) => (
                <div key={member.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    {member.name}
                    <span className="ml-2 text-muted">{member.email}</span>
                  </span>
                  <span className="text-muted">{ROLE_LABEL[member.role]}</span>
                </div>
              ))}
            </div>
            {canManage && role && <OnboardingInvite callerRole={role} />}
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-navy">Continue</button>
              <BackButton label="Back to the laboratory" />
              <Link href="/dashboard/settings/members" className="btn btn-ghost">
                {canManage ? "Manage the team" : "See the team"}
              </Link>
            </div>
          </form>
        )}

        {step === 4 && (
          <form action={completeOnboarding} className="space-y-5">
            <div>
              <h2 className="text-xl font-medium text-ink">Analysis defaults</h2>
              <p className="mt-1 text-sm text-muted">
                Applied to new screens. Every value remains editable in Settings.
              </p>
            </div>
            {canManage && settings ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-[12.5px] font-medium text-ink">
                  Modality
                  <select
                    name="modality"
                    defaultValue={settings.defaults.modality}
                    className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm"
                  >
                    {MODALITIES.map((item) => (
                      <option key={item} value={item}>{MODALITY_LABEL[item]}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[12.5px] font-medium text-ink">
                  Normalization
                  <select
                    name="normalization"
                    defaultValue={settings.defaults.normalization}
                    className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm"
                  >
                    {NORMALIZATIONS.map((item) => (
                      <option key={item} value={item}>{NORMALIZATION_LABEL[item]}</option>
                    ))}
                  </select>
                </label>
                {field("FDR threshold", "fdr_threshold", String(settings.defaults.fdr_threshold), {
                  type: "number", min: 0.001, max: 0.5, step: 0.001, required: true,
                })}
              </div>
            ) : (
              <p className="rounded-xl bg-mist-soft p-4 text-sm text-body">
                Your lab&rsquo;s defaults are managed by an owner or admin. You can review them in Settings.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-navy">Finish setup</button>
              <BackButton label="Back to your team" />
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
