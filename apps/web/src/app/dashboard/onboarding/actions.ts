"use server";

/**
 * Workspace setup, in four steps a researcher can walk in either direction.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP
 *
 * 1 - Going back never loses anything. Every step's Back control submits the
 *     same form its Continue control does, so whatever is on screen is written
 *     before the page moves. Back is lenient where Continue is strict: a
 *     half-typed ORCID stops Continue, because the next step would inherit it,
 *     and does not stop Back, because refusing to let someone leave a field they
 *     are still thinking about is the opposite of helpful. What does not parse
 *     on the way back is left as it was rather than written wrong.
 *
 * 2 - `profiles.onboarding_step` is the furthest step reached, not the step
 *     being looked at. It only ever increases. It used to be assigned the step
 *     after whichever form was submitted, so a researcher on step four who went
 *     back to correct their name was pushed to step two and had to walk the
 *     wizard again. Which step is on screen is in the URL, where it belongs.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentContext, getOrgRole, getOrgSettings } from "@/lib/data/org";
import { applySettingsPatch, MODALITIES, NORMALIZATIONS } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/time";

const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  preferred_title: z.string().trim().max(32),
  professional_role: z.string().trim().min(1).max(120),
  institution: z.string().trim().min(1).max(160),
  orcid: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/)]),
  time_zone: z.string().trim().refine(isValidTimeZone, "Choose a valid IANA time zone."),
});

// No logo_url. The logo is a file this application stores, uploaded by
// `uploadLabLogo`, which keeps the column and the stored object in step. A
// second writer here would let one change without the other.
const labSchema = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().max(160),
  time_zone: z.string().trim().refine(isValidTimeZone, "Choose a valid IANA time zone."),
});

function value(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

/** Which control was pressed. Absent means Continue, so a form without a Back
    button behaves exactly as it did before. */
function goingBack(form: FormData): boolean {
  return form.get("direction") === "back";
}

function fail(step: number, message: string): never {
  redirect(`/dashboard/onboarding?step=${step}&error=${encodeURIComponent(message)}`);
}

async function caller() {
  const context = await getCurrentContext();
  if (!context.user) fail(1, "Your session ended. Sign in again.");
  if (!context.org) fail(2, "You are not in a laboratory yet. Create one, or ask whoever invited you to add you to theirs.");
  return { user: context.user, org: context.org, reached: context.profile?.onboarding_step ?? 1 };
}

/**
 * Whether to offer the create-a-laboratory control at all.
 *
 * The answer lives in the access allowlist, which the browser must not be able
 * to read, so it comes back as one boolean from a security-definer function.
 */
export async function mayCreateLaboratory(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("may_create_workspace");
  if (error) {
    console.error(`[onboarding] may_create_workspace: ${error.message}`);
    return false;
  }
  return data === true;
}

/**
 * Make a laboratory for a researcher who has none.
 *
 * Every check that matters is in `public.create_own_workspace`: it refuses
 * anyone already in a laboratory and anyone whose access grant did not
 * authorize one. This passes the name through and reports what it said.
 */
