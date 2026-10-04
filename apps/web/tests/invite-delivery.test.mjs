/**
 * Getting an invitation code into an inbox.
 *
 * This is the front door of an invitation-only product: if the message does not
 * arrive, the invited researcher cannot reach the laboratory at all, and the
 * only thing the members page could say before was "delivery failed". Four
 * claims are load bearing and each one is pinned here.
 *
 *  - The code is minted with `generateLink`, which sends nothing, and the
 *    message is posted by SplicR's own sender. The authentication service's
 *    mailer is never in the path when the product has a sender of its own, so
 *    its per-hour email allowance and its SMTP configuration cannot swallow an
 *    invitation.
 *  - An address that already has an account is made a member of the workspace
 *    *before* its sign-in code is issued, so a code that arrives always opens a
 *    laboratory the person is really in.
 *  - A failure carries the sender's own sentence, which is what the panel shows
 *    and what `org_invites.delivery_error` keeps.
 *  - When a send fails after the identity was created, the caller is told so,
 *    because the authorization has already been consumed and must not be
 *    rolled back to pending.
 *
 * Nothing here sends mail or talks to Supabase: both are supplied as doubles.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const INVITER = "00000000-0000-4000-8000-0000000000c1";
const INVITED = "00000000-0000-4000-8000-0000000000d2";

const INVITE = {
  email: "colleague@university.edu",
  orgName: "Satan Lab",
  orgId: ORG,
  role: "member",
  invitedBy: INVITER,
};

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** 422 with a message Supabase actually uses for an address that exists. */
const EXISTS = { status: 422, code: "email_exists", message: "A user with this email address has already been registered" };

const otp = (email_otp = "418902") => ({
  data: { properties: { email_otp, hashed_token: "hash", action_link: "", redirect_to: "", verification_type: "invite" }, user: { id: INVITED } },
  error: null,
});

/**
 * A Supabase admin client that records what it was asked to do.
 *
 * `generate` is consulted in call order, so a test can say "the invite attempt
 * is refused, the magic link attempt succeeds" without a stateful double.
 */
function makeAdmin({ generate = [otp()], profile = { id: INVITED }, membershipError = null, profileUpdateError = null, inviteByEmail = { error: null }, otpSend = { error: null } } = {}) {
  const calls = { generate: [], tables: [], inviteByEmail: [], signInWithOtp: [] };
  let generated = 0;

  const table = (name) => {
    const record = { table: name, op: "select", payload: null, filters: [] };
    calls.tables.push(record);
    const chain = new Proxy(
      {},
      {
        get(_, method) {
          if (method === "then") {
            return (resolve, reject) => {
              const answer =
                name === "profiles"
                  ? record.op === "update"
                    ? { data: null, error: profileUpdateError }
                    : { data: profile, error: profile ? null : { message: "no row" } }
                  : name === "org_members"
                    ? { data: null, error: membershipError }
                    : { data: null, error: null };
              return Promise.resolve(answer).then(resolve, reject);
            };
          }
          return (...args) => {
            if (method === "upsert" || method === "update" || method === "insert") {
              record.op = method;
              record.payload = args[0];
            } else if (method !== "select" && method !== "single" && method !== "maybeSingle") {
              record.filters.push([method, ...args]);
            }
            return chain;
          };
        },
      },
    );
    return chain;
  };

  const client = {
    from: table,
    auth: {
      signInWithOtp: async (params) => {
        calls.signInWithOtp.push(params);
        return otpSend;
      },
      admin: {
        generateLink: async (params) => {
          calls.generate.push(params);
          const answer = generate[generated] ?? generate[generate.length - 1];
          generated += 1;
          return answer;
        },
        inviteUserByEmail: async (email, options) => {
          calls.inviteByEmail.push({ email, options });
          return inviteByEmail;
        },
      },
    },
  };

  return { client, calls };
}

/** Load `invitations.ts` with its mail and database neighbours replaced. */
function loadInvitations({ admin = makeAdmin(), configured = true, send = { id: "msg_1", error: null } } = {}) {
  const sent = [];
  const loaded = loadTs("lib/auth/invitations.ts", {
    mocks: {
      "server-only": {},
      "@/lib/supabase/admin": { createAdminClient: () => admin?.client ?? null },
      "@/lib/email/send": { emailConfigured: () => configured },
      "@/lib/email/auth-codes": {
        sendAuthCode: async (input) => {
          sent.push(input);
          return send;
        },
      },
    },
  });
  return { module: loaded, sent, admin };
}

