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
  /** Present only when the message did not go out. */
  deliveryError: string | null;
}

interface PanelNote {
  tone: "ok" | "err";
  text: string;
}

/**
 * What actually happened, in one sentence.
 *
 * The three outcomes are genuinely different and a lab administrator acts on
 * each one differently, so none of them is folded into "invite sent": a brand
 * new researcher gets an invitation code and has an account to finish, an
 * address that already had a SplicR account is a member from this moment and
 * only needs to sign in, and a failure needs a retry.
 */
function createdHeadline(created: CreatedInvite): string {
  if (created.deliveryState === "failed") {
    return `${created.email} is authorized for this workspace, but the code could not be emailed. Retry from the pending invitation below.`;
  }
  if (created.deliveryState === "existing_user") {
    return `${created.email} already had a SplicR account and is now a member. A sign-in code is on its way.`;
  }
  return `An invitation code was emailed to ${created.email}. ${created.expiresLabel}.`;
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
        deliveryError: result.deliveryError,
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
          {/* Two different clocks, and conflating them is what makes an
              invitation look broken: the emailed code is single use and expires
              within the hour, while the invitation itself stands for 14 days
              and can be sent again from the list below. */}
          <span className="text-xs text-muted">
            They get a one-time code by email. The invitation stands for 14 days.
          </span>
        </div>

        {formNote && <ActionNote tone={formNote.tone}>{formNote.text}</ActionNote>}
      </form>

      {created && (
        <div
          className={cn(
            "mt-4 rounded-2xl border p-3",
            created.deliveryState === "failed"
              ? "border-red-100 bg-red-50"
              : "border-cyan-100 bg-cyan-50",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-ink">{createdHeadline(created)}</p>
              {created.deliveryError && (
                <p className="text-xs leading-snug text-red-700">{created.deliveryError}</p>
              )}
            </div>
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
                    {/*
                      The reason, not just the fact. "Delivery failed" on its
                      own leaves an administrator with nothing to do but guess;
                      the sentence the sender gave back says whether to retry,
                      to correct the address, or to tell somebody the mail
                      credentials are wrong.
                    */}
                    {invite.deliveryState === "failed" && invite.deliveryError && (
                      <p className="mt-1.5 text-[11px] leading-snug text-red-700">
                        {invite.deliveryError}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {/*
                      Offered on every open invitation, not only on a failed
                      one. The code inside the message is single use and short
                      lived while the invitation itself stands for fourteen
                      days, so "it expired" and "I deleted it" are the ordinary
                      reasons to press this, and both used to need the invite
                      revoked and reissued.
                    */}
                    {!invite.expired && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => retry(invite)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 py-1.5 text-xs whitespace-nowrap text-ink transition-colors hover:border-navy disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {actingId === invite.id && busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {invite.deliveryState === "failed" ? "Retry" : "Send again"}
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
