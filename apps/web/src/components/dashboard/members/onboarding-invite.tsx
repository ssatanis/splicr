"use client";

/**
 * Inviting the rest of the lab without leaving setup.
 *
 * The full team page has roles, pending codes, retries and revocation. None of
 * that belongs in a four-step wizard, and sending somebody to it mid-setup lost
 * their place. This is the one thing worth doing here — get the people in — and
 * it uses the same `inviteMember` action the team page does, so the invitation
 * is the same invitation, with the same authorization and the same email.
 *
 * It names the three outcomes separately, because a lab administrator acts on
 * each one differently: a new researcher has an account to finish, an address
 * that already had one is a member from this moment, and a failed send needs a
 * retry from the team page.
 */
import { Check, Loader2, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";

import { inviteMember } from "@/lib/data/actions";
import { ROLE_LABEL, ROLE_RANK, type OrgRole } from "@/lib/data/types";

const INVITABLE: readonly OrgRole[] = ["admin", "member", "viewer"];

export function OnboardingInvite({ callerRole }: { callerRole: OrgRole }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Nobody hands out a role above their own; the server enforces it too.
  const roles = INVITABLE.filter((option) => ROLE_RANK[option] <= ROLE_RANK[callerRole]);

  const send = () => {
    const address = email.trim();
    if (!address) return;
    start(async () => {
      const result = await inviteMember(address, role);
      if (!result.ok) {
        setNote({ tone: "err", text: result.error });
        return;
      }
      setEmail("");
      setNote({
        tone: "ok",
        text:
          result.deliveryState === "failed"
            ? `${address} is authorized, but the code could not be emailed. Retry it from Settings, under Team.`
            : result.deliveryState === "existing_user"
              ? `${address} already had a SplicR account and is a member now. A sign-in code is on its way.`
              : `An invitation code is on its way to ${address}.`,
      });
    });
  };

  return (
    <div className="rounded-xl border border-line bg-mist-soft/50 p-4">
      <p className="text-[12.5px] font-medium text-ink">Invite the rest of the lab</p>
      <p className="mt-0.5 text-xs text-muted">
        They get a code by email and join this laboratory. You can do this later in Settings too.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
          placeholder="researcher@university.edu"
          autoComplete="off"
          aria-label="Email address to invite"
          className="h-9 min-w-[16rem] flex-1 rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-navy"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as OrgRole)}
          aria-label="Role for the invitation"
          className="h-9 rounded-lg border border-line-strong bg-white px-2 text-sm outline-none focus:border-navy"
        >
          {roles.map((option) => (
            <option key={option} value={option}>{ROLE_LABEL[option]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={send}
          disabled={pending || email.trim() === ""}
          className="btn btn-navy inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          )}
          Send invitation
        </button>
      </div>

      {note && (
        <p
          role="status"
          className={`mt-2 flex items-start gap-1.5 text-xs leading-snug ${
            note.tone === "ok" ? "text-teal-700" : "text-red-700"
          }`}
        >
          {note.tone === "ok" && <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
          {note.text}
        </p>
      )}
    </div>
  );
}