// ---------------------------------------------------------------------------
// A new researcher
// ---------------------------------------------------------------------------

test("a new address gets an invitation code SplicR mints and SplicR sends", async () => {
  const { module, sent, admin } = loadInvitations();
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.deepEqual(result, {
    state: "sent",
    error: null,
    messageId: "msg_1",
    identityCreated: true,
    channel: "splicr",
  });

  // One mint, of the kind that creates the identity, and nothing asked of the
  // authentication service's own mailer.
  assert.equal(admin.calls.generate.length, 1);
  assert.equal(admin.calls.generate[0].type, "invite");
  assert.equal(admin.calls.generate[0].email, INVITE.email);
  assert.match(admin.calls.generate[0].options.redirectTo, /\/verify\?flow=invite$/);
  assert.equal(admin.calls.generate[0].options.data.organization_name, "Satan Lab");
  assert.equal(admin.calls.inviteByEmail.length, 0);
  assert.equal(admin.calls.signInWithOtp.length, 0);

  // The message carries the code, the address and the laboratory it is for.
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    to: INVITE.email,
    key: "invite",
    values: { token: "418902", email: INVITE.email, orgName: "Satan Lab" },
  });
});

test("the invited researcher's name reaches the identity when one was given", async () => {
  const { module, admin } = loadInvitations();
  await module.deliverWorkspaceInvite({ ...INVITE, fullName: "Ada Lovelace" });
  assert.equal(admin.calls.generate[0].options.data.full_name, "Ada Lovelace");
});

// ---------------------------------------------------------------------------
// An address that already has an account
// ---------------------------------------------------------------------------

test("an existing account is made a member before its sign-in code is issued", async () => {
  const admin = makeAdmin({ generate: [{ data: null, error: EXISTS }, otp("204517")] });
  const { module, sent } = loadInvitations({ admin });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "existing_user");
  assert.equal(result.error, null);
  assert.equal(result.identityCreated, false);

  assert.deepEqual(
    admin.calls.generate.map((call) => call.type),
    ["invite", "magiclink"],
  );

  const membership = admin.calls.tables.find((call) => call.table === "org_members");
  assert.ok(membership, "the membership row is written");
  assert.deepEqual(membership.payload, {
    org_id: ORG,
    user_id: INVITED,
    role: "member",
    invited_by: INVITER,
  });

  // Order matters: a code must never open a workspace its holder is not in.
  const membershipAt = admin.calls.tables.indexOf(membership);
  const allowlistAt = admin.calls.tables.findIndex((call) => call.table === "splicr_access_allowlist");
  assert.ok(membershipAt < allowlistAt, "the allowlist is promoted after membership");
  assert.equal(admin.calls.generate.length, 2, "the sign-in code is the last thing minted");

  assert.equal(sent[0].key, "magic_link");
  assert.equal(sent[0].values.token, "204517");
});

test("the laboratory that invited them is the one the code opens", async () => {
  const admin = makeAdmin({ generate: [{ data: null, error: EXISTS }, otp("204517")] });
  const { module } = loadInvitations({ admin });
  const result = await module.deliverWorkspaceInvite(INVITE);
  assert.equal(result.state, "existing_user");

  // Measured before this was written: an address invited to one laboratory was
  // made a member of it, signed in, and landed in the workspace its profile
  // already pointed at, with the inviting laboratory nowhere on screen. The
  // membership alone does not honour the invitation.
  const landing = admin.calls.tables.find(
    (call) => call.table === "profiles" && call.op === "update",
  );
  assert.ok(landing, "the default workspace is written");
  assert.deepEqual(landing.payload, { default_org_id: ORG });
  assert.deepEqual(
    landing.filters.find((filter) => filter[0] === "eq"),
    ["eq", "id", INVITED],
    "and only on that researcher's own row",
  );

  // Still after the membership, so the profile never points at a laboratory the
  // person is not yet in.
  const membershipAt = admin.calls.tables.findIndex((call) => call.table === "org_members");
  assert.ok(membershipAt < admin.calls.tables.indexOf(landing));
});

