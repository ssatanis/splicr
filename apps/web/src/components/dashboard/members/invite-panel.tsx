"use client";

/**
 * Invite somebody to the lab, and look after the codes that are still open.
 *
 * `inviteMember` writes the authorization and invite rows, then the trusted
 * server sends either an invitation code or an existing-account sign-in code.
 */

import { Loader2, RefreshCw, UserPlus, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Card, Flag, StatusBadge } from "@/components/dashboard/ui";
import { inviteMember, retryInvite, revokeInvite } from "@/lib/data/actions";
import { ROLE_LABEL, type OrgRole } from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { ActionNote, RoleMenu } from "./controls";
import { ROLE_CHIP, expiryLabel, type InviteView } from "./shared";

interface CreatedInvite {
  email: string;
  expiresLabel: string;
  deliveryState: string;
}

interface PanelNote {
  tone: "ok" | "err";
  text: string;
}

export function InvitePanel({
  invites,
  callerRole,
}: {
  invites: InviteView[];
  /** The viewer's role, which is the highest role they may hand out. */
  callerRole: OrgRole;
}) {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [formNote, setFormNote] = useState<PanelNote | null>(null);
  const [listNote, setListNote] = useState<PanelNote | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const busy = isPending;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const address = email.trim();
    if (!address) {
      setFormNote({ tone: "err", text: "Enter the email address to invite." });
      return;
    }

    setFormNote(null);
    setCreated(null);
    startTransition(async () => {
      const result = await inviteMember(address, role);
      if (!result.ok) {
        setFormNote({ tone: "err", text: result.error });
        return;
      }
      setCreated({
        email: address,
        expiresLabel: expiryLabel(result.expiresAt),
        deliveryState: result.deliveryState,
      });
      setEmail("");
    });
  }

  function retry(invite: InviteView) {
    if (busy) return;
    setListNote(null);
    setActingId(invite.id);
    startTransition(async () => {
      const result = await retryInvite(invite.id);
      setActingId(null);
      setListNote(
        result.ok
          ? { tone: "ok", text: `The invitation for ${invite.email} was sent again.` }
          : { tone: "err", text: result.error },
      );
    });
  }

  function revoke(invite: InviteView) {
    if (busy) return;
    setListNote(null);
    setActingId(invite.id);
    startTransition(async () => {
      const result = await revokeInvite(invite.id);
      setActingId(null);
      setListNote(
        result.ok
          ? { tone: "ok", text: `The invite for ${invite.email} is withdrawn.` }
          : { tone: "err", text: result.error },
      );
    });
  }

  return (
    <Card
      title="Invite somebody"
      subtitle="They keep their own login and see the same screens, hits and outcomes."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label-sm" htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            className="underline-input"
            placeholder="colleague@university.edu"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <span className="label-sm">Role</span>
          <div className="mt-2">
            <RoleMenu
              value={role}
              maxRole={callerRole}
              disabled={busy}
              label="Role for the person you are inviting"
              align="left"
              onSelect={setRole}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-orange btn-sm" disabled={busy}>
            {busy && actingId === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Create invite
          </button>
          <span className="text-xs text-muted">The invitation code is good for 14 days.</span>
        </div>

        {formNote && <ActionNote tone={formNote.tone}>{formNote.text}</ActionNote>}
      </form>

      {created && (
        <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm text-ink">
              {created.deliveryState === "failed"
                ? `Access for ${created.email} is authorized, but delivery failed. Retry from the pending invitation below.`
                : `The invitation for ${created.email} was sent. ${created.expiresLabel}.`}
            </p>
            <button
              type="button"
              aria-label="Dismiss the invitation status"
              className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-white hover:text-ink"
              onClick={() => setCreated(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-medium text-ink">Pending invites</h4>
          <span className="text-xs text-muted">{invites.length}</span>
        </div>

        {listNote && (
          <div className="mt-2">
            <ActionNote tone={listNote.tone}>{listNote.text}</ActionNote>
          </div>
        )}

        {invites.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nobody is waiting. Anyone you invite stays here until they join or the code expires.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {invites.map((invite) => (
              <li key={invite.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">{invite.email}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px]",
                          ROLE_CHIP[invite.role],
                        )}
                      >
                        {ROLE_LABEL[invite.role]}
                      </span>
                      {invite.expired ? (
                        <Flag label="Expired" />
                      ) : invite.deliveryState === "failed" ? (
                        <Flag label="Delivery failed" />
                      ) : (
                        <StatusBadge status="pending" />
                      )}
                      <span className="text-[11px] text-muted">{invite.expiresLabel}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {invite.deliveryState === "failed" && !invite.expired && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => retry(invite)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 py-1.5 text-xs text-ink hover:border-navy"
                      >
                        <RefreshCw className="h-3 w-3" /> Retry
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => revoke(invite)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 py-1.5 text-xs whitespace-nowrap text-ink transition-colors",
                        busy
                          ? "cursor-not-allowed opacity-55"
                          : "hover:border-red-200 hover:bg-red-50 hover:text-red-700",
                      )}
                    >
                      {actingId === invite.id && busy && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Revoke
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