export async function createLaboratory(form: FormData) {
  const context = await getCurrentContext();
  if (!context.user) fail(1, "Your session ended. Sign in again.");

  const name = value(form, "name");
  if (name.length < 2) fail(2, "Give the laboratory a name.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_own_workspace", { p_name: name.slice(0, 120) });
  if (error) {
    // The function raises sentences written for a researcher; the Postgres
    // prefix in front of them is not.
    fail(2, error.message.replace(/^.*?:\s*/, "") || "The laboratory could not be created.");
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/onboarding?step=2");
}

/**
 * Record the furthest step reached. Never lowers it, so revisiting step one
 * from step four leaves step four reachable.
 */
async function reach(userId: string, step: number, reached: number, complete = false) {
  const furthest = Math.min(4, Math.max(1, reached, step));
  if (furthest === reached && !complete) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      onboarding_step: furthest,
      ...(complete ? { onboarding_completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", userId);
  if (error) fail(Math.min(step, 4), "Progress could not be saved. Try again.");
}

// ---------------------------------------------------------------------------
// Step 1 - the researcher
// ---------------------------------------------------------------------------

export async function saveResearcherProfile(form: FormData) {
  const { user, reached } = await caller();
  const parsed = profileSchema.safeParse({
    full_name: value(form, "full_name"),
    preferred_title: value(form, "preferred_title"),
    professional_role: value(form, "professional_role"),
    institution: value(form, "institution"),
    orcid: value(form, "orcid"),
    time_zone: value(form, "time_zone"),
  });
  if (!parsed.success) fail(1, parsed.error.issues[0]?.message ?? "Check the profile fields.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...parsed.data,
      preferred_title: parsed.data.preferred_title || null,
      orcid: parsed.data.orcid || null,
    })
    .eq("id", user.id);
  if (error) fail(1, "Your profile could not be saved. Try again.");

  await reach(user.id, 2, reached);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/onboarding?step=2");
}

// ---------------------------------------------------------------------------
// Step 2 - the laboratory
// ---------------------------------------------------------------------------

export async function saveLaboratoryIdentity(form: FormData) {
  const { user, org, reached } = await caller();
  const back = goingBack(form);
  const role = await getOrgRole(org.id, user.id);
  const supabase = await createClient();

  if (role === "owner" || role === "admin") {
    const parsed = labSchema.safeParse({
      name: value(form, "name"),
      location: value(form, "location"),
      time_zone: value(form, "time_zone"),
    });
    if (!parsed.success) {
      // Strict forward, lenient back: see the note at the top of this file.
      if (!back) fail(2, parsed.error.issues[0]?.message ?? "Check the laboratory fields.");
    } else {
      const { error } = await supabase
        .from("organizations")
        .update({ ...parsed.data, location: parsed.data.location || null })
        .eq("id", org.id);
      if (error) fail(2, "Laboratory identity could not be saved. Try again.");
    }
  }

  if (back) {
    revalidatePath("/dashboard", "layout");
    redirect("/dashboard/onboarding?step=1");
  }

  await reach(user.id, 3, reached);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/onboarding?step=3");
}

// ---------------------------------------------------------------------------
// Step 3 - the team. Nothing to save; it is a review of who is already here.
// ---------------------------------------------------------------------------

export async function continueFromTeam(form: FormData) {
  const { user, reached } = await caller();
  if (goingBack(form)) redirect("/dashboard/onboarding?step=2");

  await reach(user.id, 4, reached);
  redirect("/dashboard/onboarding?step=4");
}

// ---------------------------------------------------------------------------
// Step 4 - the defaults, and the end
// ---------------------------------------------------------------------------

export async function completeOnboarding(form: FormData) {
  const { user, org, reached } = await caller();
  const back = goingBack(form);
  const role = await getOrgRole(org.id, user.id);
  const supabase = await createClient();

  if (role === "owner" || role === "admin") {
    const modality = z.enum(MODALITIES).safeParse(value(form, "modality"));
    const normalization = z.enum(NORMALIZATIONS).safeParse(value(form, "normalization"));
    const fdr = z.coerce.number().gt(0).lte(0.5).safeParse(value(form, "fdr_threshold"));

    if (!modality.success || !normalization.success || !fdr.success) {
      if (!back) fail(4, "Check the analysis defaults and try again.");
    } else {
      const current = await getOrgSettings(org.id);
      const settings = applySettingsPatch(current, {
        defaults: {
          modality: modality.data,
          normalization: normalization.data,
          fdr_threshold: fdr.data,
        },
      });
      const { error } = await supabase.from("organizations").update({ settings }).eq("id", org.id);
      if (error) fail(4, "Analysis defaults could not be saved. Try again.");
    }
  }

  if (back) {
    revalidatePath("/dashboard", "layout");
    redirect("/dashboard/onboarding?step=3");
  }

  await reach(user.id, 4, reached, true);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