test("a default workspace that cannot be written is reported, not sent anyway", async () => {
  const admin = makeAdmin({
    generate: [{ data: null, error: EXISTS }, otp("204517")],
    profileUpdateError: { message: "profiles is read only" },
  });
  const { module, sent } = loadInvitations({ admin });
  const result = await module.deliverWorkspaceInvite(INVITE);
  assert.equal(result.state, "failed");
  assert.match(result.error, /could not be made the one that opens/);
  assert.match(result.error, /profiles is read only/, "the reason survives");
  assert.equal(sent.length, 0, "no code goes out for a workspace it would not open");
});

test("an address that already has an account is recognised however Auth phrases it", async () => {
  const phrasings = [
    { status: 422, code: "email_exists", message: "A user with this email address has already been registered" },
    { status: 422, code: "user_already_exists", message: "User already registered" },
    { status: 400, code: undefined, message: "User already exists" },
    { status: 409, code: "conflict", message: "Email address already exists" },
  ];

  for (const error of phrasings) {
    const admin = makeAdmin({ generate: [{ data: null, error }, otp("204517")] });
    const { module } = loadInvitations({ admin });
    const result = await module.deliverWorkspaceInvite(INVITE);
    assert.equal(result.state, "existing_user", JSON.stringify(error));
  }

  // And a genuine server failure is still a failure, not a stranger's account.
  const admin = makeAdmin({
    generate: [{ data: null, error: { status: 500, code: "unexpected_failure", message: "Database error saving new user" } }],
  });
  const { module } = loadInvitations({ admin });
  assert.equal((await module.deliverWorkspaceInvite(INVITE)).state, "failed");
});

test("an existing account with no profile row is reported, not half joined", async () => {
  const admin = makeAdmin({ generate: [{ data: null, error: EXISTS }], profile: null });
  const { module, sent } = loadInvitations({ admin });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "failed");
  assert.match(result.error, /cannot find/i);
  assert.equal(sent.length, 0, "no code is sent for a membership that was not written");
  assert.ok(!admin.calls.tables.some((call) => call.table === "org_members"));
});

// ---------------------------------------------------------------------------
// Failure, with a reason
// ---------------------------------------------------------------------------

test("a refused send keeps the sender's own sentence and admits the identity exists", async () => {
  const { module } = loadInvitations({
    send: { id: null, error: "The splicr.org domain is not verified." },
  });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "failed");
  assert.match(result.error, /The splicr\.org domain is not verified\./);
  assert.equal(result.messageId, null);
  // The invite path created the account, so the authorization is spent and the
  // caller must not put it back to pending.
  assert.equal(result.identityCreated, true);
});

test("a refused mint is reported with what the authentication service said", async () => {
  const admin = makeAdmin({
    generate: [{ data: null, error: { status: 500, code: "unexpected_failure", message: "Database error saving new user" } }],
  });
  const { module, sent } = loadInvitations({ admin });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "failed");
  assert.match(result.error, /unexpected_failure/);
  assert.match(result.error, /Database error saving new user/);
  assert.equal(result.identityCreated, false, "nothing was created, so the authorization still stands");
  assert.equal(sent.length, 0);
});

test("a mint that returns no six-digit code is a failure, not an empty email", async () => {
  const admin = makeAdmin({ generate: [otp("")] });
  const { module, sent } = loadInvitations({ admin });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "failed");
  assert.match(result.error, /no one-time code/i);
  assert.equal(sent.length, 0);
});

test("a deployment with no trusted credentials names the variable it is missing", async () => {
  const { module } = loadInvitations({ admin: null });
  const result = await module.deliverWorkspaceInvite(INVITE);
  assert.equal(result.state, "failed");
  // This is the state every local invitation was actually in on 4 Oct 2026, and
  // "not configured" left a lab administrator with nothing to act on. The
  // sentence has to name the variable and say that nothing was attempted, so
  // the panel sends whoever reads it to the one place that fixes it.
  assert.match(result.error, /SUPABASE_SECRET_KEY/);
  assert.match(result.error, /no message was attempted/i);
  assert.equal(result.identityCreated, false, "nothing was created either");
});

test("the stored reason fits the column that has to hold it", async () => {
  const { module } = loadInvitations({ send: { id: null, error: "x".repeat(900) } });
  const result = await module.deliverWorkspaceInvite(INVITE);
  // public.org_invites.delivery_error is checked at 500 characters.
  assert.ok(result.error.length <= 500, `${result.error.length} characters`);
});

// ---------------------------------------------------------------------------
// The fallback for a deployment with no sender of its own
// ---------------------------------------------------------------------------

