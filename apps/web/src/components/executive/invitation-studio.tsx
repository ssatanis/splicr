"use client";

import { Building2, CheckCircle2, Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";

import { sendExecutiveInvitation } from "@/app/executive/actions";
import type { ExecutiveLab } from "@/lib/executive/data";

const field =
  "mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-white px-3.5 text-sm text-ink outline-none transition-colors focus:border-teal-700";

export function InvitationStudio({ labs }: { labs: ExecutiveLab[] }) {
  const [pending, startTransition] = useTransition();
  const [workspaceId, setWorkspaceId] = useState("new");
  const [labName, setLabName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setNote(null);
    startTransition(async () => {
      const result = await sendExecutiveInvitation({
        fullName: String(form.get("fullName") ?? ""),
        email: String(form.get("email") ?? ""),
        labName: String(form.get("labName") ?? ""),
        institution: String(form.get("institution") ?? ""),
        preferredTitle: String(form.get("preferredTitle") ?? ""),
        professionalRole: String(form.get("professionalRole") ?? ""),
        labLocation: String(form.get("labLocation") ?? ""),
        timeZone: String(form.get("timeZone") ?? ""),
        workspaceId,
        memberRole: String(form.get("memberRole") ?? "member") as "admin" | "member" | "viewer",
      });
      setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        (event.currentTarget as HTMLFormElement).reset();
        setWorkspaceId("new");
        setLabName("");
      }
    });
  }

  return (
    <section className="rounded-3xl border border-line bg-white p-5 shadow-soft sm:p-7">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
          <Send className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-medium tracking-[-0.02em] text-ink">Prepare an invitation</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Required identity and laboratory details arrive prefilled. The researcher can correct every value during onboarding.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label title="Name" required><input name="fullName" required maxLength={120} placeholder="Researcher name" className={field} /></Label>
          <Label title="Email" required><input name="email" required type="email" placeholder="you@institution.edu" className={field} /></Label>
          <Label title="Lab name" required><input name="labName" required maxLength={120} value={labName} onChange={(event) => setLabName(event.target.value)} placeholder="Example Lab" className={field} /></Label>
          <Label title="Institution" required><input name="institution" required maxLength={160} placeholder="University or institute" className={field} /></Label>
        </div>

        <div className="rounded-2xl border border-line bg-mist-soft p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><Building2 className="h-4 w-4" /> Workspace placement</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Label title="Laboratory workspace">
              <select
                value={workspaceId}
                onChange={(event) => {
                  const id = event.target.value;
                  setWorkspaceId(id);
                  const lab = labs.find((item) => item.id === id);
                  if (lab) setLabName(lab.name);
                }}
                className={field}
              >
                <option value="new">Create a new lab workspace</option>
                {labs.map((lab) => <option key={lab.id} value={lab.id}>Add to {lab.name}</option>)}
              </select>
            </Label>
            {workspaceId !== "new" && <Label title="Workspace role">
              <select name="memberRole" defaultValue="member" className={field}>
                <option value="member">Researcher</option>
                <option value="admin">Lab administrator</option>
                <option value="viewer">Viewer</option>
              </select>
            </Label>}
          </div>
        </div>

        <details className="group rounded-2xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">Optional personalization</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Label title="Preferred title"><input name="preferredTitle" maxLength={32} placeholder="Dr., Prof." className={field} /></Label>
            <Label title="Role"><input name="professionalRole" maxLength={120} placeholder="Principal Investigator" className={field} /></Label>
            <Label title="Lab location"><input name="labLocation" maxLength={160} placeholder="City, region" className={field} /></Label>
            <Label title="Time zone"><input name="timeZone" placeholder="America/New_York" className={field} /></Label>
          </div>
        </details>

        {note && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${note.ok ? "border-teal-100 bg-teal-50 text-teal-900" : "border-red-200 bg-red-50 text-red-800"}`}>
            {note.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}{note.text}
          </div>
        )}

        <button type="submit" disabled={pending} className="btn btn-orange w-full sm:w-auto">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send personalized invitation code
        </button>
      </form>
    </section>
  );
}

function Label({ title, required = false, children }: { title: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block text-[12.5px] font-medium text-ink">{title}{required && <span className="ml-1 text-orange-700">Required</span>}{children}</label>;
}
