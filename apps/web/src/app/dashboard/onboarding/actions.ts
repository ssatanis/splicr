"use server";

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

const labSchema = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().max(160),
  time_zone: z.string().trim().refine(isValidTimeZone, "Choose a valid IANA time zone."),
  logo_url: z.union([z.literal(""), z.url().max(2048)]),
});

function value(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function fail(step: number, message: string): never {
  redirect(`/dashboard/onboarding?step=${step}&error=${encodeURIComponent(message)}`);
}

async function caller() {
  const context = await getCurrentContext();
  if (!context.user) fail(1, "Your session ended. Sign in again.");
  if (!context.org) fail(1, "Your invitation is not attached to a laboratory workspace.");
  return { user: context.user, org: context.org };
}

async function setProgress(userId: string, step: number, complete = false) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      onboarding_step: step,
      ...(complete ? { onboarding_completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", userId);
  if (error) fail(Math.min(step, 4), "Progress could not be saved. Try again.");
}

export async function saveResearcherProfile(form: FormData) {
  const { user } = await caller();
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
      onboarding_step: 2,
    })
    .eq("id", user.id);
  if (error) fail(1, "Your profile could not be saved. Try again.");
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/onboarding?step=2");
}

export async function saveLaboratoryIdentity(form: FormData) {
  const { user, org } = await caller();
  const role = await getOrgRole(org.id, user.id);
  const supabase = await createClient();

  if (role === "owner" || role === "admin") {
    const parsed = labSchema.safeParse({
      name: value(form, "name"),
      location: value(form, "location"),
      time_zone: value(form, "time_zone"),
      logo_url: value(form, "logo_url"),
    });
    if (!parsed.success) fail(2, parsed.error.issues[0]?.message ?? "Check the laboratory fields.");
    const { error } = await supabase
      .from("organizations")
      .update({
        ...parsed.data,
        location: parsed.data.location || null,
        logo_url: parsed.data.logo_url || null,
      })
      .eq("id", org.id);
    if (error) fail(2, "Laboratory identity could not be saved. Try again.");
  }

  await setProgress(user.id, 3);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/onboarding?step=3");
}

export async function continueFromTeam() {
  const { user } = await caller();
  await setProgress(user.id, 4);
  redirect("/dashboard/onboarding?step=4");
}

export async function completeOnboarding(form: FormData) {
  const { user, org } = await caller();
  const role = await getOrgRole(org.id, user.id);
  const supabase = await createClient();

  if (role === "owner" || role === "admin") {
    const modality = z.enum(MODALITIES).safeParse(value(form, "modality"));
    const normalization = z.enum(NORMALIZATIONS).safeParse(value(form, "normalization"));
    const fdr = z.coerce.number().gt(0).lte(0.5).safeParse(value(form, "fdr_threshold"));
    if (!modality.success || !normalization.success || !fdr.success) {
      fail(4, "Check the analysis defaults and try again.");
    }
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

  await setProgress(user.id, 4, true);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