test("without mail credentials the authentication service is asked to send, and nothing is minted first", async () => {
  const admin = makeAdmin();
  const { module, sent } = loadInvitations({ admin, configured: false });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "sent");
  assert.equal(result.channel, "supabase");
  assert.equal(sent.length, 0);
  assert.equal(admin.calls.inviteByEmail.length, 1);
  // Minting first would create the identity and make this very call fail on an
  // address that now exists, so the strategy is chosen before anything else.
  assert.equal(admin.calls.generate.length, 0);
});

test("the fallback still attaches an existing account and sends it a code", async () => {
  const admin = makeAdmin({ inviteByEmail: { error: EXISTS } });
  const { module } = loadInvitations({ admin, configured: false });
  const result = await module.deliverWorkspaceInvite(INVITE);

  assert.equal(result.state, "existing_user");
  assert.ok(admin.calls.tables.some((call) => call.table === "org_members"));
  assert.equal(admin.calls.signInWithOtp.length, 1);
  assert.equal(admin.calls.signInWithOtp[0].options.shouldCreateUser, false);
});

// ---------------------------------------------------------------------------
// The message itself
// ---------------------------------------------------------------------------

function loadCodes({ send = { data: { id: "msg_7" }, error: null } } = {}) {
  const posted = [];
  const loaded = loadTs("lib/email/auth-codes.ts", {
    mocks: {
      "server-only": {},
      "./send": {
        from: () => "SplicR <team@splicr.org>",
        resendClient: () => ({
          emails: {
            send: async (payload) => {
              posted.push(payload);
              return send;
            },
          },
        }),
      },
    },
  });
  return { module: loaded, posted };
}

test("the rendered invitation holds the code, the address and the laboratory", () => {
  const { module } = loadCodes();
  const message = module.renderAuthCode("invite", {
    token: "418902",
    email: "colleague@university.edu",
    orgName: "Satan Lab",
  });

  assert.equal(message.subject, "Your SplicR invitation code");
  assert.ok(message.html.includes("418902"));
  assert.ok(message.html.includes("colleague@university.edu"));
  assert.ok(message.html.includes("Satan Lab"));
  assert.ok(!message.html.includes("{{"), "no template variable survives");
  // The same promise the templates make: a code, never a link a scanner can
  // follow and consume.
  assert.ok(!/<a\b|href\s*=/i.test(message.html));
});

test("a laboratory name cannot inject markup into the message", () => {
  const { module } = loadCodes();
  const message = module.renderAuthCode("invite", {
    token: "418902",
    email: "colleague@university.edu",
    orgName: '<script>alert("x")</script>',
  });
  assert.ok(!/<script/i.test(message.html));
  assert.ok(message.html.includes("&lt;script&gt;"));
});

test("every message has a plain text alternative that says the same thing", () => {
  const { module } = loadCodes();
  for (const key of ["invite", "magic_link", "confirm_signup", "reset_password", "change_email", "reauthentication"]) {
    const message = module.renderAuthCode(key, {
      token: "418902",
      email: "colleague@university.edu",
      orgName: "Satan Lab",
      newEmail: "new@university.edu",
    });
    assert.ok(message.text.includes("418902"), `${key} states the code`);
    assert.ok(!/https?:\/\//.test(message.text), `${key} has no link in the text part`);
    assert.ok(message.text.includes("SplicR"), key);
  }
});

test("sending posts both parts and reports the provider's message id", async () => {
  const { module, posted } = loadCodes();
  const outcome = await module.sendAuthCode({
    to: "colleague@university.edu",
    key: "invite",
    values: { token: "418902", email: "colleague@university.edu", orgName: "Satan Lab" },
  });

  assert.deepEqual(outcome, { id: "msg_7", error: null });
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].to, ["colleague@university.edu"]);
  assert.equal(posted[0].subject, "Your SplicR invitation code");
  assert.ok(posted[0].html.includes("418902"));
  assert.ok(posted[0].text.includes("418902"));
});

test("a provider refusal comes back as a sentence rather than an exception", async () => {
  const { module } = loadCodes({ send: { data: null, error: { message: "Domain is not verified" } } });
  const outcome = await module.sendAuthCode({
    to: "colleague@university.edu",
    key: "invite",
    values: { token: "418902", email: "colleague@university.edu", orgName: "Satan Lab" },
  });
  assert.deepEqual(outcome, { id: null, error: "Domain is not verified" });
});

// ---------------------------------------------------------------------------
// What the rest of the product does with the outcome
// ---------------------------------------------------------------------------

