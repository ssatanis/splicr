/**
 * What the four roles mean, in one place.
 *
 * The role picker repeats these lines next to each option, which helps the
 * person changing a role. This card is for everybody else: a viewer sees no
 * controls at all, and still deserves to know why.
 */
import { Card } from "@/components/dashboard/ui";
import { ORG_ROLES, ROLE_LABEL, type OrgRole } from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { ROLE_CHIP, ROLE_SUMMARY } from "./shared";

export function RoleLegend({ callerRole }: { callerRole: OrgRole | null }) {
  return (
    <Card title="What each role can do">
      <ul className="space-y-3">
        {ORG_ROLES.map((role) => (
          <li key={role} className="flex gap-3">
            <span
              className={cn(
                "mt-0.5 inline-flex w-16 shrink-0 justify-center rounded-full px-2 py-0.5 text-[11px]",
                ROLE_CHIP[role],
              )}
            >
              {ROLE_LABEL[role]}
            </span>
            <p className="min-w-0 text-sm text-body">
              {ROLE_SUMMARY[role]}
              {role === callerRole && <span className="text-muted"> This is your role.</span>}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        A workspace always keeps at least one owner. While somebody is the only owner, their role
        and their removal stay disabled.
      </p>
    </Card>
  );
}
