"use client";

/**
 * The members table: who is in the lab, what they may do, and the controls to
 * change it.
 *
 * Every control is gated twice. Here, so that an action nobody is allowed to
 * take is disabled with the reason attached rather than offered and then
 * refused. And on the server, where `changeMemberRole` and `removeMember`
 * re-read the caller's role from `org_members` and Row Level Security checks it
 * again on the statement itself. This file is the courtesy, not the boundary.
 */

import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Fragment, useState, useTransition } from "react";

import { Empty } from "@/components/dashboard/ui";
import { Reveal } from "@/components/ui/reveal";
import { changeMemberRole, removeMember } from "@/lib/data/actions";
import { ROLE_LABEL, type OrgRole } from "@/lib/data/types";
import { cn, initials } from "@/lib/utils";

import { ActionNote, Locked, RoleMenu } from "./controls";
import {
  ROLE_CHIP,
  removeLockReason,
  roleLockReason,
  type MemberView,
  type MembersPermissions,
} from "./shared";

interface RowNote {
  memberId: string;
  tone: "ok" | "err";
  text: string;
}

export function MembersTable({
  members,
  perms,
  orgName,
  /** Anchor for the empty state, present only when the viewer can invite. */
  inviteAnchor,
}: {
  members: MemberView[];
  perms: MembersPermissions;
  orgName: string;
  inviteAnchor?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [note, setNote] = useState<RowNote | null>(null);

  const busy = isPending;

  function applyRole(member: MemberView, next: OrgRole) {
    setNote(null);
    setActingId(member.id);
    startTransition(async () => {
      const result = await changeMemberRole(member.id, next);
      setActingId(null);
      setNote(
        result.ok
          ? {
              memberId: member.id,
              tone: "ok",
              text: `${member.name} is now ${ROLE_LABEL[next].toLowerCase()}.`,
            }
          : { memberId: member.id, tone: "err", text: result.error },
      );
    });
  }

  function confirmRemove(member: MemberView) {
    setNote(null);
    setActingId(member.id);
    startTransition(async () => {
      const result = await removeMember(member.id);
      setActingId(null);
      setConfirmId(null);
      setNote(
        result.ok
          ? {
              memberId: member.id,
              tone: "ok",
              text: member.isSelf
                ? `You have left ${orgName}.`
                : `${member.name} no longer has access to ${orgName}.`,
            }
          : { memberId: member.id, tone: "err", text: result.error },
      );
    });
  }

  const alone = members.length === 1;

  return (
    <div>
      <Reveal y={10}>
        {/*
          A fixed layout, on purpose. With the automatic one a column is sized to
          its content, and `truncate` sets white-space: nowrap, whose min-content
          width is the whole string. A long address would then push the table
          past the card at 375px instead of ellipsing inside it. Fixed layout
          takes the widths below, and the cells clip to them.

          The outer cell padding goes too, since on a phone those 24 pixels
          decide whether the actions column fits.
        */}
        <table className="table-base table-fixed [&_td:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:first-child]:pl-0 [&_th:last-child]:pr-0">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col" className="hidden md:table-cell">
                Email
              </th>
              <th scope="col" className="w-28">
                Role
              </th>
              <th scope="col" className="hidden w-32 lg:table-cell">
                Joined
              </th>
              <th scope="col" className="w-12 text-right sm:w-28">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const roleLock = roleLockReason(member, perms);
              const removeLock = removeLockReason(member, perms);
              const acting = actingId === member.id && busy;
              const canRemove = perms.canManage || member.isSelf;

              return (
                <Fragment key={member.id}>
                  <tr>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
                            member.isSelf
                              ? "bg-navy text-white"
                              : "bg-teal-50 text-teal-800",
                          )}
                        >
                          {initials(member.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate text-ink">{member.name}</span>
                            {member.isSelf && (
                              <span className="shrink-0 rounded-md bg-mist-soft px-1.5 py-0.5 text-[10px] text-muted">
                                You
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted md:hidden">
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="hidden md:table-cell">
                      <span className="block max-w-[15rem] truncate text-muted">
                        {member.email}
                      </span>
                    </td>

                    <td>
                      {perms.canManage ? (
                        <Locked reason={roleLock}>
                          <RoleMenu
                            value={member.role}
                            maxRole={perms.callerRole}
                            disabled={perms.demo || busy || roleLock !== null}
                            busy={acting}
                            label={`Role for ${member.name}`}
                            onSelect={(next) => applyRole(member, next)}
                          />
                        </Locked>
                      ) : (
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2.5 py-1 text-xs",
                            ROLE_CHIP[member.role],
                          )}
                        >
                          {ROLE_LABEL[member.role]}
                        </span>
                      )}
                    </td>

                    <td className="hidden whitespace-nowrap text-muted lg:table-cell">
                      {member.joinedLabel}
                    </td>

                    <td className="text-right">
                      {canRemove ? (
                        <Locked reason={removeLock}>
                          <button
                            type="button"
                            disabled={perms.demo || busy || removeLock !== null}
                            aria-label={
                              member.isSelf
                                ? `Leave ${orgName}`
                                : `Remove ${member.name} from ${orgName}`
                            }
                            onClick={() => {
                              setNote(null);
                              setConfirmId(member.id);
                            }}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 py-1.5 text-xs whitespace-nowrap text-ink transition-colors sm:px-3",
                              perms.demo || busy || removeLock !== null
                                ? "cursor-not-allowed opacity-55"
                                : "hover:border-red-200 hover:bg-red-50 hover:text-red-700",
                            )}
                          >
                            <Trash2 className="h-3 w-3 shrink-0" />
                            {/* The label is the first thing to go on a phone. */}
                            <span className="hidden sm:inline">
                              {member.isSelf ? "Leave" : "Remove"}
                            </span>
                          </button>
                        </Locked>
                      ) : null}
                    </td>
                  </tr>

                  {confirmId === member.id && (
                    <tr>
                      <td colSpan={5} className="bg-canvas">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="min-w-0 text-sm text-ink">
                            {member.isSelf
                              ? `Leave ${orgName}? You lose access to its screens, runs and outcomes.`
                              : `Remove ${member.name} from ${orgName}? Access ends right away. Their screens, runs and outcomes stay in the workspace.`}
                          </p>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => setConfirmId(null)}
                            >
                              {member.isSelf ? "Stay" : "Keep them"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
                              disabled={busy}
                              onClick={() => confirmRemove(member)}
                            >
                              {acting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              {member.isSelf ? "Leave the workspace" : "Remove"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {note?.memberId === member.id && (
                    <tr>
                      <td colSpan={5} className="pt-0">
                        <ActionNote tone={note.tone}>{note.text}</ActionNote>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Reveal>

      {alone && (
        <div className="mt-5">
          <Empty
            title="Just you so far"
            body={
              perms.canManage
                ? "Invite the people who run the screens with you. They sign in with their own account and see the same screens, hits and outcomes."
                : "Ask an owner or an admin of this workspace to invite the rest of your lab."
            }
            action={
              perms.canManage && inviteAnchor ? (
                <a href={inviteAnchor} className="btn btn-orange btn-sm">
                  <UserPlus className="h-4 w-4" />
                  Send the first invite
                </a>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
