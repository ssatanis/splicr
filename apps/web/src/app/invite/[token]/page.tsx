/**
 * The page an invite link opens.
 *
 * This is where the copy-link button on the members page sends people, so it
 * has to hold up on its own. It is deliberately public: the proxy only gates
 * `/dashboard`, and an invited person usually has no session yet.
 *
 * The invite row is readable here because of the "admins read invites" policy,
 * whose second arm matches `lower(email)` against the signed-in address. So a
 * signed-in invitee can see their own invite and nobody else's, and a visitor
 * with no session sees only that some invite exists.
 */
import { Clock, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { acceptInvite } from "@/lib/data/accept-invite";
import { getCurrentContext } from "@/lib/data/org";
import { ROLE_LABEL, isOrgRole } from "@/lib/data/types";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Join a lab" };

const FAILURES: Record<string, string> = {
  gone: "That invite has expired or has already been used. Ask somebody in the lab for a new link.",
  email: "That invite was issued to a different email address. Sign in as the person it was sent to.",
  failed: "The invite could not be accepted just now. Try again in a moment.",
};

interface InviteRow {
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

/**
 * Reading the clock is not something a component may do while rendering, so it
 * happens in here. The database checks the same thing again inside
 * `public.accept_org_invite()`, which is what actually decides.
 */
function isPast(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const failureKey = typeof query.error === "string" ? query.error : null;
  const failure = failureKey ? (FAILURES[failureKey] ?? FAILURES.failed) : null;

  const { user } = await getCurrentContext();

  if (!supabaseConfigured) {
    return (
      <Sheet>
        <Heading title="Invites are not available here" />
        <p className="text-body">
          This copy of SplicR is not connected to its database, so an invite cannot be accepted.
        </p>
        <Link href="/" className="btn btn-teal btn-sm mt-6">
          Back home
        </Link>
      </Sheet>
    );
  }

  if (!user) {
    return (
      <Sheet>
        <Heading title="You have been invited to a lab" />
        <p className="text-body">
          Sign in with the address the invite was sent to, and you will land in the workspace. If
          you have no account yet, create one with that same address first.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="btn btn-orange btn-sm"
          >
            Sign in to accept
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="btn btn-ghost btn-sm"
          >
            Create an account
          </Link>
        </div>
      </Sheet>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_invites")
    .select("email, role, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error(`[invite] read: ${error.code ?? ""} ${error.message}`);
  }

  const invite = (data ?? null) as InviteRow | null;
  const expired = invite !== null && isPast(invite.expires_at);

  // Written as one condition rather than a `usable` flag so that TypeScript
  // narrows `invite` to a row for the rest of the function.
  if (invite === null || expired || invite.accepted_at !== null) {
    return (
      <Sheet>
        <Heading title="This invite is not open" />
        <p className="text-body">
          {invite === null
            ? "The link is not valid for the account you are signed in as, or it has been withdrawn. Invites can only be accepted by the address they were sent to."
            : expired
              ? "The link has expired. Invites are good for 14 days, so ask for a new one."
              : "Somebody has already used this link."}
        </p>
        <p className="mt-3 text-sm text-muted">You are signed in as {user.email ?? "this account"}.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/dashboard" className="btn btn-teal btn-sm">
            Go to the dashboard
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </form>
        </div>
      </Sheet>
    );
  }

  const role = isOrgRole(invite.role) ? invite.role : "member";

  return (
    <Sheet>
      <Heading title="Join this lab on SplicR" />
      <p className="text-body">
        You were invited as{" "}
        <strong className="text-ink">{ROLE_LABEL[role].toLowerCase()}</strong>. Accepting shares the
        lab&apos;s screens, runs, hits and validation outcomes with you.
      </p>

      <dl className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
        <div className="flex items-start gap-3">
          <dt className="w-24 shrink-0 text-muted">Invited</dt>
          <dd className="min-w-0 break-words text-ink">{invite.email}</dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="w-24 shrink-0 text-muted">Signed in</dt>
          <dd className="min-w-0 break-words text-ink">{user.email ?? "this account"}</dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="w-24 shrink-0 text-muted">Role</dt>
          <dd className="text-ink">{ROLE_LABEL[role]}</dd>
        </div>
      </dl>

      {failure && (
        <p className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {failure}
        </p>
      )}

      <form action={acceptInvite} className="mt-6 flex flex-wrap items-center gap-3">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn btn-orange btn-sm">
          <ShieldCheck className="h-4 w-4" />
          Accept and join
        </button>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">
          Not now
        </Link>
      </form>

      <p className="mt-5 flex items-start gap-2 text-xs text-muted">
        <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
        The address on the invite has to match the one you are signed in with. If it does not, sign
        out and sign in as that person.
      </p>
    </Sheet>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-line bg-white p-6 md:p-8">
        <Logo href="/" size="sm" />
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

function Heading({ title }: { title: string }) {
  return <h1 className="mb-3 text-2xl tracking-tight text-ink md:text-3xl">{title}</h1>;
}