test("the authorization is only rolled back when nothing was created", () => {
  const actions = read("src/lib/data/actions.ts");
  assert.match(actions, /const authorized = landed \|\| delivery\.identityCreated;/);
  assert.match(actions, /delivery_error: delivery\.error/);
  // One place writes the outcome, so the first attempt and a retry cannot drift.
  assert.equal(actions.match(/recordDelivery\(supabase, \{/g)?.length, 2);
});

test("the members page shows the reason, not only the fact", () => {
  const panel = read("src/components/dashboard/members/invite-panel.tsx");
  assert.match(panel, /invite\.deliveryState === "failed" && invite\.deliveryError/);
  assert.match(panel, /created\.deliveryError/);
  // An open invitation can always be sent again: the emailed code is short
  // lived, the invitation is not.
  assert.match(panel, /\{!invite\.expired && \(/);
  assert.match(panel, /"Retry" : "Send again"/);
});

// ---------------------------------------------------------------------------
// The way back
// ---------------------------------------------------------------------------

/**
 * Being invited to a second laboratory makes that one the workspace the console
 * opens. These hold the door open behind it: a researcher in two laboratories
 * can return to the other, and nobody can be moved into one they are not in.
 */
function loadSwitch({
  role = "member",
  context,
  updateError = null,
  rows = [{ id: INVITED }],
  members = [],
  delivery = { state: "existing_user", error: null },
} = {}) {
  const delivered = [];
  const queries = [];
  const client = {
    from(table) {
      const record = { table, op: "select", payload: null, filters: [] };
      queries.push(record);
      const chain = new Proxy(
        {},
        {
          get(_, method) {
            if (method === "then") {
              return (resolve) => resolve({ data: updateError ? null : rows, error: updateError });
            }
            return (...args) => {
              if (method === "update") {
                record.op = method;
                record.payload = args[0];
              } else if (method !== "select") record.filters.push([method, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  const actions = loadTs("lib/data/actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath() {} },
      "./org": {
        getCurrentContext: async () =>
          context ?? {
            isDemo: false,
            user: { id: INVITED, email: "a@b.c" },
            org: { id: ORG, name: "Satan Lab", slug: "satan" },
            role: "owner",
            workspaces: [],
          },
        getOrgRole: async () => role,
        countOrgOwners: async () => 2,
        getOrgSettings: async () => ({}),
        listMembers: async () => members,
      },
      "@/lib/supabase/server": { createClient: async () => client },
      "@/lib/auth/invitations": {
        deliverWorkspaceInvite: async (input) => {
          delivered.push(input);
          return delivery;
        },
      },
    },
  });
  return { module: actions, queries, delivered };
}

const OTHER = "00000000-0000-4000-8000-0000000000bb";

test("switching workspace writes only the caller's own default", async () => {
  const { module, queries } = loadSwitch();
  const result = await module.switchWorkspace(OTHER);
  assert.equal(result.ok, true);
  const update = queries.find((query) => query.op === "update");
  assert.equal(update.table, "profiles");
  assert.deepEqual(update.payload, { default_org_id: OTHER });
  assert.deepEqual(
    update.filters.find((filter) => filter[0] === "eq"),
    ["eq", "id", INVITED],
  );
});

test("a workspace the caller is not in is refused before anything is written", async () => {
  const { module, queries } = loadSwitch({ role: null });
  const result = await module.switchWorkspace(OTHER);
  assert.equal(result.ok, false);
  assert.match(result.error, /not a member of that workspace/i);
  assert.equal(queries.length, 0, "the database was not touched");
});

test("switching to the workspace already open is a no-op, and an id that is not one is refused", async () => {
  const same = loadSwitch();
  assert.equal((await same.module.switchWorkspace(ORG)).ok, true);
  assert.equal(same.queries.length, 0, "nothing is rewritten");

  const bogus = loadSwitch();
  const result = await bogus.module.switchWorkspace("../../etc/passwd");
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid/i);
  assert.equal(bogus.queries.length, 0);
});

test("a signed-out caller cannot switch anything", async () => {
  const { module, queries } = loadSwitch({ context: { isDemo: false, user: null, org: null, role: null, workspaces: [] } });
  assert.equal((await module.switchWorkspace(OTHER)).ok, false);
  assert.equal(queries.length, 0);
});

test("the rail offers the menu only to somebody with somewhere to go", () => {
  const menu = read("src/components/dashboard/workspace-menu.tsx");
  assert.match(menu, /if \(workspaces\.length < 2\) return null;/);
  // The rail sits at the bottom of the viewport, so the menu opens upwards.
  assert.match(menu, /bottom-full/);
  const shell = read("src/components/dashboard/shell.tsx");
  assert.match(shell, /<WorkspaceMenu current=\{user\.orgId\} workspaces=\{user\.workspaces\}/);
});

// ---------------------------------------------------------------------------
// A code for somebody who never arrived
// ---------------------------------------------------------------------------

/**
 * The gap these close: an invitation creates the identity and the membership
 * the moment its code is minted, which marks the invitation accepted and takes
 * it out of the pending list, while the code itself expires within the hour.
 * The member was then in the laboratory with no way in and no button to press.
 */
const STRANDED = {
  id: INVITED,
  name: "Rosalind Franklin",
  email: "rf@lab.example",
  role: "member",
  joined_at: "2026-10-04T00:00:00Z",
};

test("an admin can send a fresh sign-in code to a member who never arrived", async () => {
  const { module: actions, delivered } = loadSwitch({ role: "admin", members: [STRANDED] });
  const result = await actions.sendMemberSignInCode(INVITED);
  assert.equal(result.ok, true);
  assert.equal(delivered.length, 1);
  // Through the one delivery path, so a first invitation and a later code
  // cannot behave differently, and the code opens this laboratory.
  assert.equal(delivered[0].email, STRANDED.email);
  assert.equal(delivered[0].orgId, ORG);
  assert.equal(delivered[0].role, "member");
});

test("a researcher cannot send anybody a sign-in code", async () => {
  for (const role of ["viewer", "member"]) {
    const { module: actions, delivered } = loadSwitch({ role, members: [STRANDED] });
    const result = await actions.sendMemberSignInCode(INVITED);
    assert.equal(result.ok, false, role);
    assert.match(result.error, /need the admin role/i);
    assert.equal(delivered.length, 0, "and nothing was minted");
  }
});

test("a code cannot be sent to somebody outside the workspace", async () => {
  const { module: actions, delivered } = loadSwitch({ role: "admin", members: [] });
  const result = await actions.sendMemberSignInCode(INVITED);
  assert.equal(result.ok, false);
  assert.match(result.error, /not a member of this workspace/i);
  assert.equal(delivered.length, 0);

  const bogus = loadSwitch({ role: "admin", members: [STRANDED] });
  assert.equal((await bogus.module.sendMemberSignInCode("not-a-uuid")).ok, false);
  assert.equal(bogus.delivered.length, 0);
});

test("a refused send is reported with the reason the sender gave", async () => {
  const { module: actions } = loadSwitch({
    role: "admin",
    members: [STRANDED],
    delivery: { state: "failed", error: "the provider refused the address" },
  });
  const result = await actions.sendMemberSignInCode(INVITED);
  assert.equal(result.ok, false);
  assert.equal(result.error, "the provider refused the address");
});

test("the table marks only a definite absence, and offers the code only then", () => {
  const table = read("src/components/dashboard/members/members-table.tsx");
  // `signedIn` is boolean | null: null means an admin could not ask, and a
  // guess there would label a colleague of six months as absent.
  // Whitespace-insensitive: these pin the condition, not the formatter.
  const flat = table.replace(/\s+/g, " ");
  assert.match(flat, /member\.signedIn === false && \( <div[^>]*> Has not signed in yet/);
  assert.match(
    flat,
    /perms\.canManage && member\.signedIn === false && !member\.isSelf/,
    "the button is for an admin, about somebody else, who has not arrived",
  );
  const shared = read("src/components/dashboard/members/shared.ts");
  assert.match(shared, /signedIn: boolean \| null;/);
});

test("who has signed in is readable by an admin of that workspace and nobody else", () => {
  const migration = readFileSync(
    path.join(root, "../../supabase/migrations/20261004000200_member_sign_in_state.sql"),
    "utf8",
  );
  assert.match(migration, /security definer/);
  assert.match(
    migration,
    /if p_org is null or not private\.has_org_role\(p_org, 'admin'\) then\s*\n\s*raise exception/,
  );
  assert.match(migration, /revoke all on function public\.org_member_access\(uuid\) from public, anon;/);
  // Only the one column the question needs leaves auth.users.
  assert.ok(!/encrypted_password|phone|raw_user_meta_data/.test(migration));
});
