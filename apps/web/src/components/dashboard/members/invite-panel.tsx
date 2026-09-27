"use client";

/**
 * Invite somebody to the lab, and look after the links that are still open.
 *
 * `inviteMember` writes the `org_invites` row and hands back the token exactly
 * once. Nothing in SplicR sends the email yet, so the panel says so and gives
 * the link to send by hand rather than implying an inbox somewhere.
 */

import { Check, Copy, Loader2, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Card, Flag, StatusBadge } from "@/components/dashboard/ui";
import { inviteMember, revokeInvite } from "@/lib/data/actions";
import { ROLE_LABEL, type OrgRole } from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { ActionNote, Locked, RoleMenu } from "./controls";
import { ROLE_CHIP, expiryLabel, inviteUrl, type InviteView } from "./shared";

const EXPIRED_COPY_REASON = "This link has expired. Revoke it and invite again to issue a new one.";

interface CreatedInvite {
  email: string;
  url: string;
  expiresLabel: string;
}

interface PanelNote {
  tone: "ok" | "err";
  text: string;
}

export function InvitePanel({
  invites,
  callerRole,
  demo,
}: {
  invites: InviteView[];
  /** The viewer's role, which is the highest role they may hand out. */
  callerRole: OrgRole;
  demo: boolean;
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
    if (demo || busy) return;

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
        url: inviteUrl(result.token),
        expiresLabel: expiryLabel(result.expiresAt),
      });
      setEmail("");
    });
  }

  function revoke(invite: InviteView) {
    if (demo || busy) return;
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
            disabled={demo || busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <span className="label-sm">Role</span>
          <div className="mt-2">
            <RoleMenu
              value={role}
              maxRole={callerRole}
              disabled={demo || busy}
              label="Role for the person you are inviting"
              align="left"
              onSelect={setRole}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-orange btn-sm" disabled={demo || busy}>
            {busy && actingId === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Create invite
          </button>
          <span className="text-xs text-muted">The link is good for 14 days.</span>
        </div>

        {formNote && <ActionNote tone={formNote.tone}>{formNote.text}</ActionNote>}
      </form>

      {created && (
        <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm text-ink">
              The invite for {created.email} is ready. SplicR does not send the email, so send them
              this link yourself. {created.expiresLabel}.
            </p>
            <button
              type="button"
              aria-label="Dismiss the new invite link"
              className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-white hover:text-ink"
              onClick={() => setCreated(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] text-ink">
              {created.url}
            </code>
            <CopyButton value={created.url} />
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
            Nobody is waiting. Anyone you invite stays here until they join or the link expires.
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
                      {invite.expired ? <Flag label="Expired" /> : <StatusBadge status="pending" />}
                      <span className="text-[11px] text-muted">{invite.expiresLabel}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <CopyButton
                      value={inviteUrl(invite.token)}
                      disabled={demo || invite.expired}
                      reason={invite.expired && !demo ? EXPIRED_COPY_REASON : null}
                      compact
                    />
                    <button
                      type="button"
                      disabled={demo || busy}
                      onClick={() => revoke(invite)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 py-1.5 text-xs whitespace-nowrap text-ink transition-colors",
                        demo || busy
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

/**
 * Copies a value, and falls back to showing it when it cannot.
 *
 * `navigator.clipboard` is missing outside a secure context and can be refused
 * by browser settings, so a copy button that assumes it works is a button that
 * sometimes silently does nothing. On failure the link is revealed, selected,
 * and can be copied by hand.
 */
function CopyButton({
  value,
  disabled = false,
  reason = null,
  compact = false,
}: {
  value: string;
  disabled?: boolean;
  reason?: string | null;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "manual">("idle");
  const timer = useRef<number | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (state === "manual") field.current?.select();
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setState("done");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("manual");
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1.5">
      <Locked reason={disabled ? reason : null}>
        <button
          type="button"
          disabled={disabled}
          onClick={copy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 py-1.5 text-xs whitespace-nowrap text-ink transition-colors",
            disabled ? "cursor-not-allowed opacity-55" : "hover:bg-mist-soft",
          )}
        >
          {state === "done" ? (
            <Check className="h-3 w-3 shrink-0 text-cyan-600" />
          ) : (
            <Copy className="h-3 w-3 shrink-0" />
          )}
          {state === "done" ? "Copied" : compact ? "Link" : "Copy link"}
        </button>
      </Locked>

      {state === "manual" && (
        <input
          ref={field}
          readOnly
          value={value}
          aria-label="Invite link, copy it from here"
          className="w-48 max-w-full rounded-lg border border-line bg-white px-2 py-1 font-mono text-[11px] text-ink"
        />
      )}
    </span>
  );
}
